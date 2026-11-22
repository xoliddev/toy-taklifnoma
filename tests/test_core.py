"""Pure core: the shared vectors are current, passes cannot be forged, the QR is readable, the rules hold."""

from __future__ import annotations

import json

import pytest

from scripts import make_vectors
from toytaklif import i18n
from toytaklif.core import clock, guestlist, qr, qrtoken, rsvp, seedgen, stats, text

SECRET = b"test-secret-0123456789abcdef0123"
NOW = make_vectors.NOW


def test_vectors_are_up_to_date(vectors):
    fresh = json.loads(json.dumps(make_vectors.build(), ensure_ascii=False))
    assert fresh == vectors, "run: python scripts/make_vectors.py"


def test_locales_have_the_same_keys():
    uz, ru = i18n.catalog("uz"), i18n.catalog("ru")
    assert set(uz) == set(ru)
    for key, value in uz.items():
        assert set(i18n._PLACEHOLDER.findall(value)) == set(i18n._PLACEHOLDER.findall(ru[key])), key


def test_pass_roundtrip_and_forgery():
    token = qrtoken.sign(SECRET, 1, 7, 3, 2)
    assert qrtoken.verify(SECRET, token) == {"wedding_id": 1, "invite_id": 7, "people": 3, "version": 2,
                                             "sig": token.rsplit(".", 1)[1]}
    assert qrtoken.verify(b"other-secret-0123456789abcdef012", token) is None
    for forged in (token.replace(".3.2.", ".5.2."), token.replace(".7.", ".8."), token.replace(".2.", ".3.", 1)):
        assert qrtoken.verify(SECRET, forged) is None
    sig = token.rsplit(".", 1)[1]
    assert len(sig) == 22  # 128 bits


def test_entry_code_changes_with_version_and_normalises():
    a, b = qrtoken.entry_code(SECRET, 7, 1), qrtoken.entry_code(SECRET, 7, 2)
    assert a != b and len(a) == 11 and a[5] == "-"
    assert qrtoken.norm_code(a.lower().replace("-", " ")) == a
    assert qrtoken.norm_code("short") is None


@pytest.mark.parametrize("n", [1, 20, 34, 60, 120, 213])
def test_qr_sizes_and_function_patterns(n):
    m = qr.matrix("x" * n)
    size = len(m)
    assert (size - 17) % 4 == 0 and all(len(r) == size for r in m)
    for r0, c0 in ((0, 0), (0, size - 7), (size - 7, 0)):  # three finder patterns
        assert [m[r0][c0 + k] for k in range(7)] == [1] * 7
        assert m[r0 + 3][c0 + 3] == 1 and m[r0 + 1][c0 + 1] == 0
    assert m[size - 8][8] == 1  # the dark module


def test_qr_too_long():
    with pytest.raises(qr.QrError):
        qr.matrix("x" * 300)


def test_rsvp_until_deadline_and_version_bump(names):
    w = seedgen.wedding(NOW)
    inv = seedgen.invite(1, names, NOW)
    a = rsvp.validate({"status": "yes", "people": 3, "wish": "<b>tabrik</b>"}, inv, w, NOW)
    assert a["wish"] == "<b>tabrik</b>"  # kept as text; every screen escapes it
    after = rsvp.apply(inv, a, NOW)
    assert after["version"] == 2 and after["people"] == 3
    same = rsvp.apply(after, {**a, "note": "yangi izoh"}, NOW)
    assert same["version"] == 2  # a new note keeps the pass
    with pytest.raises(text.InputError, match="deadline"):
        rsvp.validate({"status": "no"}, inv, w, w["rsvp_deadline"] + 1)
    with pytest.raises(text.InputError, match="people"):
        rsvp.validate({"status": "yes", "people": 4}, inv, w, NOW)


def test_stats_tables_capacity_and_reminders(names):
    wd = seedgen.world(names, NOW)
    s = stats.summary(wd["wedding"], wd["invites"], NOW)
    assert s["yes"] + s["no"] + s["maybe"] + s["none"] == 80
    assert s["tables"] == -(-s["people"] // 10)
    assert s["sides"]["kuyov"]["people"] + s["sides"]["kelin"]["people"] == s["people"]
    inv = {**wd["invites"][0], "reminded_at": NOW - clock.DAY_MS + 1}
    assert not stats.remind_due(inv, NOW)
    assert stats.remind_due({**inv, "reminded_at": NOW - clock.DAY_MS}, NOW)
    assert not stats.remind_due({**inv, "tg": None, "reminded_at": None}, NOW)


def test_seed_is_relative_and_crosses_new_year(names):
    for d in range(30):
        now = make_vectors.NYE - 20 * clock.DAY_MS + d * clock.DAY_MS
        w = seedgen.wedding(now)
        assert clock.local_day(w["starts_at"]) - clock.local_day(now) == 25
        assert clock.local_minute(w["starts_at"]) == 18 * 60
        assert w["rsvp_deadline"] < w["starts_at"]
        story = seedgen.invite(1, names, now)
        assert story["name"] == "Karimovlar oilasi" and story["status"] == "none" and story["seats"] == 3


def test_csv_export_defuses_formulas():
    out = guestlist.export_csv([{"id": 1, "name": "=HYPERLINK(\"x\")", "seats": 1, "side": "kuyov", "grp": "+1",
                                 "status": "none", "people": 0, "note": "@cmd"}])
    row = out.split("\r\n")[1]
    assert row.startswith("\"'=HYPERLINK") and ",'+1," in row and row.endswith("'@cmd")


def test_text_formatters():
    assert i18n.bar(36) == "▰" * 4 + "▱" * 6
    assert i18n.t("uz", "inv.dear", name="<script>") == "Hurmatli &lt;script&gt;!"
    assert i18n.left_text("uz", 25 * clock.DAY_MS + 3 * clock.HOUR_MS) == "25 kun 3 soat"
