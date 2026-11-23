"""HTTP: the public invitation (link only, 404 for anything wrong, per-IP limits, CSP), the Mini App API (initData
HMAC + freshness, hosts only for their own wedding, checker only at the door), and strict input checks."""

from __future__ import annotations

import json
from contextlib import asynccontextmanager

from aiohttp.test_utils import TestClient, TestServer

from toytaklif.security import sign_init_data
from toytaklif.web import make_app

from .helpers import CHECKER, FAMILY, GUEST, HOST, STRANGER, link, service_env, wedding_day

TOKEN = "123456:TEST-ONLY-NOT-A-REAL-TOKEN"


class Spy:
    def __init__(self) -> None:
        self.calls: list[tuple] = []

    def __getattr__(self, name):
        async def record(*args):
            self.calls.append((name, *args))
        return record


def init_data(uid: int, clock, age: int = 0, token: str = TOKEN) -> str:
    fields = {"auth_date": str(clock() // 1000 - age), "query_id": "AAE-test",
              "user": json.dumps({"id": uid, "first_name": f"U{uid}", "language_code": "uz"})}
    return sign_init_data(fields, token)


@asynccontextmanager
async def api(rate: int = 1000, public: int = 1000):
    async with service_env() as (svc, clock):
        spy = Spy()
        client = TestClient(TestServer(make_app(svc, TOKEN, spy, 3600, rate, public)))
        await client.start_server()

        def h(uid: int, age: int = 0, token: str = TOKEN) -> dict:
            return {"Authorization": "tma " + init_data(uid, clock, age, token)}

        try:
            yield client, svc, clock, h, spy
        finally:
            await client.close()


async def test_public_page_and_api_by_link_only():
    async with api() as (c, svc, _, _, spy):
        token = await link(svc, FAMILY)
        page = await c.get(f"/i/{token}")
        assert page.status == 200 and "<html" in await page.text()
        csp = page.headers["Content-Security-Policy"]
        assert "default-src 'self'" in csp and "object-src 'none'" in csp and page.headers["Cache-Control"] == "no-store"
        for bad in ("x" * 22, token[:-1] + ("B" if token[-1] == "A" else "A"), "short", "A" * 23):
            assert (await c.get(f"/i/{bad}")).status == 404
            assert (await c.get(f"/api/public/invite/{bad}")).status == 404
        data = await (await c.get(f"/api/public/invite/{token}")).json()
        assert data["invite"]["name"] == "Karimovlar oilasi" and "token" not in data["invite"]
        assert "host_token" not in json.dumps(data) and "checker_token" not in json.dumps(data)
        r = await c.post(f"/api/public/invite/{token}/rsvp", json={"status": "yes", "people": 3, "wish": "Tabrik!"})
        out = await r.json()
        assert r.status == 200 and out["pass"]["token"].startswith("TT1.1.1.3.")
        assert [k[0] for k in spy.calls] == ["answered", "qr", "wish"]


async def test_public_validation_and_rate_limit():
    async with api(public=6) as (c, svc, _, _, _):
        token = await link(svc, FAMILY)
        url = f"/api/public/invite/{token}/rsvp"
        for payload, code in (({"status": "yes", "people": 9}, "people"), ({"status": "yes", "people": 2.5}, "people"),
                              ({"status": "sure"}, "status"), ([1, 2], "generic")):
            r = await c.post(url, json=payload)
            assert r.status == 400 and (await r.json())["error"] == code
        assert (await c.post(url, data="not json", headers={"Content-Type": "application/json"})).status == 400
        assert (await c.post(url, json={"status": "no", "note": "x" * 20_000})).status == 413  # body cap
        assert (await c.get(f"/api/public/invite/{token}")).status == 429


async def test_mini_app_auth_and_roles():
    async with api() as (c, svc, _clock, h, _):
        assert (await c.get("/api/me")).status == 401
        assert (await c.get("/api/me", headers=h(HOST, token="999:WRONG-TEST-ONLY"))).status == 401
        assert (await c.get("/api/me", headers=h(HOST, age=4000))).status == 401
        assert (await c.get("/api/me", headers=h(HOST, age=-600))).status == 401
        me = await (await c.get("/api/me", headers=h(HOST))).json()
        assert me["host"][0]["id"] == 1 and me["guest"] == []
        guest = await (await c.get("/api/me", headers=h(GUEST))).json()
        assert guest["guest"][0]["token"] == await link(svc, FAMILY)
        for uid in (STRANGER, CHECKER, GUEST):
            for method, path, body in (("GET", "/api/host/1", None), ("GET", "/api/host/1/invites", None),
                                       ("POST", "/api/host/1/remind", {}), ("POST", "/api/host/1/export", {}),
                                       ("POST", "/api/host/1/broadcast", {"text": "Salom"}),
                                       ("POST", "/api/host/1/settings", {"changes": {"theme": "bahor"}}),
                                       ("POST", "/api/host/1/wishes/1", {"action": "approve"})):
                r = await c.request(method, path, json=body, headers=h(uid))
                assert r.status == 404, (uid, path)
        assert (await c.get("/api/door/1", headers=h(STRANGER))).status == 404
        door = await (await c.get("/api/door/1", headers=h(CHECKER))).json()
        assert set(door) == {"id", "groom", "bride", "starts_at", "arrived", "people", "now"}
        assert (await c.get("/api/host/999", headers=h(HOST))).status == 404


async def test_dashboard_live_rev_and_door():
    async with api() as (c, svc, clock, h, spy):
        d = await (await c.get("/api/host/1", headers=h(HOST))).json()
        same = await (await c.get(f"/api/host/1?rev={d['rev']}", headers=h(HOST))).json()
        assert same == {"same": True, "rev": d["rev"]}
        token = await link(svc, FAMILY)
        out = await (await c.post(f"/api/public/invite/{token}/rsvp", json={"status": "yes", "people": 3})).json()
        d2 = await (await c.get(f"/api/host/1?rev={d['rev']}", headers=h(HOST))).json()
        assert d2["summary"]["people"] == d["summary"]["people"] + 3
        r = await c.post("/api/host/1/remind", json={}, headers=h(HOST))
        assert (await r.json())["sent"] > 0 and spy.calls[-1][0] == "remind"
        await wedding_day(svc, clock)
        res = await (await c.post("/api/door/1/checkin", json={"code": out["pass"]["token"], "people": 2},
                                  headers=h(CHECKER))).json()
        assert (res["result"], res["people"], res["left"]) == ("ok", 2, 1) and "invite_id" not in res
        bad = await c.post("/api/door/1/checkin", json={"code": out["pass"]["token"], "people": True}, headers=h(CHECKER))
        assert bad.status == 400
        res = await (await c.post("/api/door/1/checkin", json={"code": "TT1.1.1.3.2.forgedforgedforgedforg"},
                                  headers=h(CHECKER))).json()
        assert res == {"result": "bad"}


async def test_static_and_health():
    async with api() as (c, *_):
        assert (await c.get("/healthz")).status == 200
        r = await c.get("/webapp/index.html")
        root = await c.get("/webapp/")  # the address the bot opens
        assert root.status == 200 and "<html" in (await root.text()).lower()
        assert r.status == 200 and r.headers["X-Content-Type-Options"] == "nosniff"
        assert (await c.get("/shared/locales/uz.json")).status == 200
