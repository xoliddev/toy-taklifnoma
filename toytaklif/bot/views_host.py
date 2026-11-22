"""The hosts' bot screens: the live summary, groups, the guest list with personal links, wishes, reminders,
the broadcast confirmation and the settings."""

from __future__ import annotations

from ..i18n import MARKS, Raw, answer_line, bar, clock, couple, date_long, left_text, people, t
from .cb import PAGE
from .views import Screen, back


def summary(lang: str, d: dict) -> Screen:
    w, s = d["wedding"], d["summary"]
    wid = w["id"]
    text = t(lang, "host.summary", couple=couple(w), date=date_long(lang, w["starts_at"]), time=clock(w["starts_at"]),
             left=left_text(lang, w["starts_at"] - d["now"]), yes=s["yes"], people=people(lang, s["people"]), no=s["no"],
             maybe=s["maybe"], maybe_people=people(lang, s["maybe_people"]), none=s["none"], count=s["people"],
             capacity=s["capacity"], bar=bar(s["pct"]), pct=s["pct"], tables=s["tables"], per=s["per_table"],
             kuyov=people(lang, s["sides"]["kuyov"]["people"]), kelin=people(lang, s["sides"]["kelin"]["people"]))
    if s["over"]:
        text += "\n" + t(lang, "host.over", n=s["over"])
    if s["arrived"]:
        text += "\n" + t(lang, "host.arrived", n=s["arrived"])
    rows = [
        [(t(lang, "btn.panel"), f"@app#host={wid}")],
        [(t(lang, "btn.refresh"), f"h:{wid}"), (t(lang, "btn.groups"), f"hg:{wid}")],
        [(t(lang, "btn.guests"), f"hl:{wid}:0"), (t(lang, "btn.add"), f"ha:{wid}")],
        [(t(lang, "btn.import"), f"hc:{wid}"), (t(lang, "btn.export"), f"hx:{wid}")],
        [(t(lang, "btn.wishes", n=len(d["pending"])), f"hw:{wid}"), (t(lang, "btn.remind", n=s["remind_due"]), f"hr:{wid}")],
        [(t(lang, "btn.broadcast"), f"hb:{wid}"), (t(lang, "btn.settings"), f"hs:{wid}")],
        back(lang),
    ]
    return text, rows


def groups(lang: str, d: dict) -> Screen:
    lines = [t(lang, "host.group_line", name=g["name"] or t(lang, "dash.group_none"), invites=g["invites"], yes=g["yes"],
               people=people(lang, g["people"]), none=g["none"]) for g in d["summary"]["groups"]]
    return t(lang, "host.groups", lines=Raw("\n".join(lines) or "—")), [back(lang, f"h:{d['wedding']['id']}")]


def guest_list(lang: str, wid: int, items: list[dict], page: int) -> Screen:
    pages = max(1, -(-len(items) // PAGE))
    page = max(0, min(page, pages - 1))
    chunk = items[page * PAGE:(page + 1) * PAGE]
    rows = [[(f"{MARKS[x['status']]} {x['name']} ({x['people'] or x['seats']})", f"hi:{x['id']}")] for x in chunk]
    nav = []
    if page > 0:
        nav.append((t(lang, "btn.prev"), f"hl:{wid}:{page - 1}"))
    if page < pages - 1:
        nav.append((t(lang, "btn.next"), f"hl:{wid}:{page + 1}"))
    rows += [nav] if nav else []
    return t(lang, "host.list", n=len(items), page=page + 1, pages=pages), [*rows, back(lang, f"h:{wid}")]


def invite_detail(lang: str, x: dict, link: str) -> Screen:
    text = t(lang, "host.invite", mark=MARKS[x["status"]], name=x["name"], side=t(lang, f"side.{x['side']}"),
             grp=x["grp"] or t(lang, "dash.group_none"), seats=x["seats"], answer=answer_line(lang, x), link=link)
    return text, [back(lang, f"hl:{x['wedding_id']}:0")]


def add_seats(lang: str, name: str) -> Screen:
    nums = [(str(n), f"has:{n}") for n in range(1, 9)]
    return t(lang, "host.add_seats", name=name), [nums[:4], nums[4:], [(t(lang, "btn.cancel"), "n:menu")]]


def add_side(lang: str) -> Screen:
    return t(lang, "host.add_side"), [[(t(lang, "btn.kuyov"), "hsd:kuyov"), (t(lang, "btn.kelin"), "hsd:kelin")],
                                      [(t(lang, "btn.cancel"), "n:menu")]]


def add_group(lang: str, names: list[str]) -> Screen:
    rows = [[(g, f"hgr:{k}")] for k, g in enumerate(names[:8])]
    return t(lang, "host.add_group"), [*rows, [(t(lang, "btn.no_group"), "hgr:-")], [(t(lang, "btn.cancel"), "n:menu")]]


def wish(lang: str, wid: int, pending: list[dict]) -> Screen:
    if not pending:
        return t(lang, "host.no_wishes"), [back(lang, f"h:{wid}")]
    first = pending[0]
    return (t(lang, "host.wish", name=first["name"], text=first["text"], n=len(pending) - 1),
            [[(t(lang, "btn.approve"), f"hwd:{wid}:{first['id']}:a"), (t(lang, "btn.hide"), f"hwd:{wid}:{first['id']}:h")],
             back(lang, f"h:{wid}")])


def remind_ask(lang: str, wid: int, due: int) -> Screen:
    if not due:
        return t(lang, "host.remind_none"), [back(lang, f"h:{wid}")]
    return t(lang, "host.remind_ask", n=due), [[(t(lang, "btn.remind_go"), f"hrg:{wid}")], back(lang, f"h:{wid}")]


def broadcast_confirm(lang: str, wid: int, text: str, n: int) -> Screen:
    return (t(lang, "host.broadcast_confirm", n=n, text=text),
            [[(t(lang, "btn.broadcast_go"), f"hbg:{wid}")], [(t(lang, "btn.cancel"), f"h:{wid}")]])


def settings(lang: str, w: dict) -> Screen:
    wid = w["id"]
    text = t(lang, "host.settings", theme=t(lang, f"theme.{w['theme']}"), music=t(lang, f"music.{w['music']}"),
             location=t(lang, "host.located_yes" if w["lat"] is not None else "host.located_no"))
    themes = [(("• " if w["theme"] == k else "") + t(lang, f"theme.{k}"), f"hst:{wid}:{k}") for k in ("milliy", "oltin", "bahor")]
    music = [(("• " if w["music"] == k else "") + t(lang, f"btn.music_{k}"), f"hsm:{wid}:{k}") for k in ("soft", "none")]
    return text, [themes, music, [(t(lang, "btn.location"), f"hsl:{wid}")],
                  [(t(lang, "btn.cohost"), f"hsh:{wid}")], [(t(lang, "btn.checker"), f"hsc:{wid}")], back(lang, f"h:{wid}")]
