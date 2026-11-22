"""Regenerate shared/test_vectors.json from the Python core.

pytest checks that the file is up to date (so the Python core and the vectors never drift apart), and
``node --test`` checks the JS port against the very same vectors.

    python scripts/make_vectors.py
"""

from __future__ import annotations

import hashlib
import hmac
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from toytaklif import i18n  # noqa: E402
from toytaklif.core import clock, guestlist, qr, qrtoken, rsvp, seedgen, stats, text  # noqa: E402

OUT = ROOT / "shared" / "test_vectors.json"
NOW = 1_795_000_000_000  # 2026-11-18 11:06 UTC (16:06 in Tashkent), a Wednesday
NYE = 1_798_736_400_000  # 2026-12-31 22:00 in Tashkent
SECRET = "vectors-only-secret-not-for-servers"  # noqa: S105 - public test value
ERRORS = (text.InputError,)


def load(name: str):
    with open(ROOT / "shared" / "data" / f"{name}.json", encoding="utf-8") as fh:
        return json.load(fh)


def res(fn, *args):
    try:
        return {"ok": fn(*args)}
    except ERRORS as e:
        return {"error": e.code}


def core_vectors(v: dict) -> None:
    v["civil"] = [{"day": d, "out": list(clock.civil(d))} for d in (0, 59, 365, 20_775, 20_818, 20_819, 21_184, -1)]
    v["local"] = [{"ms": ms, "day": clock.local_day(ms), "minute": clock.local_minute(ms),
                   "wd": clock.weekday(clock.local_day(ms))} for ms in (0, NOW, NYE, NYE + 7_200_000, -1)]
    v["countdown"] = [{"in": ms, "out": list(clock.countdown(ms))} for ms in
                      (0, -5, 999, 1000, 59_999, 3_600_000, 90_061_000, 25 * 86_400_000 + 3_723_000)]
    v["clean"] = [{"in": s, "n": n, "out": text.clean(s, n)} for s, n in
                  (("  a \t b\n", 10), ("abc" + chr(0x202E) + "def", 20), ("x" * 20, 5), (None, 5),
                   ("Lola" + chr(0) + "zor", 20), ("a 　b", 9), ("😀😀😀", 2))]
    v["whole"] = [{"in": x, "out": res(text.whole, x, 1, 5, "people")} for x in
                  (1, 5, 0, 6, "3", " 4 ", "", "x", True, 2.5, "１", None, "0003")]
    v["h32"] = [{"in": s, "out": text.h32(s)} for s in ("", "a", "inv:1", "Karimovlar oilasi", "жених")]
    v["sha256"] = [{"in": s, "out": hashlib.sha256(s.encode()).hexdigest()} for s in ("", "abc", "x" * 200, "To'y 💍")]
    v["hmac"] = [{"key": k, "msg": m, "out": hmac.new(k.encode(), m.encode(), hashlib.sha256).hexdigest()}
                 for k, m in (("key", "The quick brown fox"), ("k" * 100, "long key"), (SECRET, "qr|1.1.3.2"))]
    tokens = [qrtoken.sign(SECRET.encode(), w, i, p, ver) for w, i, p, ver in ((1, 1, 3, 2), (1, 2, 1, 1), (7, 99, 10, 13))]
    forged = [tokens[0].replace(".3.2.", ".5.2."), tokens[0][:-1] + ("A" if tokens[0][-1] != "A" else "B"),
              tokens[0].lower(), "TT1.1.1.3.2", "", "TT1.0.1.3.2." + "A" * 22, tokens[0] + " ", 12345]
    v["tokens"] = {"secret": SECRET, "signed": tokens,
                   "verify": [{"in": x, "out": qrtoken.verify(SECRET.encode(), x)} for x in [*tokens, *forged]],
                   "codes": [{"i": i, "v": ver, "out": qrtoken.entry_code(SECRET.encode(), i, ver)}
                             for i, ver in ((1, 1), (1, 2), (80, 1), (999_999, 55))],
                   "norm": [{"in": x, "out": qrtoken.norm_code(x)} for x in
                            ("k7q2m-9xd4a", "K7Q2M 9XD4A", "kOqIl-9xd4a", "K7Q2M-9XD4", "K7Q2M-9XD4U", "", 5,
                             "ab-cd-ef-gh-jk")]}
    v["qr"] = [{"in": s, "out": qr.as_text(qr.matrix(s))} for s in
               ("A", tokens[0], "https://example.org/i/" + "x" * 22, "Q" * 120, "w" * 213, "Karimovlar oilasi — 3 kishi")]
    v["qr_parts"] = {"format": [qr.format_bits(m) for m in range(8)], "version": [qr.version_bits(x) for x in range(7, 11)],
                     "rs": qr.rs_remainder([32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17], 10)}


