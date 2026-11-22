"""The hosts' tools. Every method takes the caller's Telegram id and first checks that they host *this* wedding;
anyone else gets "not_found" (the same answer as for a wedding that does not exist)."""

from __future__ import annotations

import hmac
import re

from .common import Refused, link_hash, new_link
from .core import guestlist, qrtoken, rsvp, stats
from .core.clock import DAY_MS, at_local, civil, local_day
from .core.text import InputError, clean
from .db import invite_row

MAX_INVITES, MAX_WEDDINGS, BROADCAST_MAX = 1000, 5, 500
THEMES, MUSIC, DRESS = ("milliy", "oltin", "bahor"), ("soft", "none"), ("milliy", "bayram", "oq", "erkin")
DEFAULT_PROGRAM = [{"at": 1080, "key": "welcome"}, {"at": 1110, "key": "entrance"}, {"at": 1140, "key": "feast"},
                   {"at": 1230, "key": "cake"}, {"at": 1350, "key": "farewell"}]
_COUPLE = re.compile(r"^\s*(.{2,30}?)\s*(?:\bva\b|\bи\b|&|\+|,)\s*(.{2,30}?)\s*$", re.IGNORECASE)
_DATE = re.compile(r"^\s*([0-9]{1,2})[./-]([0-9]{1,2})[./-]([0-9]{4})\s*$")
_TIME = re.compile(r"^\s*([0-9]{1,2})[:.]([0-9]{2})\s*$")


def parse_couple(text: str) -> tuple[str, str]:
    m = _COUPLE.match(clean(text, 80))
    if not m:
        raise Refused("couple")
    return clean(m.group(1), 30), clean(m.group(2), 30)


def parse_date(text: str, now: int) -> int:
    """KK.OO.YYYY -> Tashkent day number, between tomorrow and two years ahead."""
    m = _DATE.match(text or "")
    if not m:
        raise Refused("date")
    d, mo, y = (int(g) for g in m.groups())
    today = local_day(now)
    for day in range(today + 1, today + 731):  # small and exact: no datetime, the same calendar as the JS port
        if civil(day) == (y, mo, d):
            return day
    raise Refused("past" if (y, mo, d) <= civil(today) else "date")


def parse_time(text: str) -> int:
    m = _TIME.match(text or "")
    if not m or int(m.group(1)) > 23 or int(m.group(2)) > 59:
        raise Refused("time")
    return int(m.group(1)) * 60 + int(m.group(2))


