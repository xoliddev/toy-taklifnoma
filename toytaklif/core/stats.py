"""The hosts' live numbers: who answered, how many people are coming against the hall, both sides, every group,
how many tables, and who is due a reminder (each guest at most once per 24 hours)."""

from __future__ import annotations

from .clock import DAY_MS

EMPTY = {"yes": 0, "no": 0, "maybe": 0, "none": 0, "people": 0, "maybe_people": 0, "invites": 0}


def ceil_div(a: int, b: int) -> int:
    return -(-a // b)


def remind_due(inv: dict, now: int) -> bool:
    if inv["status"] not in ("none", "maybe") or not inv.get("tg"):
        return False
    return inv.get("reminded_at") is None or now - inv["reminded_at"] >= DAY_MS


def _add(bucket: dict, inv: dict) -> None:
    bucket[inv["status"]] += 1
    bucket["invites"] += 1
    if inv["status"] == "yes":
        bucket["people"] += inv["people"]
    elif inv["status"] == "maybe":
        bucket["maybe_people"] += inv["people"]


def summary(wedding: dict, invites: list[dict], now: int) -> dict:
    total = dict(EMPTY)
    sides = {"kuyov": dict(EMPTY), "kelin": dict(EMPTY)}
    groups: dict[str, dict] = {}
    arrived = arrived_invites = due = seats = 0
    for inv in invites:
        _add(total, inv)
        _add(sides[inv["side"]], inv)
        _add(groups.setdefault(inv["grp"], {"name": inv["grp"], **EMPTY}), inv)
        seats += inv["seats"]
        arrived += inv.get("checked_in", 0)
        arrived_invites += 1 if inv.get("checked_in", 0) > 0 else 0
        due += 1 if remind_due(inv, now) else 0
    cap, per = wedding["capacity"], wedding["per_table"]
    people = total["people"]
    return {
        **total, "seats": seats, "answered": total["yes"] + total["no"] + total["maybe"],
        "capacity": cap, "pct": min(100, people * 100 // cap) if cap else 0, "free": cap - people,
        "over": max(0, people - cap), "per_table": per, "tables": ceil_div(people, per),
        "tables_max": ceil_div(people + total["maybe_people"], per), "sides": sides,
        "groups": sorted(groups.values(), key=lambda g: (-g["invites"], g["name"])),
        "arrived": arrived, "arrived_invites": arrived_invites, "remind_due": due,
    }
