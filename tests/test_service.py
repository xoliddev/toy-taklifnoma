"""Service rules: links, RSVP, wishes, the hosts' tools scoped to their own wedding, the door, admin."""

from __future__ import annotations

import pytest

from toytaklif.common import Refused
from toytaklif.core import qrtoken

from .helpers import ADMIN, CHECKER, DECLINE, FAMILY, GUEST, HOST, HOST2, SECRET, STRANGER, link, service_env, wedding_day


async def test_invitation_by_link_and_no_enumeration():
    async with service_env() as (svc, _):
        token = await link(svc, FAMILY)
        assert len(token) == 22
        page = await svc.invitation(token)
        assert page["invite"]["name"] == "Karimovlar oilasi" and page["pass"] is None
        assert "host_token" not in page["wedding"] and "token" not in page["invite"]
        assert len(page["wishes"]) == 3  # approved only, the pending one stays hidden
        for bad in (token[:-1] + ("A" if token[-1] != "A" else "B"), token.lower(), "", "x" * 22, None, 5, token + "="):
            with pytest.raises(Refused, match="not_found"):
                await svc.invitation(bad)


async def test_rsvp_yes_gives_a_pass_and_a_change_kills_the_old_one():
    async with service_env() as (svc, _):
        token = await link(svc, FAMILY)
        page, ev = await svc.answer(token, {"status": "yes", "people": 3, "wish": "Baxtli bo'ling!"})
        assert ev["changed"] and ev["wish"] and page["invite"]["version"] == 2
        first = page["pass"]["token"]
        assert qrtoken.verify(SECRET, first)["people"] == 3
        page, ev = await svc.answer(token, {"status": "yes", "people": 2})
        assert page["pass"]["token"] != first and not ev["wish"]
        page, _ = await svc.answer(token, {"status": "no"})
        assert page["pass"] is None
        with pytest.raises(Refused, match="people"):
            await svc.answer(token, {"status": "yes", "people": 4})


async def test_deadline_and_wish_moderation():
    async with service_env() as (svc, clock):
        token = await link(svc, FAMILY)
        await svc.answer(token, {"status": "yes", "people": 3, "wish": "<img src=x onerror=alert(1)>"})
        dash = await svc.dashboard(HOST, 1)
        wish = next(p for p in dash["pending"] if p["name"] == "Karimovlar oilasi")
        await svc.decide_wish(HOST, 1, wish["id"], "approve")
        page = await svc.invitation(token)
        assert page["wishes"][0] == {"name": "Karimovlar oilasi", "text": "<img src=x onerror=alert(1)>"}
        with pytest.raises(Refused, match="not_found"):
            await svc.decide_wish(STRANGER, 1, wish["id"], "hide")
        w = await svc.wedding(1)
        clock.to(w["rsvp_deadline"] + 1)
        with pytest.raises(Refused, match="deadline"):
            await svc.answer(token, {"status": "no"})
        assert (await svc.invitation(token))["open"] is False


async def test_hosts_only_see_their_own_wedding():
    async with service_env() as (svc, _):
        for uid in (STRANGER, GUEST, CHECKER):
            for call in (svc.dashboard(uid, 1), svc.invite_links(uid, 1), svc.export_csv(uid, 1), svc.remind(uid, 1),
                         svc.broadcast(uid, 1, "Salom hammaga"), svc.settings(uid, 1, {"theme": "bahor"}),
                         svc.add_invites(uid, 1, [{"name": "Ali Vali", "seats": 2, "side": "kuyov"}])):
                with pytest.raises(Refused, match="not_found"):
                    await call
        assert (await svc.dashboard(HOST2, 1))["summary"]["invites"] == 80


async def test_dashboard_counts_move_with_answers():
    async with service_env() as (svc, _):
        before = (await svc.dashboard(HOST, 1))["summary"]
        await svc.answer(await link(svc, FAMILY), {"status": "yes", "people": 3})
        await svc.answer(await link(svc, DECLINE), {"status": "no"})
        after = await svc.dashboard(HOST, 1)
        s = after["summary"]
        assert s["people"] == before["people"] + 3 and s["no"] == before["no"] + 1 and s["none"] == before["none"] - 2
        assert s["sides"]["kuyov"]["people"] == before["sides"]["kuyov"]["people"] + 3
        assert after["latest"][0]["name"] in ("Rustam Nazarov", "Karimovlar oilasi")
        assert after["rev"] > 0


async def test_reminders_once_per_24_hours():
    async with service_env() as (svc, clock):
        first = await svc.remind(HOST, 1)
        assert first and all(x["status"] in ("none", "maybe") and x["tg"] for x in first)
        assert await svc.remind(HOST2, 1) == []
        clock.skip(hours=23)
        assert await svc.remind(HOST, 1) == []
        clock.skip(hours=1)
        assert len(await svc.remind(HOST, 1)) == len(first)


