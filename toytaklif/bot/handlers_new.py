"""A new wedding in six short questions (names, date, time, venue, address, hall size, side), and the hosts'
settings: the look of the invitation, music on or off, the venue on the map, the co-host and checker links."""

from __future__ import annotations

from aiogram import F, Router
from aiogram.filters import StateFilter
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, Message

from ..common import Refused
from ..core.clock import DAY_MS
from ..hosts import parse_couple, parse_date, parse_time
from ..i18n import date_short, t
from . import views_host as vh
from .cb import Flow, N
from .handlers_host import summary_screen
from .markup import markup
from .setup import show

router = Router(name="new")
STEPS = [(Flow.new_names, "couple"), (Flow.new_date, "date"), (Flow.new_time, "time"), (Flow.new_venue, "venue"),
         (Flow.new_address, "address"), (Flow.new_capacity, "capacity")]
ASK = {"couple": "new.date", "date": "new.time", "time": "new.venue", "venue": "new.address", "address": "new.capacity"}


@router.callback_query(F.data == "n:new")
async def new_start(cq: CallbackQuery, state: FSMContext, lang) -> None:
    await state.clear()
    await state.set_state(Flow.new_names)
    await cq.answer()
    await cq.message.answer(t(lang, "new.names"))


@router.message(StateFilter(*[s for s, _ in STEPS]), F.text)
async def new_step(message: Message, state: FSMContext, svc, lang) -> None:
    current = await state.get_state()
    k = next(i for i, (s, _) in enumerate(STEPS) if s.state == current)
    key, text = STEPS[k][1], (message.text or "")[:200]
    if key == "couple":
        parse_couple(text)
    elif key == "date":
        parse_date(text, svc.now())
    elif key == "time":
        parse_time(text)
    elif key in ("venue", "address") and len(text.strip()) < 2:
        raise Refused("text")
    await state.update_data(**{key: text})
    if key == "capacity":
        if not (text.strip().isascii() and text.strip().isdigit() and 10 <= int(text.strip()) <= 3000):
            raise Refused("capacity")
        await state.update_data(capacity=text.strip())
        rows = [[(t(lang, "btn.kuyov"), "ns:kuyov"), (t(lang, "btn.kelin"), "ns:kelin")]]
        await message.answer(t(lang, "new.side"), reply_markup=markup(rows))
        return
    await state.set_state(STEPS[k + 1][0])
    example = date_short(svc.now() + 30 * DAY_MS)
    await message.answer(t(lang, ASK[key], example=example))


@router.callback_query(StateFilter(Flow.new_capacity), F.data.regexp(r"^ns:(kuyov|kelin)$").as_("m"))
async def new_done(cq: CallbackQuery, m, state: FSMContext, svc, me, lang, cfg) -> None:
    d = await state.get_data()
    await state.clear()
    if not {"couple", "date", "time", "venue", "address", "capacity"} <= d.keys():
        raise Refused("stale")
    w = await svc.create_wedding(me, {**d, "side": m.group(1)})
    await cq.answer()
    await cq.message.answer(t(lang, "new.done"))
    await summary_screen(cq.message, svc, me, lang, cfg, w["id"])


# ── settings ──
@router.callback_query(F.data.regexp(rf"^hs:{N}$").as_("m"))
async def settings(cq: CallbackQuery, m, state: FSMContext, svc, me, lang, cfg) -> None:
    await state.clear()
    await show(cq, vh.settings(lang, await svc.require_host(me, int(m.group(1)))), cfg)


@router.callback_query(F.data.regexp(rf"^hs([tm]):{N}:(milliy|oltin|bahor|soft|none)$").as_("m"))
async def set_look(cq: CallbackQuery, m, svc, me, lang, cfg) -> None:
    key = "theme" if m.group(1) == "t" else "music"
    w = await svc.settings(me, int(m.group(2)), {key: m.group(3)})
    await show(cq, vh.settings(lang, {**w, "my_side": ""}), cfg)


@router.callback_query(F.data.regexp(rf"^hsl:{N}$").as_("m"))
async def location_ask(cq: CallbackQuery, m, state: FSMContext, svc, me, lang) -> None:
    await svc.require_host(me, int(m.group(1)))
    await state.set_state(Flow.location)
    await state.update_data(wid=int(m.group(1)))
    await cq.answer()
    await cq.message.answer(t(lang, "host.location_ask"))


@router.message(StateFilter(Flow.location), F.location)
async def location_got(message: Message, state: FSMContext, svc, me, lang, cfg) -> None:
    wid = (await state.get_data())["wid"]
    await state.clear()
    await svc.settings(me, wid, {"location": [message.location.latitude, message.location.longitude]})
    await message.answer(t(lang, "host.location_saved"))
    await show(message, vh.settings(lang, await svc.require_host(me, wid)), cfg)


@router.callback_query(F.data.regexp(rf"^hs([hc]):{N}$").as_("m"))
async def share_link(cq: CallbackQuery, m, svc, me, lang, cfg) -> None:
    w = await svc.require_host(me, int(m.group(2)))
    host = m.group(1) == "h"
    link = f"https://t.me/{cfg.bot_username}?start={'h' if host else 'c'}_{w['host_token' if host else 'checker_token']}"
    await cq.answer()
    await cq.message.answer(t(lang, "host.cohost_link" if host else "host.checker_link", link=link),
                            disable_web_page_preview=True)
