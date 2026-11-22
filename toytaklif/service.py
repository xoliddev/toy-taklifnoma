"""The rules, shared by the bot, the Mini App API and the public invitation page. Guests live here; the hosts' tools
are in hosts.py and the door in door.py.

A guest is whoever holds an invite link (128 random bits). Links are looked up by their SHA-256 and compared in
constant time; a wrong, unknown or blocked link is always the same "not_found", so nothing can be enumerated.
"""

from __future__ import annotations

import hmac
import time
from collections.abc import Callable

from .common import LINK, Refused, link_hash, new_link
from .core import qrtoken, rsvp
from .core.text import InputError, clean
from .db import Database, invite_row, wedding_row
from .door import DoorMixin
from .hosts import HostMixin
from .i18n import norm_lang

PUBLIC_WEDDING = ("id", "groom", "bride", "starts_at", "rsvp_deadline", "venue", "address", "lat", "lon", "theme",
                  "music", "dress", "program")
PUBLIC_INVITE = ("id", "name", "seats", "side", "status", "people", "note", "version", "checked_in", "lang")


def pick(row: dict, keys: tuple) -> dict:
    return {k: row[k] for k in keys}


class Service(HostMixin, DoorMixin):
    def __init__(self, db: Database, secret: bytes, clock: Callable[[], int] | None = None,
                 admins: frozenset[int] = frozenset()) -> None:
        if len(secret) < 32:
            raise ValueError("QR_SECRET must be at least 32 bytes")
        self.db, self.secret, self.admins = db, secret, admins
        self.now = clock or (lambda: int(time.time() * 1000))

    # ── users ──
    async def touch_user(self, uid: int, name: str, lang: str | None) -> dict:
        await self.db.run("INSERT INTO users (id, name, lang, created_at) VALUES (?, ?, ?, ?) "
                          "ON CONFLICT(id) DO UPDATE SET name = excluded.name",
                          (uid, clean(name, 64) or "—", norm_lang(lang), self.now()))
        return await self.user(uid)

    async def user(self, uid: int) -> dict | None:
        return await self.db.one("SELECT * FROM users WHERE id = ?", (uid,))

    async def set_lang(self, uid: int, lang: str) -> None:
        if lang not in ("uz", "ru"):
            raise Refused("generic")
        await self.db.run("UPDATE users SET lang = ? WHERE id = ?", (lang, uid))

    # ── lookups ──
    async def wedding(self, wid: int) -> dict:
        row = await self.db.one("SELECT * FROM weddings WHERE id = ?", (wid,))
        if not row:
            raise Refused("not_found")
        return wedding_row(row)

    async def invite(self, iid: int) -> dict:
        row = await self.db.one("SELECT * FROM invites WHERE id = ?", (iid,))
        if not row:
            raise Refused("not_found")
        return invite_row(row)

    async def by_link(self, token: object) -> tuple[dict, dict]:
        """(invite, wedding) for a guest link; anything wrong is "not_found"."""
        if not isinstance(token, str) or not LINK.match(token):
            raise Refused("not_found")
        row = await self.db.one("SELECT * FROM invites WHERE token_hash = ?", (link_hash(token),))
        if not row or not hmac.compare_digest(row["token"], token):
            raise Refused("not_found")
        w = await self.wedding(row["wedding_id"])
        if w["status"] != "active":
            raise Refused("not_found")
        return invite_row(row), w

    def pass_for(self, inv: dict) -> dict | None:
        if inv["status"] != "yes" or inv["people"] < 1:
            return None
        return {"token": qrtoken.sign(self.secret, inv["wedding_id"], inv["id"], inv["people"], inv["version"]),
                "code": qrtoken.entry_code(self.secret, inv["id"], inv["version"])}

    async def invitation(self, token: object) -> dict:
        """Everything the invitation page shows for one link."""
        inv, w = await self.by_link(token)
        return await self.view(inv, w)

    async def view(self, inv: dict, w: dict) -> dict:
        now = self.now()
        wish = await self.db.one("SELECT text, status FROM wishes WHERE invite_id = ?", (inv["id"],))
        wishes = await self.db.all(
            "SELECT i.name, w.text FROM wishes w JOIN invites i ON i.id = w.invite_id "
            "WHERE w.wedding_id = ? AND w.status = 'approved' ORDER BY w.decided_at DESC, w.id DESC LIMIT 30", (w["id"],))
        news = await self.db.one("SELECT text, created_at AS at FROM broadcasts WHERE wedding_id = ? "
                                 "ORDER BY id DESC LIMIT 1", (w["id"],))
        return {"wedding": pick(w, PUBLIC_WEDDING), "invite": pick(inv, PUBLIC_INVITE), "wish": wish,
                "wishes": wishes, "news": news, "pass": self.pass_for(inv),
                "open": now <= w["rsvp_deadline"] and inv["checked_in"] == 0, "now": now}

    # ── answers ──
    async def answer(self, token: object, data: object) -> tuple[dict, dict]:
        inv, w = await self.by_link(token)
        return await self._answer(inv, w, data)

    async def answer_as(self, uid: int, iid: int, data: object) -> tuple[dict, dict]:
        """From the bot: only for an invite this Telegram user opened."""
        inv = await self.invite(iid)
        if inv["tg"] != uid:
            raise Refused("not_found")
        w = await self.wedding(inv["wedding_id"])
        if w["status"] != "active":
            raise Refused("not_found")
        return await self._answer(inv, w, data)

    async def _answer(self, inv: dict, w: dict, data: object) -> tuple[dict, dict]:
        now = self.now()
        async with self.db.tx() as c:
            cur = invite_row(dict(await (await c.execute("SELECT * FROM invites WHERE id = ?", (inv["id"],))).fetchone()))
            try:
                a = rsvp.validate(data, cur, w, now)
            except InputError as err:
                raise Refused(err.code) from err
            new = rsvp.apply(cur, a, now)
            code = qrtoken.entry_code(self.secret, new["id"], new["version"])
            await c.execute("UPDATE invites SET status = ?, people = ?, note = ?, answered_at = ?, version = ?, "
                            "entry_code = ? WHERE id = ? AND checked_in = 0",
                            (new["status"], new["people"], new["note"], now, new["version"], code, new["id"]))
            wish_new = False
            if a["wish"]:
                old = await (await c.execute("SELECT text FROM wishes WHERE invite_id = ?", (new["id"],))).fetchone()
                if not old or old[0] != a["wish"]:
                    await c.execute("INSERT INTO wishes (invite_id, wedding_id, text, created_at) VALUES (?, ?, ?, ?) "
                                    "ON CONFLICT(invite_id) DO UPDATE SET text = excluded.text, status = 'pending', "
                                    "created_at = excluded.created_at, decided_at = NULL",
                                    (new["id"], w["id"], a["wish"], now))
                    wish_new = True
            await c.execute("UPDATE weddings SET rev = rev + 1 WHERE id = ?", (w["id"],))
        event = {"wedding_id": w["id"], "invite": new, "before": (cur["status"], cur["people"]),
                 "changed": (cur["status"], cur["people"]) != (new["status"], new["people"]), "wish": wish_new}
        return await self.view(new, w), event

    async def bind(self, token: object, uid: int) -> dict:
        """A deep link ``start=<link>``: the first Telegram user to open it gets the bot reminders and the QR."""
        inv, _ = await self.by_link(token)
        await self.db.run("UPDATE invites SET tg_user_id = ? WHERE id = ? AND tg_user_id IS NULL", (uid, inv["id"]))
        return await self.invite(inv["id"])

    async def guest_invites(self, uid: int) -> list[dict]:
        rows = await self.db.all("SELECT i.* FROM invites i JOIN weddings w ON w.id = i.wedding_id "
                                 "WHERE i.tg_user_id = ? AND w.status = 'active' ORDER BY w.starts_at", (uid,))
        return [invite_row(r) for r in rows]

    # ── seed ──
    async def seed(self, world: dict) -> bool:
        """Fill an empty database with the fictional demo wedding. Returns False when data already exists."""
        if await self.db.one("SELECT 1 FROM weddings LIMIT 1"):
            return False
        now = self.now()
        w = {**world["wedding"], "host_token": new_link(), "checker_token": new_link(),
             "created_by": world["hosts"][0]["user_id"], "created_at": now}
        async with self.db.tx() as c:
            for u in world["users"]:
                await c.execute("INSERT OR IGNORE INTO users (id, name, created_at) VALUES (?, ?, ?)",
                                (u["id"], u["name"], now))
            wid = await self.db.insert_wedding(c, w)
            for h in world["hosts"]:
                await c.execute("INSERT INTO hosts (wedding_id, user_id, side) VALUES (?, ?, ?)", (wid, h["user_id"], h["side"]))
            for uid in world["checkers"]:
                await c.execute("INSERT INTO checkers (wedding_id, user_id) VALUES (?, ?)", (wid, uid))
            for x in world["invites"]:
                link = new_link()
                await c.execute(
                    "INSERT INTO invites (id, wedding_id, token, token_hash, name, seats, side, grp, status, people, "
                    "answered_at, version, entry_code, tg_user_id, lang, created_at) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (x["id"], wid, link, link_hash(link), x["name"], x["seats"], x["side"], x["grp"], x["status"],
                     x["people"], x["answered_at"], x["version"], qrtoken.entry_code(self.secret, x["id"], x["version"]),
                     x["tg"], x["lang"], now))
            for k in world["wishes"]:
                await c.execute("INSERT INTO wishes (invite_id, wedding_id, text, status, created_at, decided_at) "
                                "VALUES (?, ?, ?, ?, ?, ?)", (k["invite_id"], wid, k["text"], k["status"], k["created_at"],
                                                             k["created_at"] if k["status"] != "pending" else None))
        return True