class HostMixin:
    async def require_host(self, uid: int, wid: int) -> dict:
        row = await self.db.one("SELECT side FROM hosts WHERE wedding_id = ? AND user_id = ?", (wid, uid))
        if not row:
            raise Refused("not_found")
        return {**(await self.wedding(wid)), "my_side": row["side"]}

    async def hosted(self, uid: int) -> list[dict]:
        rows = await self.db.all("SELECT w.id FROM weddings w JOIN hosts h ON h.wedding_id = w.id "
                                 "WHERE h.user_id = ? ORDER BY w.starts_at", (uid,))
        return [await self.wedding(r["id"]) for r in rows]

    async def create_wedding(self, uid: int, d: dict) -> dict:
        n = await self.db.one("SELECT COUNT(*) AS n FROM weddings WHERE created_by = ?", (uid,))
        if n["n"] >= MAX_WEDDINGS:
            raise Refused("max_weddings")
        groom, bride = parse_couple(d["couple"])
        day, minute = parse_date(d["date"], self.now()), parse_time(d["time"])
        venue, address = clean(d["venue"], 80), clean(d["address"], 120)
        if len(venue) < 2 or len(address) < 3:
            raise Refused("text")
        cap = d["capacity"]
        if not (isinstance(cap, str) and cap.strip().isascii() and cap.strip().isdigit() and 10 <= int(cap) <= 3000):
            raise Refused("capacity")
        if d.get("side") not in rsvp.SIDES:
            raise Refused("side")
        w = {"groom": groom, "bride": bride, "starts_at": at_local(day, minute),
             "rsvp_deadline": at_local(day - 3, 23 * 60 + 59), "venue": venue, "address": address, "lat": None,
             "lon": None, "capacity": int(cap), "per_table": 10, "theme": "milliy", "music": "soft", "dress": "bayram",
             "program": DEFAULT_PROGRAM, "status": "active", "host_token": new_link(), "checker_token": new_link(),
             "created_by": uid, "created_at": self.now()}
        if w["rsvp_deadline"] < self.now():
            w["rsvp_deadline"] = w["starts_at"] - 3 * 3_600_000
        async with self.db.tx() as c:
            wid = await self.db.insert_wedding(c, w)
            await c.execute("INSERT INTO hosts (wedding_id, user_id, side) VALUES (?, ?, ?)", (wid, uid, d["side"]))
        return await self.wedding(wid)

    async def join(self, uid: int, token: str, role: str) -> tuple[dict, str]:
        """A co-host link (``h_<link>``) or a door checker link (``c_<link>``)."""
        col = "host_token" if role == "host" else "checker_token"
        rows = await self.db.all(f"SELECT id, {col} AS t FROM weddings WHERE status = 'active'")  # noqa: S608
        w = next((r for r in rows if len(r["t"]) == len(token) and hmac.compare_digest(r["t"], token)), None)
        if not w:
            raise Refused("not_found")
        if role == "host":
            first = await self.db.one("SELECT side FROM hosts WHERE wedding_id = ? ORDER BY rowid LIMIT 1", (w["id"],))
            side = "kelin" if first and first["side"] == "kuyov" else "kuyov"
            await self.db.run("INSERT OR IGNORE INTO hosts (wedding_id, user_id, side) VALUES (?, ?, ?)", (w["id"], uid, side))
            got = await self.db.one("SELECT side FROM hosts WHERE wedding_id = ? AND user_id = ?", (w["id"], uid))
            return await self.wedding(w["id"]), got["side"]
        await self.db.run("INSERT OR IGNORE INTO checkers (wedding_id, user_id) VALUES (?, ?)", (w["id"], uid))
        return await self.wedding(w["id"]), "checker"

    async def all_invites(self, wid: int) -> list[dict]:
        return [invite_row(r) for r in await self.db.all("SELECT * FROM invites WHERE wedding_id = ? ORDER BY id", (wid,))]

    async def dashboard(self, uid: int, wid: int) -> dict:
        w = await self.require_host(uid, wid)
        invites = await self.all_invites(wid)
        latest = sorted((x for x in invites if x["answered_at"]), key=lambda x: (-x["answered_at"], x["id"]))[:8]
        pending = await self.db.all("SELECT w.id, w.text, i.name FROM wishes w JOIN invites i ON i.id = w.invite_id "
                                    "WHERE w.wedding_id = ? AND w.status = 'pending' ORDER BY w.created_at, w.id", (wid,))
        return {"wedding": {k: v for k, v in w.items() if k not in ("host_token", "checker_token")},
                "summary": stats.summary(w, invites, self.now()), "pending": pending, "rev": w["rev"],
                "latest": [{k: x[k] for k in ("id", "name", "status", "people", "side", "answered_at")} for x in latest],
                "now": self.now()}

    async def rev(self, uid: int, wid: int) -> int:
        return (await self.require_host(uid, wid))["rev"]

    async def invite_links(self, uid: int, wid: int) -> list[dict]:
        await self.require_host(uid, wid)
        return [{k: x[k] for k in ("id", "name", "seats", "side", "grp", "status", "people", "token", "checked_in")}
                for x in await self.all_invites(wid)]

    async def add_invites(self, uid: int, wid: int, rows: list[dict]) -> list[dict]:
        await self.require_host(uid, wid)
        try:
            clean_rows = [rsvp.check_invite(r) for r in rows]
        except InputError as err:
            raise Refused(err.code) from err
        now, out = self.now(), []
        async with self.db.tx() as c:
            n = (await (await c.execute("SELECT COUNT(*) FROM invites WHERE wedding_id = ?", (wid,))).fetchone())[0]
            if n + len(clean_rows) > MAX_INVITES:
                raise Refused("too_many")
            for r in clean_rows:
                link = new_link()
                cur = await c.execute("INSERT INTO invites (wedding_id, token, token_hash, name, seats, side, grp, "
                                      "created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                                      (wid, link, link_hash(link), r["name"], r["seats"], r["side"], r["grp"], now))
                await c.execute("UPDATE invites SET entry_code = ? WHERE id = ?",
                                (qrtoken.entry_code(self.secret, cur.lastrowid, 1), cur.lastrowid))
                out.append({**r, "id": cur.lastrowid, "token": link})
            await c.execute("UPDATE weddings SET rev = rev + 1 WHERE id = ?", (wid,))
        return out

    async def import_csv(self, uid: int, wid: int, text: str) -> dict:
        w = await self.require_host(uid, wid)
        try:
            parsed = guestlist.parse_csv(text, w["my_side"])
        except InputError as err:
            raise Refused(err.code) from err
        added = await self.add_invites(uid, wid, parsed["rows"]) if parsed["rows"] else []
        return {"added": added, "errors": parsed["errors"]}

    async def export_csv(self, uid: int, wid: int) -> str:
        await self.require_host(uid, wid)
        return guestlist.export_csv(await self.all_invites(wid))

    async def decide_wish(self, uid: int, wid: int, wish_id: int, action: str) -> dict:
        await self.require_host(uid, wid)
        if action not in ("approve", "hide"):
            raise Refused("generic")
        status = "approved" if action == "approve" else "hidden"
        async with self.db.tx() as c:
            cur = await c.execute("UPDATE wishes SET status = ?, decided_at = ? WHERE id = ? AND wedding_id = ?",
                                  (status, self.now(), wish_id, wid))
            if cur.rowcount != 1:
                raise Refused("not_found")
            await c.execute("UPDATE weddings SET rev = rev + 1 WHERE id = ?", (wid,))
        return {"id": wish_id, "status": status}

    async def remind(self, uid: int, wid: int) -> list[dict]:
        """Claim every guest due a reminder in one transaction: two hosts pressing at once never send twice."""
        await self.require_host(uid, wid)
        now = self.now()
        async with self.db.tx() as c:
            cur = await c.execute("UPDATE invites SET reminded_at = ? WHERE wedding_id = ? AND status IN ('none', 'maybe') "
                                  "AND tg_user_id IS NOT NULL AND (reminded_at IS NULL OR reminded_at <= ?) RETURNING *",
                                  (now, wid, now - DAY_MS))
            rows = await cur.fetchall()  # exactly the rows this call claimed (RETURNING), never someone else's
            await c.execute("UPDATE weddings SET rev = rev + 1 WHERE id = ?", (wid,))
        return [invite_row(dict(r)) for r in rows]

    async def broadcast(self, uid: int, wid: int, text: str) -> tuple[str, list[dict]]:
        await self.require_host(uid, wid)
        body = clean(text, BROADCAST_MAX) if isinstance(text, str) else ""
        if len(body) < 3:
            raise Refused("text")
        rows = [invite_row(r) for r in await self.db.all(
            "SELECT * FROM invites WHERE wedding_id = ? AND status = 'yes' AND tg_user_id IS NOT NULL", (wid,))]
        async with self.db.tx() as c:
            await c.execute("INSERT INTO broadcasts (wedding_id, text, sent, by_user, created_at) VALUES (?, ?, ?, ?, ?)",
                            (wid, body, len(rows), uid, self.now()))
            await c.execute("UPDATE weddings SET rev = rev + 1 WHERE id = ?", (wid,))
        return body, rows

    async def settings(self, uid: int, wid: int, changes: dict) -> dict:
        await self.require_host(uid, wid)
        allowed = {"theme": THEMES, "music": MUSIC, "dress": DRESS}
        sets, args = [], []
        for k, v in changes.items():
            if k in allowed and v in allowed[k]:
                sets.append(f"{k} = ?")
                args.append(v)
            elif k == "location" and isinstance(v, list | tuple) and len(v) == 2 and all(
                    isinstance(x, int | float) and not isinstance(x, bool) for x in v) and -90 <= v[0] <= 90 \
                    and -180 <= v[1] <= 180:
                sets += ["lat = ?", "lon = ?"]
                args += [round(float(v[0]), 6), round(float(v[1]), 6)]
            else:
                raise Refused("generic")
        if sets:
            await self.db.run(f"UPDATE weddings SET {', '.join(sets)}, rev = rev + 1 WHERE id = ?", (*args, wid))  # noqa: S608
        return await self.wedding(wid)
