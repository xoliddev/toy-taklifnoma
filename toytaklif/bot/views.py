"""Bot screens as plain (text, rows) pairs: the main menu, the guest's invitation, the door, admin.
The hosts' screens are in views_host.py. demo/bot-views.js renders the same screens from the same locale keys."""

from __future__ import annotations

from ..i18n import MARKS, Raw, answer_line, clock, couple, date_long, left_text, people, plain, t

Screen = tuple[str, list[list[tuple[str, str]]]]


def back(lang: str, to: str = "n:menu") -> list[tuple[str, str]]:
    return [(t(lang, "btn.back"), to)]


def main_menu(lang: str, user: dict, roles: dict, hello: bool = False) -> Screen:
    """``roles``: {"guest": [(invite, wedding)], "host": [wedding], "door": [wedding], "admin": bool}."""
    rows = [[(plain(t(lang, "btn.guest", couple=couple(w))), f"g:{inv['id']}")] for inv, w in roles["guest"]]
    rows += [[(plain(t(lang, "btn.host", couple=couple(w))), f"h:{w['id']}")] for w in roles["host"]]
    rows += [[(plain(t(lang, "btn.door", couple=couple(w))), f"d:{w['id']}")] for w in roles["door"]]
    rows.append([(t(lang, "btn.new"), "n:new")])
    if roles.get("admin"):
        rows.append([(t(lang, "btn.admin"), "n:admin")])
    rows.append([(t(lang, "btn.lang"), "n:lang")])
    text = t(lang, "menu.hello", name=user["name"]) if hello else t(lang, "menu.text")
    if not (roles["guest"] or roles["host"] or roles["door"]):
        text += "\n\n" + t(lang, "menu.empty")
    return text, rows


def guest_card(lang: str, inv: dict, w: dict, now: int) -> Screen:
    text = t(lang, "guest.card", couple=couple(w), name=inv["name"], lead=t(lang, "inv.lead"),
             date=date_long(lang, w["starts_at"]), time=clock(w["starts_at"]), venue=w["venue"], address=w["address"],
             left=left_text(lang, w["starts_at"] - now), answer=answer_line(lang, inv))
    rows: list[list[tuple[str, str]]] = []
    open_ = now <= w["rsvp_deadline"] and inv["checked_in"] == 0
    if open_:
        text += "\n" + t(lang, "guest.deadline", date=date_long(lang, w["rsvp_deadline"]))
        rows.append([(t(lang, "btn.yes"), f"r:{inv['id']}:yes"), (t(lang, "btn.no"), f"r:{inv['id']}:no")])
        rows.append([(t(lang, "btn.maybe"), f"r:{inv['id']}:maybe")])
        rows.append([(t(lang, "btn.wish"), f"w:{inv['id']}")])
    else:
        text += "\n" + t(lang, "guest.closed")
    if inv["status"] == "yes":
        rows.append([(t(lang, "btn.qr"), f"q:{inv['id']}")])
    rows.append([(t(lang, "btn.open_invite"), f"@app#i={inv['token']}")])
    rows.append(back(lang))
    return text, rows


def pick_people(lang: str, inv: dict) -> Screen:
    nums = [(str(n), f"p:{inv['id']}:{n}") for n in range(1, inv["seats"] + 1)]
    rows = [nums[k:k + 5] for k in range(0, len(nums), 5)]
    return t(lang, "guest.people", seats=inv["seats"]), [*rows, back(lang, f"g:{inv['id']}")]


def qr_caption(lang: str, inv: dict, w: dict, code: str) -> str:
    return t(lang, "guest.qr", name=inv["name"], people=people(lang, inv["people"]), couple=couple(w),
             date=date_long(lang, w["starts_at"]), code=code)


def door_home(lang: str, st: dict) -> Screen:
    w = {"groom": st["groom"], "bride": st["bride"]}
    return (t(lang, "door.bot", couple=couple(w), arrived=st["arrived"], people=st["people"]),
            [[(t(lang, "btn.scanner"), f"@app#door={st['id']}")], [(t(lang, "btn.refresh"), f"d:{st['id']}")], back(lang)])


def door_result(lang: str, res: dict) -> str:
    if res["result"] == "ok":
        return t(lang, "door.bot_ok", name=res["name"], people=people(lang, res["people"]), arrived=res["arrived"],
                 total=res["total"])
    if res["result"] == "used":
        return t(lang, "door.bot_used", time=clock(res["at"]) if res.get("at") else "—", name=res["name"], total=res["total"])
    if res["result"] == "not_today":
        return t(lang, "door.bot_not_today", date=date_long(lang, res["starts_at"]))
    return t(lang, "door.bot_bad")


def admin_list(lang: str, items: list[dict]) -> Screen:
    lines = [t(lang, "admin.line", mark="🚫" if w["status"] == "blocked" else "✅", id=w["id"], couple=couple(w),
               date=date_long(lang, w["starts_at"]), invites=w["invites"], people=people(lang, w["people"])) for w in items]
    rows = [[(f"{t(lang, 'btn.unblock' if w['status'] == 'blocked' else 'btn.block')} #{w['id']}",
              f"ad:{w['id']}:{0 if w['status'] == 'blocked' else 1}")] for w in items]
    return t(lang, "admin.list", n=len(items), lines=Raw("\n".join(lines) or "—")), [*rows, back(lang)]


__all__ = ["MARKS", "Screen", "admin_list", "back", "door_home", "door_result", "guest_card", "main_menu", "pick_people",
           "qr_caption"]
