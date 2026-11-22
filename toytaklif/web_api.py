"""The Mini App's API (signed initData, see web.py): the caller's roles, the hosts' live dashboard and tools, and
the door. Every route takes the wedding id from the URL and the user from the verified initData; the service
checks the role, so another wedding's id answers "not_found"."""

from __future__ import annotations

from aiohttp import web

from .common import Refused
from .web import body

ID = r"{wid:\d{1,9}}"


def _wid(request: web.Request) -> int:
    return int(request.match_info["wid"])


def add_routes(r: web.UrlDispatcher, service, me_key, notify) -> None:
    async def me(request: web.Request) -> web.Response:
        uid = request[me_key]
        user = await service.user(uid)
        guest = [{"id": x["id"], "token": x["token"], "name": x["name"], "wedding_id": x["wedding_id"]}
                 for x in await service.guest_invites(uid)]
        hosted = [{"id": w["id"], "groom": w["groom"], "bride": w["bride"]} for w in await service.hosted(uid)]
        door = [{"id": w["id"], "groom": w["groom"], "bride": w["bride"]} for w in await service.checking(uid)]
        return web.json_response({"id": uid, "lang": user["lang"], "guest": guest, "host": hosted, "door": door,
                                  "now": service.now()})

    async def lang(request: web.Request) -> web.Response:
        d = await body(request)
        await service.set_lang(request[me_key], d.get("lang"))
        return web.json_response({"lang": d["lang"]})

    async def dashboard(request: web.Request) -> web.Response:
        uid, wid = request[me_key], _wid(request)
        since = request.query.get("rev", "")
        if since.isdigit() and len(since) < 12 and int(since) == await service.rev(uid, wid):
            return web.json_response({"same": True, "rev": int(since)})
        return web.json_response(await service.dashboard(uid, wid))

    async def invites(request: web.Request) -> web.Response:
        return web.json_response({"items": await service.invite_links(request[me_key], _wid(request))})

    async def add_invite(request: web.Request) -> web.Response:
        d = await body(request)
        added = await service.add_invites(request[me_key], _wid(request), [d.get("invite")])
        return web.json_response(added[0])

    async def wish(request: web.Request) -> web.Response:
        d = await body(request)
        action = d.get("action")
        if action not in ("approve", "hide"):
            raise Refused("generic")
        wish_id = int(request.match_info["id"])
        return web.json_response(await service.decide_wish(request[me_key], _wid(request), wish_id, action))

    async def remind(request: web.Request) -> web.Response:
        wid = _wid(request)
        rows = await service.remind(request[me_key], wid)
        await notify("remind", wid, rows)
        return web.json_response({"sent": len(rows)})

    async def broadcast(request: web.Request) -> web.Response:
        d = await body(request)
        wid = _wid(request)
        text, rows = await service.broadcast(request[me_key], wid, d.get("text"))
        await notify("broadcast", wid, rows, text)
        return web.json_response({"sent": len(rows), "text": text})

    async def settings(request: web.Request) -> web.Response:
        d = await body(request)
        changes = d.get("changes")
        if not isinstance(changes, dict) or len(changes) > 4:
            raise Refused("generic")
        w = await service.settings(request[me_key], _wid(request), changes)
        return web.json_response({k: w[k] for k in ("theme", "music", "dress", "lat", "lon")})

    async def export(request: web.Request) -> web.Response:
        uid, wid = request[me_key], _wid(request)
        csv = await service.export_csv(uid, wid)
        await notify("export", uid, wid, csv)
        return web.json_response({"sent": True})

    async def door(request: web.Request) -> web.Response:
        return web.json_response(await service.door_status(request[me_key], _wid(request)))

    async def checkin(request: web.Request) -> web.Response:
        d = await body(request)
        code = d.get("code")
        if not isinstance(code, str) or len(code) > 80:
            raise Refused("generic")
        res = await service.checkin(request[me_key], _wid(request), code, d.get("people"))
        return web.json_response({k: v for k, v in res.items() if k != "invite_id"})

    r.add_get("/api/me", me)
    r.add_post("/api/lang", lang)
    r.add_get(f"/api/host/{ID}", dashboard)
    r.add_get(f"/api/host/{ID}/invites", invites)
    r.add_post(f"/api/host/{ID}/invites", add_invite)
    r.add_post(f"/api/host/{ID}/wishes/" + r"{id:\d{1,9}}", wish)
    r.add_post(f"/api/host/{ID}/remind", remind)
    r.add_post(f"/api/host/{ID}/broadcast", broadcast)
    r.add_post(f"/api/host/{ID}/settings", settings)
    r.add_post(f"/api/host/{ID}/export", export)
    r.add_get(f"/api/door/{ID}", door)
    r.add_post(f"/api/door/{ID}/checkin", checkin)
