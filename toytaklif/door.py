"""The door: a checker scans a pass (or types its short code) and the family is let in, atomically.

The pass must be genuine (HMAC), for this wedding, for the invite's *current* version and head count, and there
must be people left to let in. The UPDATE itself re-checks all of that inside ``BEGIN IMMEDIATE``
(``checked_in + n <= people AND version = ?``), so two doors scanning the same pass at once let it in once.
Partial arrival works: "2 of 3 now" leaves one place for later. Admin tools live here too.
"""

from __future__ import annotations

from .common import Refused
from .core import qrtoken, stats
from .core.clock import HOUR_MS
from .db import invite_row

OPEN_BEFORE, OPEN_AFTER = 12 * HOUR_MS, 18 * HOUR_MS


class DoorMixin:
    async def require_checker(self, uid: int, wid: int) -> dict:
        row = await self.db.one("SELECT 1 FROM checkers WHERE wedding_id = ? AND user_id = ? UNION "
                                "SELECT 1 FROM hosts WHERE wedding_id = ? AND user_id = ?", (wid, uid, wid, uid))
        if not row:
            raise Refused("not_found")
        return await self.wedding(wid)

    async def checking(self, uid: int) -> list[dict]:
        rows = await self.db.all("SELECT wedding_id AS id FROM checkers WHERE user_id = ? ORDER BY wedding_id", (uid,))
        return [await self.wedding(r["id"]) for r in rows]

    async def door_status(self, uid: int, wid: int) -> dict:
        """What a checker may see: the couple, the date and how many are inside. No guest list."""
        w = await self.require_checker(uid, wid)
        row = await self.db.one("SELECT COALESCE(SUM(checked_in), 0) AS arrived, "
                                "COALESCE(SUM(CASE WHEN status = 'yes' THEN people END), 0) AS people "
                                "FROM invites WHERE wedding_id = ?", (wid,))
        return {"id": wid, "groom": w["groom"], "bride": w["bride"], "starts_at": w["starts_at"],
                "arrived": row["arrived"], "people": row["people"], "now": self.now()}

    async def checkin(self, uid: int, wid: int, scanned: object, want: object = None) -> dict:
        """``{"result": "ok" | "used" | "bad" | "not_today", ...}``. ``want`` = how many walk in now (None: all)."""
        w = await self.require_checker(uid, wid)
        if want is not None and (not isinstance(want, int) or isinstance(want, bool) or not 1 <= want <= 10):
            raise Refused("people")
        now = self.now()
        fields = qrtoken.verify(self.secret, scanned)
        code = None if fields else qrtoken.norm_code(scanned)
        if fields is None and code is None:
            return {"result": "bad"}
        async with self.db.tx() as c:
            if fields:
                row = await (await c.execute("SELECT * FROM invites WHERE id = ? AND wedding_id = ?",
                                             (fields["invite_id"], wid))).fetchone()
            else:
                row = await (await c.execute("SELECT * FROM invites WHERE entry_code = ? AND wedding_id = ?",
                                             (code, wid))).fetchone()
            inv = invite_row(dict(row)) if row else None
            if (inv is None or inv["status"] != "yes" or inv["people"] < 1 or (fields and (
                    fields["wedding_id"] != wid or fields["version"] != inv["version"]
                    or fields["people"] != inv["people"]))):
                return {"result": "bad"}
            if not w["starts_at"] - OPEN_BEFORE <= now <= w["starts_at"] + OPEN_AFTER:  # genuine, but not today
                return {"result": "not_today", "starts_at": w["starts_at"]}
            left = inv["people"] - inv["checked_in"]
            base = {"name": inv["name"], "total": inv["people"], "invite_id": inv["id"]}
            if left <= 0:
                return {"result": "used", "at": inv["last_checkin_at"], **base, "arrived": inv["checked_in"]}
            n = min(want or left, left)
            cur = await c.execute("UPDATE invites SET checked_in = checked_in + ?, last_checkin_at = ? WHERE id = ? "
                                  "AND status = 'yes' AND version = ? AND checked_in + ? <= people",
                                  (n, now, inv["id"], inv["version"], n))
            if cur.rowcount != 1:  # cannot happen under the write lock; kept as the last line of defence
                return {"result": "used", "at": inv["last_checkin_at"], **base, "arrived": inv["checked_in"]}
            await c.execute("INSERT INTO checkins (invite_id, wedding_id, people, version, at, by_user) "
                            "VALUES (?, ?, ?, ?, ?, ?)", (inv["id"], wid, n, inv["version"], now, uid))
            await c.execute("UPDATE weddings SET rev = rev + 1 WHERE id = ?", (wid,))
        arrived = inv["checked_in"] + n
        return {"result": "ok", **base, "people": n, "arrived": arrived, "left": inv["people"] - arrived, "at": now}

    # ── admin ──
    async def admin_weddings(self, uid: int) -> list[dict]:
        if uid not in self.admins:
            raise Refused("not_found")
        out = []
        for r in await self.db.all("SELECT id FROM weddings ORDER BY starts_at DESC LIMIT 50"):
            w = await self.wedding(r["id"])
            s = stats.summary(w, await self.all_invites(w["id"]), self.now())
            out.append({"id": w["id"], "groom": w["groom"], "bride": w["bride"], "starts_at": w["starts_at"],
                        "status": w["status"], "invites": s["invites"], "people": s["people"]})
        return out

    async def admin_block(self, uid: int, wid: int, blocked: bool) -> dict:
        if uid not in self.admins:
            raise Refused("not_found")
        await self.wedding(wid)
        await self.db.run("UPDATE weddings SET status = ?, rev = rev + 1 WHERE id = ?",
                          ("blocked" if blocked else "active", wid))
        return await self.wedding(wid)