async def test_import_export_broadcast_settings():
    async with service_env() as (svc, _):
        res = await svc.import_csv(HOST2, 1, "Ism;Joy;Tomon;Guruh\nAliyevlar oilasi;4;;Do'stlar\nX;1\n=Hack;2;kuyov\n")
        assert [r["side"] for r in res["added"]] == ["kelin", "kuyov"] and res["errors"] == [{"line": 3, "code": "name"}]
        csv = await svc.export_csv(HOST, 1)
        assert "'=Hack" in csv and csv.startswith("﻿Mehmon,")
        await svc.answer(await link(svc, FAMILY), {"status": "yes", "people": 3})
        body, rows = await svc.broadcast(HOST, 1, "  To'yxona kirish eshigi o'zgardi  ")
        assert body == "To'yxona kirish eshigi o'zgardi" and any(r["id"] == FAMILY for r in rows)
        assert (await svc.invitation(await link(svc, FAMILY)))["news"]["text"] == body
        w = await svc.settings(HOST, 1, {"theme": "bahor", "music": "none", "location": [41.3, 69.25]})
        assert (w["theme"], w["music"], w["lat"]) == ("bahor", "none", 41.3)
        with pytest.raises(Refused):
            await svc.settings(HOST, 1, {"theme": "neon"})


async def test_door_full_partial_used_forged_and_old_version():
    async with service_env() as (svc, clock):
        token = await link(svc, FAMILY)
        page, _ = await svc.answer(token, {"status": "yes", "people": 3})
        qr = page["pass"]["token"]
        assert (await svc.checkin(CHECKER, 1, qr))["result"] == "not_today"
        await wedding_day(svc, clock)
        ok = await svc.checkin(CHECKER, 1, qr, 2)
        assert (ok["result"], ok["people"], ok["left"]) == ("ok", 2, 1)
        ok = await svc.checkin(CHECKER, 1, page["pass"]["code"].lower())
        assert (ok["result"], ok["people"], ok["arrived"]) == ("ok", 1, 3)
        used = await svc.checkin(CHECKER, 1, qr)
        assert used["result"] == "used" and used["at"] == ok["at"]
        assert (await svc.checkin(CHECKER, 1, qr.replace(".3.2.", ".5.2.")))["result"] == "bad"
        assert (await svc.checkin(CHECKER, 1, "hello"))["result"] == "bad"
        with pytest.raises(Refused, match=r"deadline|checked_in"):
            await svc.answer(token, {"status": "no"})
        with pytest.raises(Refused, match="not_found"):
            await svc.checkin(STRANGER, 1, qr)
        with pytest.raises(Refused, match="not_found"):
            await svc.dashboard(CHECKER, 1)  # a checker can only check in


async def test_old_pass_after_a_changed_answer_is_refused():
    async with service_env() as (svc, clock):
        token = await link(svc, FAMILY)
        page, _ = await svc.answer(token, {"status": "yes", "people": 3})
        old = page["pass"]
        page, _ = await svc.answer(token, {"status": "yes", "people": 2})
        await wedding_day(svc, clock)
        assert (await svc.checkin(CHECKER, 1, old["token"]))["result"] == "bad"
        assert (await svc.checkin(CHECKER, 1, old["code"]))["result"] == "bad"
        assert (await svc.checkin(CHECKER, 1, page["pass"]["token"]))["people"] == 2


async def test_bind_join_and_admin():
    async with service_env() as (svc, _):
        token = await link(svc, 5)
        inv = await svc.bind(token, 5555)
        assert inv["tg"] in (5555, 6005)
        w = await svc.wedding(1)
        _, side = await svc.join(7001, w["host_token"], "host")
        assert side in ("kuyov", "kelin")
        await svc.join(7002, w["checker_token"], "checker")
        assert (await svc.door_status(7002, 1))["people"] >= 0
        with pytest.raises(Refused):
            await svc.join(7003, "x" * 22, "host")
        assert (await svc.admin_weddings(ADMIN))[0]["invites"] == 80
        await svc.admin_block(ADMIN, 1, True)
        with pytest.raises(Refused, match="not_found"):
            await svc.invitation(await link(svc, FAMILY))
        with pytest.raises(Refused, match="not_found"):
            await svc.admin_weddings(HOST)


async def test_create_wedding_rules():
    async with service_env() as (svc, _):
        w = await svc.create_wedding(STRANGER, {"couple": "Jasur va Laylo", "date": "05.01.2027", "time": "17:30",
                                                "venue": "Navbahor", "address": "Yunusobod, 4-kvartal", "capacity": "150",
                                                "side": "kelin"})
        assert (w["groom"], w["bride"], w["capacity"]) == ("Jasur", "Laylo", 150)
        assert (await svc.require_host(STRANGER, w["id"]))["my_side"] == "kelin"
        for bad, code in ((dict(couple="Jasur"), "couple"), (dict(date="31.02.2027"), "date"), (dict(date="01.01.2020"), "past"),
                          (dict(time="25:00"), "time"), (dict(capacity="5"), "capacity")):
            base = {"couple": "Ali va Bonu", "date": "05.01.2027", "time": "18:00", "venue": "Zal", "address": "Ko'cha 1",
                    "capacity": "100", "side": "kuyov"}
            with pytest.raises(Refused, match=code):
                await svc.create_wedding(STRANGER, {**base, **bad})
