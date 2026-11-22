"""SQLite storage (aiosqlite, WAL, indexes). Parameterised SQL only. Times are UTC milliseconds.

The rules that must never break are also written into the schema, so even a bug in the service cannot break them:
* people never exceed the invite's seats, and nobody is let in beyond the people who said they are coming
  (CHECK constraints, on top of the conditional UPDATE used at the door);
* an invite link, a host link, a checker link and a door code are unique;
* one wish per invite, one host row per person per wedding.
"""

from __future__ import annotations

import asyncio
import json
import sqlite3
from contextlib import asynccontextmanager
from pathlib import Path

import aiosqlite

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, lang TEXT NOT NULL DEFAULT 'uz', created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS weddings (
  id INTEGER PRIMARY KEY AUTOINCREMENT, groom TEXT NOT NULL, bride TEXT NOT NULL,
  starts_at INTEGER NOT NULL, rsvp_deadline INTEGER NOT NULL, venue TEXT NOT NULL, address TEXT NOT NULL,
  lat REAL, lon REAL, capacity INTEGER NOT NULL CHECK (capacity BETWEEN 10 AND 3000),
  per_table INTEGER NOT NULL CHECK (per_table BETWEEN 4 AND 20),
  theme TEXT NOT NULL CHECK (theme IN ('milliy', 'oltin', 'bahor')),
  music TEXT NOT NULL CHECK (music IN ('soft', 'none')),
  dress TEXT NOT NULL CHECK (dress IN ('milliy', 'bayram', 'oq', 'erkin')), program TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
  host_token TEXT NOT NULL UNIQUE, checker_token TEXT NOT NULL UNIQUE,
  created_by INTEGER NOT NULL, created_at INTEGER NOT NULL, rev INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS hosts (
  wedding_id INTEGER NOT NULL REFERENCES weddings(id), user_id INTEGER NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('kuyov', 'kelin')), PRIMARY KEY (wedding_id, user_id)
);
CREATE INDEX IF NOT EXISTS hosts_user ON hosts(user_id);
CREATE TABLE IF NOT EXISTS checkers (
  wedding_id INTEGER NOT NULL REFERENCES weddings(id), user_id INTEGER NOT NULL, PRIMARY KEY (wedding_id, user_id)
);
CREATE INDEX IF NOT EXISTS checkers_user ON checkers(user_id);
CREATE TABLE IF NOT EXISTS invites (
  id INTEGER PRIMARY KEY AUTOINCREMENT, wedding_id INTEGER NOT NULL REFERENCES weddings(id),
  token TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  seats INTEGER NOT NULL CHECK (seats BETWEEN 1 AND 10),
  side TEXT NOT NULL CHECK (side IN ('kuyov', 'kelin')), grp TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'none' CHECK (status IN ('none', 'yes', 'no', 'maybe')),
  people INTEGER NOT NULL DEFAULT 0 CHECK (people BETWEEN 0 AND seats), note TEXT NOT NULL DEFAULT '',
  answered_at INTEGER, version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1), entry_code TEXT UNIQUE,
  checked_in INTEGER NOT NULL DEFAULT 0 CHECK (checked_in >= 0 AND checked_in <= seats),
  last_checkin_at INTEGER, reminded_at INTEGER, tg_user_id INTEGER, lang TEXT NOT NULL DEFAULT 'uz',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS invites_wedding ON invites(wedding_id, status);
CREATE INDEX IF NOT EXISTS invites_tg ON invites(tg_user_id);
CREATE TABLE IF NOT EXISTS wishes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, invite_id INTEGER NOT NULL UNIQUE REFERENCES invites(id),
  wedding_id INTEGER NOT NULL REFERENCES weddings(id), text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'hidden')),
  created_at INTEGER NOT NULL, decided_at INTEGER
);
CREATE INDEX IF NOT EXISTS wishes_wedding ON wishes(wedding_id, status);
CREATE TABLE IF NOT EXISTS checkins (
  id INTEGER PRIMARY KEY AUTOINCREMENT, invite_id INTEGER NOT NULL REFERENCES invites(id),
  wedding_id INTEGER NOT NULL, people INTEGER NOT NULL CHECK (people > 0), version INTEGER NOT NULL,
  at INTEGER NOT NULL, by_user INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS broadcasts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, wedding_id INTEGER NOT NULL REFERENCES weddings(id), text TEXT NOT NULL,
  sent INTEGER NOT NULL, by_user INTEGER NOT NULL, created_at INTEGER NOT NULL
);
"""
WEDDING_COLS = ("groom", "bride", "starts_at", "rsvp_deadline", "venue", "address", "lat", "lon", "capacity",
                "per_table", "theme", "music", "dress", "program", "status", "host_token", "checker_token",
                "created_by", "created_at")


def wedding_row(row: dict) -> dict:
    return {**row, "program": json.loads(row["program"])}


def invite_row(row: dict) -> dict:
    """A stored invite in the shape the core uses (``tg`` instead of the column name)."""
    return {**row, "tg": row.get("tg_user_id")}


class Database:
    def __init__(self, conn: aiosqlite.Connection) -> None:
        self.conn = conn
        self.lock = asyncio.Lock()  # one transaction at a time on this connection

    @classmethod
    async def open(cls, path: str) -> Database:
        if path != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        conn = await aiosqlite.connect(path, isolation_level=None)  # we issue BEGIN/COMMIT ourselves
        conn.row_factory = aiosqlite.Row
        await conn.execute("PRAGMA journal_mode=WAL")
        await conn.execute("PRAGMA synchronous=NORMAL")
        await conn.execute("PRAGMA busy_timeout=5000")
        await conn.execute("PRAGMA foreign_keys=ON")
        await conn.executescript(SCHEMA)
        return cls(conn)

    async def close(self) -> None:
        await self.conn.close()

    @asynccontextmanager
    async def tx(self):
        """``BEGIN IMMEDIATE`` takes the write lock up front, so check-then-write sequences cannot interleave,
        neither between coroutines (asyncio lock) nor between processes (SQLite lock + busy_timeout)."""
        async with self.lock:
            for attempt in range(6):  # busy_timeout already waits; this only covers a very loaded machine
                try:
                    await self.conn.execute("BEGIN IMMEDIATE")
                    break
                except sqlite3.OperationalError as err:
                    if "locked" not in str(err) or attempt == 5:
                        raise
                    await asyncio.sleep(0.05 * (attempt + 1))
            try:
                yield self.conn
            except BaseException:
                await self.conn.execute("ROLLBACK")
                raise
            await self.conn.execute("COMMIT")

    async def one(self, sql: str, args: tuple = ()) -> dict | None:
        async with self.conn.execute(sql, args) as cur:
            row = await cur.fetchone()
        return dict(row) if row else None

    async def all(self, sql: str, args: tuple = ()) -> list[dict]:
        async with self.conn.execute(sql, args) as cur:
            return [dict(r) for r in await cur.fetchall()]

    async def run(self, sql: str, args: tuple = ()) -> int:
        """A single write outside an explicit transaction (autocommit). Returns rowcount."""
        async with self.lock:
            cur = await self.conn.execute(sql, args)
            return cur.rowcount

    @staticmethod
    async def insert_wedding(c, w: dict) -> int:
        row = {**w, "program": json.dumps(w["program"], ensure_ascii=False)}
        cols = ", ".join(WEDDING_COLS)
        cur = await c.execute(f"INSERT INTO weddings ({cols}) VALUES ({', '.join('?' * len(WEDDING_COLS))})",  # noqa: S608
                              tuple(row[k] for k in WEDDING_COLS))
        return cur.lastrowid
