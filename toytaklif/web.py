"""aiohttp server: the public invitation page, the Mini App's static files and the JSON APIs.

* ``/i/<link>`` is the invitation website. Its API (``/api/public/...``) is reached with the link alone and is
  rate-limited per IP; a wrong link is a plain 404, the same as an unknown one.
* ``/api/...`` (the Mini App) must carry ``Authorization: tma <initData>``; the HMAC and ``auth_date`` are checked,
  then the call runs *as* that Telegram user through the same Service the bot uses (see web_api.py).
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

from aiohttp import web

from .common import LINK, Refused
from .security import AuthError, RateLimiter, validate_init_data
from .service import Service

log = logging.getLogger(__name__)
ME = web.RequestKey("me", int)
ROOT = Path(__file__).resolve().parent.parent
MAX_BODY = 16 * 1024
CSP = ("default-src 'self'; script-src 'self' https://telegram.org; style-src 'self' 'unsafe-inline'; "
       "img-src 'self' data: https://tile.openstreetmap.org; connect-src 'self'; media-src 'self' blob:; "
       "frame-ancestors 'self' https://web.telegram.org https://*.telegram.org; base-uri 'none'; form-action 'none'; "
       "object-src 'none'")
HEADERS = {"Content-Security-Policy": CSP, "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
           "Permissions-Policy": "camera=(self), microphone=(), geolocation=()", "Cross-Origin-Opener-Policy": "same-origin"}
STATUS = {"forbidden": 403, "not_found": 404, "auth": 401, "rate": 429}


async def body(request: web.Request) -> dict:
    try:
        data = await request.json()
    except (json.JSONDecodeError, UnicodeDecodeError) as err:
        raise Refused("generic") from err
    if not isinstance(data, dict) or len(data) > 24:
        raise Refused("generic")
    return data


def client_ip(request: web.Request, trust_proxy: bool) -> str:
    if trust_proxy:
        fwd = request.headers.get("X-Forwarded-For", "")
        if fwd:
            return fwd.split(",")[0].strip()[:64]
    return request.remote or "?"


def make_app(service: Service, bot_token: str, notifier=None, max_age: int = 3600, rate_per_minute: int = 60,
             public_rate: int = 40, trust_proxy: bool = False) -> web.Application:
    from .web_api import add_routes

    users, ips = RateLimiter(rate_per_minute), RateLimiter(public_rate)

    @web.middleware
    async def guard(request: web.Request, handler):
        try:
            if request.path.startswith(("/api/public/", "/i/")):
                if not ips.allow(client_ip(request, trust_proxy)):
                    raise Refused("rate")
            elif request.path.startswith("/api/"):
                header = request.headers.get("Authorization", "")
                if not header.startswith("tma "):
                    raise AuthError("missing")
                user = validate_init_data(header[4:], bot_token, max_age, now=service.now() / 1000)
                if not users.allow(user["id"]):
                    raise Refused("rate")
                await service.touch_user(user["id"], user["first_name"], user["language_code"])
                request[ME] = user["id"]
            resp = await handler(request)
        except AuthError:
            resp = web.json_response({"error": "auth"}, status=401)
        except Refused as err:
            if request.path.startswith("/i/"):
                resp = web.Response(text="404: not found", status=STATUS.get(err.code, 404))
            else:
                resp = web.json_response({"error": err.code}, status=STATUS.get(err.code, 400))
        resp.headers.update(HEADERS)
        if request.path.startswith(("/api/", "/i/")):
            resp.headers["Cache-Control"] = "no-store"
        return resp

    async def notify(kind: str, *args) -> None:
        if notifier is not None:
            try:
                await getattr(notifier, kind)(*args)
            except Exception:  # a failed message never fails the guest's answer
                log.exception("notify %s failed", kind)

    async def after_answer(event: dict) -> None:
        if event["changed"]:
            await notify("answered", event)
            if event["invite"]["status"] == "yes":
                await notify("qr", event["invite"])
        if event["wish"]:
            await notify("wish", event)

    async def page(request: web.Request) -> web.FileResponse:
        token = request.match_info["token"]
        if not LINK.match(token):
            raise Refused("not_found")
        await service.by_link(token)
        return web.FileResponse(ROOT / "webapp" / "invite.html")

    async def public_invite(request: web.Request) -> web.Response:
        return web.json_response(await service.invitation(request.match_info["token"]))

    async def public_rsvp(request: web.Request) -> web.Response:
        view, event = await service.answer(request.match_info["token"], await body(request))
        await after_answer(event)
        return web.json_response(view)

    async def health(_: web.Request) -> web.Response:
        return web.json_response({"ok": True})

    async def index(_: web.Request) -> web.Response:
        raise web.HTTPFound("/webapp/")

    app = web.Application(middlewares=[guard], client_max_size=MAX_BODY)
    r = app.router
    r.add_get(r"/i/{token}", page)
    r.add_get(r"/api/public/invite/{token}", public_invite)
    r.add_post(r"/api/public/invite/{token}/rsvp", public_rsvp)
    add_routes(r, service, ME, notify)
    r.add_get("/healthz", health)
    r.add_get("/", index)
    r.add_static("/webapp/", ROOT / "webapp", append_version=False)
    r.add_static("/shared/", ROOT / "shared", append_version=False)
    return app
