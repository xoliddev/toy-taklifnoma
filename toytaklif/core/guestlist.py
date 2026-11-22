"""The guest list as CSV: import (Excel-friendly: comma, semicolon or tab, quotes, a header row or none) and export
(UTF-8 with BOM, cells that start like a formula are defused so a list opened in Excel cannot run anything)."""

from __future__ import annotations

from .rsvp import GROUP_MAX, NAME_MAX, SEATS
from .text import InputError, clean

MAX_ROWS = 500
SIDE_WORDS = {"kuyov": "kuyov", "kuyov tomoni": "kuyov", "k": "kuyov", "жених": "kuyov", "groom": "kuyov",
              "kelin": "kelin", "kelin tomoni": "kelin", "q": "kelin", "невеста": "kelin", "bride": "kelin"}
HEADER_WORDS = {"name", "ism", "mehmon", "имя", "гость", "guest", "familiya"}
EXPORT_HEAD = ("Mehmon", "Joylar", "Tomon", "Guruh", "Javob", "Kishi", "Keldi", "Izoh")
STATUS_WORDS = {"yes": "Kelaman", "no": "Kelolmayman", "maybe": "Hali bilmayman", "none": "Javob yo'q"}


def split_rows(text: str) -> list[list[str]]:
    """A small RFC 4180 reader: quoted cells may hold the delimiter, quotes ("") and line breaks."""
    text = text.removeprefix("﻿")
    first = text.split("\n", 1)[0]
    delim = max((";", ",", "\t"), key=lambda d: (first.count(d), d == ","))
    rows, row, cell, quoted, i = [], [], [], False, 0
    while i < len(text):
        ch = text[i]
        if quoted:
            if ch == '"' and text[i + 1:i + 2] == '"':
                cell.append('"')
                i += 1
            elif ch == '"':
                quoted = False
            else:
                cell.append(ch)
        elif ch == '"' and not cell:
            quoted = True
        elif ch == delim:
            row.append("".join(cell))
            cell = []
        elif ch in "\r\n":
            if ch == "\r" and text[i + 1:i + 2] == "\n":
                i += 1
            row.append("".join(cell))
            rows.append(row)
            row, cell = [], []
        else:
            cell.append(ch)
        i += 1
    if cell or row:
        row.append("".join(cell))
        rows.append(row)
    return [r for r in rows if any(c.strip() for c in r)]


def parse_csv(text: object, default_side: str = "kuyov") -> dict:
    """``{"rows": [{name, seats, side, grp}], "errors": [{"line": n, "code": c}]}`` (line numbers from 1)."""
    if not isinstance(text, str) or len(text) > 200_000:
        raise InputError("csv")
    rows = split_rows(text)
    start = 1 if rows and clean(rows[0][0], 40).lower() in HEADER_WORDS else 0
    if len(rows) - start > MAX_ROWS:
        raise InputError("csv_too_many")
    out, errors = [], []
    for n, cells in enumerate(rows[start:], start=start + 1):
        cells = [*cells, "", "", ""]
        name = clean(cells[0], NAME_MAX)
        seats_raw = clean(cells[1], 4)
        side_raw = clean(cells[2], 20).lower()
        if len(name) < 2:
            errors.append({"line": n, "code": "name"})
            continue
        if seats_raw and not (seats_raw.isascii() and seats_raw.isdigit() and SEATS[0] <= int(seats_raw) <= SEATS[1]):
            errors.append({"line": n, "code": "seats"})
            continue
        if side_raw and side_raw not in SIDE_WORDS:
            errors.append({"line": n, "code": "side"})
            continue
        out.append({"name": name, "seats": int(seats_raw) if seats_raw else 1,
                    "side": SIDE_WORDS.get(side_raw, default_side), "grp": clean(cells[3], GROUP_MAX)})
    return {"rows": out, "errors": errors}


def safe_cell(value: object) -> str:
    s = str(value)
    if s[:1] in ("=", "+", "-", "@", "\t", "\r"):
        s = "'" + s
    if any(ch in s for ch in ',"\n\r'):
        s = '"' + s.replace('"', '""') + '"'
    return s


def export_csv(invites: list[dict]) -> str:
    lines = [",".join(EXPORT_HEAD)]
    for inv in sorted(invites, key=lambda x: (x["side"], x["grp"], x["name"], x["id"])):
        lines.append(",".join(safe_cell(v) for v in (
            inv["name"], inv["seats"], "Kuyov tomoni" if inv["side"] == "kuyov" else "Kelin tomoni", inv["grp"],
            STATUS_WORDS[inv["status"]], inv["people"], inv.get("checked_in", 0), inv.get("note", ""))))
    return "﻿" + "\r\n".join(lines) + "\r\n"
