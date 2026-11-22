"""RSVP rules: Kelaman / Kelolmayman / Hali bilmayman, how many people (up to the invite's seats), a note, a wish.

Answers can change until the host's deadline and until the family has been let in at the door. Changing the answer
or the number of people bumps the invite's version, which invalidates any QR pass issued before.
"""

from __future__ import annotations

from .text import InputError, clean, whole

STATUSES = ("yes", "no", "maybe")
SIDES = ("kuyov", "kelin")
NOTE_MAX, WISH_MAX, NAME_MAX, GROUP_MAX = 200, 300, 60, 40
SEATS = (1, 10)


def validate(answer: object, invite: dict, wedding: dict, now: int) -> dict:
    """A clean answer ``{status, people, note, wish}`` or InputError(code)."""
    if not isinstance(answer, dict):
        raise InputError("generic")
    if now > wedding["rsvp_deadline"]:
        raise InputError("deadline")
    if invite.get("checked_in", 0) > 0:
        raise InputError("checked_in")
    status = answer.get("status")
    if status not in STATUSES:
        raise InputError("status")
    seats = invite["seats"]
    if status == "yes":
        people = whole(answer.get("people"), 1, seats, "people")
    elif status == "maybe":
        people = whole(answer.get("people", seats), 0, seats, "people")
    else:
        people = 0
    note, wish = answer.get("note", ""), answer.get("wish", "")
    if not isinstance(note, str) or not isinstance(wish, str) or len(note) > 2000 or len(wish) > 3000:
        raise InputError("generic")
    return {"status": status, "people": people, "note": clean(note, NOTE_MAX), "wish": clean(wish, WISH_MAX)}


def apply(invite: dict, answer: dict, now: int) -> dict:
    """The invite after a valid answer. A new status or head count means a new pass version."""
    changed = (answer["status"], answer["people"]) != (invite["status"], invite["people"])
    return {**invite, "status": answer["status"], "people": answer["people"], "note": answer["note"],
            "answered_at": now, "version": invite["version"] + (1 if changed else 0)}


def check_invite(data: object) -> dict:
    """A new invite typed by a host: ``{name, seats, side, grp}``."""
    if not isinstance(data, dict):
        raise InputError("generic")
    name = clean(data.get("name"), NAME_MAX) if isinstance(data.get("name"), str) else ""
    if len(name) < 2:
        raise InputError("name")
    seats = whole(data.get("seats"), *SEATS, "seats")
    side = data.get("side")
    if side not in SIDES:
        raise InputError("side")
    grp = data.get("grp", "")
    if not isinstance(grp, str):
        raise InputError("generic")
    return {"name": name, "seats": seats, "side": side, "grp": clean(grp, GROUP_MAX)}
