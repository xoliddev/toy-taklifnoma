"""Texts for the bot, read from shared/locales/*.json (the invitation page, the Mini App and the browser demo read
the same files), plus the formatters every screen needs. shared/i18n.js is the same code for the browser."""

from __future__ import annotations

import html
import json
import re
from functools import cache
from pathlib import Path

from .core.clock import DAY_MS, HOUR_MS, MIN_MS, civil, countdown, hhmm, local_day, local_minute, weekday

LOCALE_DIR = Path(__file__).resolve().parent.parent / "shared" / "locales"
_PLACEHOLDER = re.compile(r"\{(\w+)\}")
MARKS = {"yes": "✅", "no": "❌", "maybe": "🤔", "none": "✉️"}


def norm_lang(code: str | None) -> str:
    return "ru" if code and str(code)[:2].lower() == "ru" else "uz"


class Raw(str):
    """A parameter that is already safe HTML (for example a nested, already-rendered text)."""


@cache
def catalog(lang: str) -> dict[str, str]:
    with open(LOCALE_DIR / f"{lang}.json", encoding="utf-8") as fh:
        return json.load(fh)


def render(template: str, params: dict) -> str:
    def sub(m: re.Match) -> str:
        if m.group(1) not in params:
            return m.group(0)
        value = params[m.group(1)]
        return value if isinstance(value, Raw) else html.escape(str(value), quote=False)

    return _PLACEHOLDER.sub(sub, template)


def t(lang: str, key: str, **params: object) -> str:
    """Localized text; parameters are HTML-escaped unless wrapped in ``Raw``."""
    lang = norm_lang(lang)
    template = catalog(lang).get(key) or catalog("uz").get(key) or key
    return render(template, params)


def plain(text: str) -> str:
    """For callback alerts, which show plain text."""
    return html.unescape(re.sub(r"<[^>]+>", "", text))


def couple(w: dict) -> str:
    return f"{w['groom']} & {w['bride']}"


def date_long(lang: str, ms: int) -> str:
    """ "17-dekabr, payshanba" / "17 декабря, четверг" in Tashkent."""
    day = local_day(ms)
    _, month, d = civil(day)
    return t(lang, "fmt.date", d=d, month=t(lang, f"month.{month}"), wd=t(lang, f"wd.{weekday(day)}"))


def date_short(ms: int) -> str:
    y, m, d = civil(local_day(ms))
    return f"{d:02d}.{m:02d}.{y}"


def clock(ms: int) -> str:
    return hhmm(local_minute(ms))


def left_text(lang: str, left_ms: int) -> str:
    """ "25 kun 3 soat", "5 soat 20 daqiqa", "12 daqiqa", or "boshlandi" when the time has come."""
    if left_ms <= 0:
        return t(lang, "left.started")
    days, hours, minutes, _ = countdown(left_ms)
    if left_ms >= DAY_MS:
        return t(lang, "left.days", d=days, h=hours)
    if left_ms >= HOUR_MS:
        return t(lang, "left.hours", h=hours, m=minutes)
    return t(lang, "left.minutes", m=-(-left_ms // MIN_MS))


def people(lang: str, n: int) -> str:
    return t(lang, "fmt.people", n=n)


def bar(pct: int, width: int = 10) -> str:
    full = min(width, max(0, (pct * width + 50) // 100))
    return "▰" * full + "▱" * (width - full)


def program_title(lang: str, item: dict) -> str:
    return item["text"] if item.get("text") else t(lang, f"prog.{item['key']}")


def answer_line(lang: str, inv: dict) -> str:
    """ "✅ Kelaman — 3 kishi" for the guest's own screen and the host's lists."""
    line = f"{MARKS[inv['status']]} {t(lang, f'status.{inv["status"]}')}"
    if inv["status"] in ("yes", "maybe") and inv["people"]:
        line += f" — {people(lang, inv['people'])}"
    return line