def rule_vectors(v: dict, names: dict) -> None:
    w = seedgen.wedding(NOW)
    inv = seedgen.invite(1, names, NOW)
    answers = [{"status": "yes", "people": 3, "wish": "  Baxtli bo'ling!  ", "note": "bolalar\tbilan"},
               {"status": "yes", "people": 4}, {"status": "yes", "people": 0}, {"status": "yes"},
               {"status": "yes", "people": "2"}, {"status": "yes", "people": True}, {"status": "no", "people": 3},
               {"status": "maybe"}, {"status": "maybe", "people": 1}, {"status": "later"}, {"status": "no", "note": 5},
               {"status": "no", "wish": "x" * 400}, [], "yes"]
    v["validate"] = [{"in": a, "out": res(rsvp.validate, a, inv, w, NOW)} for a in answers]
    v["validate_late"] = res(rsvp.validate, {"status": "no"}, inv, w, w["rsvp_deadline"] + 1)
    v["validate_in"] = res(rsvp.validate, {"status": "no"}, {**inv, "checked_in": 1}, w, NOW)
    v["apply"] = [{"inv": i, "a": a, "out": rsvp.apply(i, a, NOW)} for i, a in (
        (inv, {"status": "yes", "people": 3, "note": "", "wish": ""}),
        ({**inv, "status": "yes", "people": 3, "version": 2}, {"status": "yes", "people": 3, "note": "x", "wish": ""}),
        ({**inv, "status": "yes", "people": 3, "version": 2}, {"status": "yes", "people": 2, "note": "", "wish": ""}),
        ({**inv, "status": "maybe", "people": 3}, {"status": "no", "people": 0, "note": "", "wish": ""}))]
    v["check_invite"] = [{"in": d, "out": res(rsvp.check_invite, d)} for d in (
        {"name": " Aliyevlar  oilasi ", "seats": 4, "side": "kelin", "grp": "Do'stlar"}, {"name": "A", "seats": 1, "side": "kuyov"},
        {"name": "Ali Vali", "seats": 11, "side": "kuyov"}, {"name": "Ali Vali", "seats": 2, "side": "both"},
        {"name": "Ali Vali", "seats": "2", "side": "kuyov", "grp": 7}, {"name": 5, "seats": 2, "side": "kuyov"}, None)]
    csvs = ["Ism;Joy;Tomon;Guruh\nKarimovlar oilasi;3;kuyov;Qarindoshlar\n\"Ali; Vali\";2;kelin;\nX;1;;\n",
            "﻿name,seats,side,group\r\nAliyevlar,4,Невеста,\"Do'stlar, eski\"\r\n\"Say \"\"Hi\"\"\",1,k,\r\n",
            "Sobirovlar\t11\tkuyov\nYo'ldoshlar\t\tnima\n\nUmarovlar\t2\tq\tQo'shnilar",
            "Karimovlar oilasi,3\nJasur Aliyev", "", "a;b\n" * 3]
    v["csv"] = [{"in": s, "side": side, "out": res(guestlist.parse_csv, s, side)} for s in csvs for side in ("kuyov", "kelin")]
    v["csv_big"] = res(guestlist.parse_csv, "Ali Vali;1\n" * 501)
    v["safe_cell"] = [{"in": s, "out": guestlist.safe_cell(s)} for s in ("=1+1", "+998", "-", "@x", 'a"b', "a,b", "ok", 3)]


def world_vectors(v: dict, names: dict) -> None:
    wd = seedgen.world(names, NOW)
    v["seed"] = wd
    later = seedgen.world(names, NYE)
    v["seed_nye"] = {"now": NYE, "wedding": later["wedding"], "first": later["invites"][:3]}
    v["summary"] = stats.summary(wd["wedding"], wd["invites"], NOW)
    moved = [{**x, "reminded_at": NOW - 3_600_000} if x["id"] % 3 == 0 else x for x in wd["invites"]]
    moved[0] = {**moved[0], "status": "yes", "people": 3, "checked_in": 2}
    v["summary2"] = {"invites": moved, "out": stats.summary({**wd["wedding"], "capacity": 50}, moved, NOW + 7_200_000)}
    v["export"] = guestlist.export_csv(wd["invites"])
    v["texts"] = []
    for lang in ("uz", "ru"):
        v["texts"].append({
            "lang": lang, "dates": [i18n.date_long(lang, ms) for ms in (NOW, NYE, NYE + 7_200_000, wd["wedding"]["starts_at"])],
            "left": [i18n.left_text(lang, ms) for ms in (-1, 0, 59_000, 60_000, 61_000, 3_600_000, 5_400_000, 86_400_000,
                                                          25 * 86_400_000 + 3_723_000)],
            "people": [i18n.people(lang, n) for n in (0, 1, 3)],
            "answers": [i18n.answer_line(lang, x) for x in wd["invites"][:12]],
            "program": [i18n.program_title(lang, p) for p in [*wd["wedding"]["program"], {"at": 0, "text": "Kelin salom"}]]})
    v["short"] = [i18n.date_short(ms) for ms in (NOW, NYE, NYE + 7_200_000)]
    v["clock"] = [i18n.clock(ms) for ms in (NOW, NYE, NYE + 7_200_000)]
    v["bar"] = [{"pct": p, "out": i18n.bar(p)} for p in (0, 4, 5, 36, 99, 100, 140)]


def build() -> dict:
    names = load("names")
    v: dict = {"now": NOW, "nye": NYE}
    core_vectors(v)
    rule_vectors(v, names)
    world_vectors(v, names)
    return v


def main() -> None:
    body = json.dumps(build(), ensure_ascii=False, separators=(",", ":")) + "\n"
    OUT.write_text(body, encoding="utf-8", newline="\n")
    print(f"wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
