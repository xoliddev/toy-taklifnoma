"""Shared helpers: the seeded wedding in a database, a clock the tests can move, and the people in the stories."""

from __future__ import annotations

import json
from contextlib import asynccontextmanager
from pathlib import Path

from toytaklif.core import seedgen
from toytaklif.db import Database
from toytaklif.service import Service

ROOT = Path(__file__).resolve().parent.parent
NOW = 1_795_000_000_000  # Wednesday 2026-11-18, 16:06 in Tashkent (the same moment as the shared vectors)
SECRET = b"tests-only-qr-secret-0123456789abcdef"
ADMIN, GUEST, GUEST2 = 9001, seedgen.GUEST, seedgen.GUEST2
HOST, HOST2, CHECKER, STRANGER = seedgen.HOST_KUYOV, seedgen.HOST_KELIN, seedgen.CHECKER, 7777
FAMILY, DECLINE = seedgen.STORY_FAMILY, seedgen.STORY_DECLINE


def load(name: str):
    with open(ROOT / "shared" / "data" / f"{name}.json", encoding="utf-8") as fh:
        return json.load(fh)


class Clock:
    def __init__(self, start: int = NOW) -> None:
        self.now = start

    def __call__(self) -> int:
        return self.now

    def skip(self, minutes: float = 0, hours: float = 0, days: float = 0) -> None:
        self.now += int((minutes + hours * 60 + days * 1440) * 60_000)

    def to(self, ms: int) -> None:
        self.now = ms


@asynccontextmanager
async def service_env(clock: Clock | None = None, path: str = ":memory:"):
    clock = clock or Clock()
    db = await Database.open(path)
    svc = Service(db, SECRET, clock=clock, admins=frozenset({ADMIN}))
    await svc.seed(seedgen.world(load("names"), clock()))
    await svc.touch_user(ADMIN, "Admin", "uz")
    try:
        yield svc, clock
    finally:
        await db.close()


async def link(svc: Service, iid: int) -> str:
    return (await svc.db.one("SELECT token FROM invites WHERE id = ?", (iid,)))["token"]


async def wedding_day(svc: Service, clock: Clock, minutes_after_start: int = -30) -> None:
    w = await svc.wedding(1)
    clock.to(w["starts_at"] + minutes_after_start * 60_000)
