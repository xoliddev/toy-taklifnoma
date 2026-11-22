"""The fictional demo wedding, always relative to "now": the party is 25 days ahead, with 80 invites from a hash.

Two invites belong to the guided story (the Karimov family, 3 seats, and Rustam Nazarov, 2 seats); both have not
answered yet. Everything else is spread deterministically, so Python and the JS port build the same wedding.
Invite links are NOT made here: the server gives every invite a random 128-bit token when it stores it.
"""

from __future__ import annotations

from .clock import MIN_MS, at_local, local_day
from .text import h32

STORY_FAMILY = 1  # "Karimovlar oilasi": answers Kelaman, 3 kishi, and writes a wish
STORY_DECLINE = 2  # "Rustam Nazarov": answers Kelolmayman
GUEST, GUEST2 = 1001, 1002
HOST_KUYOV, HOST_KELIN, CHECKER = 2001, 2002, 2101
INVITES = 80
PROGRAM = [(1080, "welcome"), (1110, "entrance"), (1140, "feast"), (1230, "cake"), (1350, "farewell")]


def wedding(now: int) -> dict:
    day = local_day(now) + 25
    return {"id": 1, "groom": "Sardor", "bride": "Madina", "starts_at": at_local(day, 18 * 60),
            "rsvp_deadline": at_local(day - 3, 23 * 60 + 59), "venue": "Gulbahor to'yxonasi",
            "address": "Chilonzor tumani, Lolazor ko'chasi, 14-uy", "lat": 41.28562, "lon": 69.20341,
            "capacity": 200, "per_table": 10, "theme": "milliy", "music": "soft", "dress": "bayram",
            "program": [{"at": at, "key": key} for at, key in PROGRAM], "status": "active"}


def invite(i: int, names: dict, now: int) -> dict:
    h = h32(f"inv:{i}")
    fam = names["families"]
    if h % 10 < 6:
        name, seats = f"{fam[(i - 1) % len(fam)]}lar oilasi", 2 + (h >> 4) % 4
    elif (h >> 3) % 2:
        name, seats = f"{names['men'][i % len(names['men'])]} {fam[(i * 3) % len(fam)]}", 1 + (h >> 4) % 2
    else:
        name, seats = f"{names['women'][i % len(names['women'])]} {fam[(i * 3) % len(fam)]}a", 1 + (h >> 4) % 2
    r = (h >> 12) % 100
    status = "yes" if r < 42 else "no" if r < 52 else "maybe" if r < 60 else "none"
    tg = 6000 + i if (h >> 20) % 10 < 7 else None
    side = "kuyov" if (h >> 8) % 2 == 0 else "kelin"
    grp = names["groups"][(h >> 9) % len(names["groups"])]
    if i == STORY_FAMILY:
        name, seats, status, tg, side, grp = "Karimovlar oilasi", 3, "none", GUEST, "kuyov", "Qarindoshlar"
    elif i == STORY_DECLINE:
        name, seats, status, tg, side, grp = "Rustam Nazarov", 2, "none", GUEST2, "kelin", "Hamkasblar"
    people = 0
    if status == "yes":
        people = seats - (1 if seats > 1 and (h >> 16) % 3 == 0 else 0)
    elif status == "maybe":
        people = seats
    answered = None if status == "none" else now - ((h >> 18) % 9000 + 30) * MIN_MS
    return {"id": i, "wedding_id": 1, "name": name, "seats": seats, "side": side, "grp": grp, "status": status,
            "people": people, "note": "", "answered_at": answered, "version": 1, "checked_in": 0,
            "last_checkin_at": None, "reminded_at": None, "tg": tg, "lang": "ru" if (h >> 24) % 10 == 0 else "uz"}


def world(names: dict, now: int) -> dict:
    invites = [invite(i, names, now) for i in range(1, INVITES + 1)]
    yes = [x for x in invites if x["status"] == "yes"]
    wishes = [{"id": k + 1, "invite_id": yes[k * 5]["id"], "text": names["wishes"][k],
               "status": "approved" if k < 3 else "pending", "created_at": now - (k + 2) * 3 * 3_600_000}
              for k in range(4)]
    users = [{"id": HOST_KUYOV, "name": "Akmal aka"}, {"id": HOST_KELIN, "name": "Zulfiya opa"},
             {"id": CHECKER, "name": "Bobur"}, {"id": GUEST, "name": "Anvar Karimov"},
             {"id": GUEST2, "name": "Rustam Nazarov"}]
    return {"wedding": wedding(now), "invites": invites, "wishes": wishes, "users": users,
            "hosts": [{"user_id": HOST_KUYOV, "side": "kuyov"}, {"user_id": HOST_KELIN, "side": "kelin"}],
            "checkers": [CHECKER]}
