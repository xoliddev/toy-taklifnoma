"""Two doors, two processes' worth of connections, the same pass scanned at the same moment: let in exactly once."""

from __future__ import annotations

import asyncio

from toytaklif.db import Database
from toytaklif.service import Service

from .helpers import ADMIN, CHECKER, FAMILY, HOST, HOST2, SECRET, Clock, link, service_env, wedding_day


async def two_doors(tmp_path):
    clock = Clock()
    path = str(tmp_path / "toy.db")
    async with service_env(clock, path) as (svc, _):
        page, _ = await svc.answer(await link(svc, FAMILY), {"status": "yes", "people": 3})
        await wedding_day(svc, clock)
        other = Service(await Database.open(path), SECRET, clock=clock, admins=frozenset({ADMIN}))
        try:
            yield svc, other, page["pass"]
        finally:
            await other.db.close()


async def test_same_pass_on_two_doors_at_once(tmp_path):
    async for svc, other, p in two_doors(tmp_path):
        attempts = [door.checkin(CHECKER, 1, p["token"] if k % 2 else p["code"]) for k in range(12) for door in (svc, other)]
        results = await asyncio.gather(*attempts)
        ok = [r for r in results if r["result"] == "ok"]
        assert len(ok) == 1 and ok[0]["people"] == 3
        assert all(r["result"] == "used" for r in results if r["result"] != "ok")
        row = await svc.db.one("SELECT checked_in FROM invites WHERE id = ?", (FAMILY,))
        assert row["checked_in"] == 3
        n = await svc.db.one("SELECT COUNT(*) AS n, SUM(people) AS p FROM checkins WHERE invite_id = ?", (FAMILY,))
        assert (n["n"], n["p"]) == (1, 3)


async def test_partial_arrivals_racing_never_exceed_the_head_count(tmp_path):
    async for svc, other, p in two_doors(tmp_path):
        results = await asyncio.gather(*[door.checkin(CHECKER, 1, p["token"], 2) for door in (svc, other, svc, other)])
        let_in = sum(r["people"] for r in results if r["result"] == "ok")
        assert let_in == 3
        assert sorted(r["people"] for r in results if r["result"] == "ok") == [1, 2]
        assert sum(r["result"] == "used" for r in results) == 2


async def test_two_hosts_reminding_at_once_send_each_reminder_once(tmp_path):
    async for svc, other, _ in two_doors(tmp_path):
        a, b = await asyncio.gather(svc.remind(HOST, 1), other.remind(HOST2, 1))
        ids_a, ids_b = {x["id"] for x in a}, {x["id"] for x in b}
        assert not ids_a & ids_b and len(ids_a | ids_b) > 10
