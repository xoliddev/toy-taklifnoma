"""The hosts in the bot: the live summary, groups, guests with personal links, adding invites one by one or from a
CSV file, export, wishes, reminders, a broadcast to everyone coming, and settings (look, music, map, links)."""

from __future__ import annotations

from aiogram import F, Router
from aiogram.filters import StateFilter
from aiogram.fsm.context import FSMContext
from aiogram.types import BufferedInputFile, CallbackQuery, Message

from ..common import Refused
from ..core.rsvp import NAME_MAX
from ..core.text import clean
from ..i18n import date_short, t
from . import views_host as vh
from .cb import Flow, N
from .setup import show

router = Router(name="host")
MAX_CSV_BYTES = 200_000


async def summary_screen(event, svc, me, lang, cfg, wid: int) -> None:
    await show(event, vh.summary(lang, await svc.dashboard(me, wid)), cfg)


def wid_of(m) -> int:
    return int(m.group(1))


@router.callback_query(F.data.regexp(rf"^h:{N}$").as_("m"))
async def home(cq: CallbackQuery, m, state: FSMContext, svc, me, lang, cfg) -> None:
    await state.clear()
    await summary_screen(cq, svc, me, lang, cfg, wid_of(m))


@router.callback_query(F.data.regexp(rf"^hg:{N}$").as_("m"))
async def groups(cq: CallbackQuery, m, svc, me, lang, cfg) -> None:
    await show(cq, vh.groups(lang, await svc.dashboard(me, wid_of(m))), cfg)


@router.callback_query(F.data.regexp(rf"^hl:{N}:(\d{{1,3}})$").as_("m"))
async def guests(cq: CallbackQuery, m, svc, me, lang, cfg) -> None:
    items = await svc.invite_links(me, wid_of(m))
    await show(cq, vh.guest_list(lang, wid_of(m), items, int(m.group(2))), cfg)


@router.callback_query(F.data.regexp(rf"^hi:{N}$").as_("m"))
async def invite(cq: CallbackQuery, m, svc, me, lang, cfg) -> None:
    x = await svc.invite(int(m.group(1)))
    await svc.require_host(me, x["wedding_id"])
    await show(cq, vh.invite_detail(lang, x, cfg.invite_link(x["token"])), cfg)


# ── add one invite: name -> seats -> side -> group ──
@router.callback_query(F.data.regexp(rf"^ha:{N}$").as_("m"))
async def add_start(cq: CallbackQuery, m, state: FSMContext, svc, me, lang) -> None:
    await svc.require_host(me, wid_of(m))
    await state.set_state(Flow.add_name)
    await state.update_data(wid=wid_of(m))
    await cq.answer()
    await cq.message.answer(t(lang, "host.add_name"))


@router.message(StateFilter(Flow.add_name), F.text)
async def add_name(message: Message, state: FSMContext, lang, cfg) -> None:
    name = clean(message.text, NAME_MAX)
    if len(name) < 2:
        raise Refused("name")
    await state.update_data(name=name)
    await show(message, vh.add_seats(lang, name), cfg)


@router.callback_query(StateFilter(Flow.add_name), F.data.regexp(r"^has:([1-8])$").as_("m"))
async def add_seats(cq: CallbackQuery, m, state: FSMContext, lang, cfg) -> None:
    await state.update_data(seats=int(m.group(1)))
    await show(cq, vh.add_side(lang), cfg)


@router.callback_query(StateFilter(Flow.add_name), F.data.regexp(r"^hsd:(kuyov|kelin)$").as_("m"))
async def add_side(cq: CallbackQuery, m, state: FSMContext, svc, me, lang, cfg) -> None:
    await state.update_data(side=m.group(1))
    await state.set_state(Flow.add_group)
    d = await svc.dashboard(me, (await state.get_data())["wid"])
    await state.update_data(groups=[g["name"] for g in d["summary"]["groups"] if g["name"]][:8])
    await show(cq, vh.add_group(lang, (await state.get_data())["groups"]), cfg)


async def add_finish(event, state: FSMContext, svc, me, lang, cfg, grp: str) -> None:
    d = await state.get_data()
    await state.clear()
    if not {"wid", "name", "seats", "side"} <= d.keys():
        raise Refused("stale")
    x = (await svc.add_invites(me, d["wid"], [{"name": d["name"], "seats": d["seats"], "side": d["side"], "grp": grp}]))[0]
    await show(event, (t(lang, "host.added", name=x["name"], seats=x["seats"], link=cfg.invite_link(x["token"])),
                       [[(t(lang, "btn.add"), f"ha:{d['wid']}")], [(t(lang, "btn.back"), f"h:{d['wid']}")]]), cfg)


@router.callback_query(StateFilter(Flow.add_group), F.data.regexp(r"^hgr:(\d|-)$").as_("m"))
async def add_group_pick(cq: CallbackQuery, m, state: FSMContext, svc, me, lang, cfg) -> None:
    names = (await state.get_data()).get("groups", [])
    k = m.group(1)
    if k != "-" and int(k) >= len(names):
        raise Refused("stale")
    await add_finish(cq, state, svc, me, lang, cfg, "" if k == "-" else names[int(k)])


@router.message(StateFilter(Flow.add_group), F.text)
async def add_group_typed(message: Message, state: FSMContext, svc, me, lang, cfg) -> None:
    await add_finish(message, state, svc, me, lang, cfg, message.text or "")


# ── CSV in and out ──
@router.callback_query(F.data.regexp(rf"^hc:{N}$").as_("m"))
async def csv_ask(cq: CallbackQuery, m, state: FSMContext, svc, me, lang) -> None:
    await svc.require_host(me, wid_of(m))
    await state.set_state(Flow.import_csv)
    await state.update_data(wid=wid_of(m))
    await cq.answer()
    await cq.message.answer(t(lang, "host.import_ask"))


@router.message(StateFilter(Flow.import_csv), F.document)
async def csv_got(message: Message, state: FSMContext, svc, me, lang, cfg) -> None:
    wid = (await state.get_data())["wid"]
    doc = message.document
    if (doc.file_size or 0) > MAX_CSV_BYTES:
        raise Refused("csv")
    raw = await message.bot.download(doc)
    data = raw.read() if raw else b""
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        text = data.decode("cp1251", errors="replace")  # an old Russian Excel
    res = await svc.import_csv(me, wid, text)
    await state.clear()
    out = t(lang, "host.imported", n=len(res["added"]))
    if res["errors"]:
        lines = ", ".join(f"{e['line']} ({t(lang, 'err.' + e['code']).rstrip('.')})" for e in res["errors"][:15])
        out += "\n" + t(lang, "host.import_errors", lines=lines)
    await message.answer(out)
    await summary_screen(message, svc, me, lang, cfg, wid)


@router.callback_query(F.data.regexp(rf"^hx:{N}$").as_("m"))
async def csv_export(cq: CallbackQuery, m, svc, me, lang) -> None:
    csv = await svc.export_csv(me, wid_of(m))
    w = await svc.wedding(wid_of(m))
    await cq.answer()
    await cq.message.answer_document(BufferedInputFile(csv.encode("utf-8"), f"mehmonlar-{w['id']}.csv"),
                                     caption=t(lang, "host.export_caption", couple=f"{w['groom']} & {w['bride']}",
                                               date=date_short(svc.now())))


# ── wishes, reminders, broadcast ──
@router.callback_query(F.data.regexp(rf"^hw:{N}$").as_("m"))
async def wishes(cq: CallbackQuery, m, svc, me, lang, cfg) -> None:
    await show(cq, vh.wish(lang, wid_of(m), (await svc.dashboard(me, wid_of(m)))["pending"]), cfg)


@router.callback_query(F.data.regexp(rf"^hwd:{N}:{N}:([ah])$").as_("m"))
async def wish_decide(cq: CallbackQuery, m, svc, me, lang, cfg) -> None:
    await svc.decide_wish(me, wid_of(m), int(m.group(2)), "approve" if m.group(3) == "a" else "hide")
    await show(cq, vh.wish(lang, wid_of(m), (await svc.dashboard(me, wid_of(m)))["pending"]), cfg)


@router.callback_query(F.data.regexp(rf"^hr:{N}$").as_("m"))
async def remind_ask(cq: CallbackQuery, m, svc, me, lang, cfg) -> None:
    d = await svc.dashboard(me, wid_of(m))
    await show(cq, vh.remind_ask(lang, wid_of(m), d["summary"]["remind_due"]), cfg)


@router.callback_query(F.data.regexp(rf"^hrg:{N}$").as_("m"))
async def remind_go(cq: CallbackQuery, m, svc, me, lang, cfg, notifier) -> None:
    rows = await svc.remind(me, wid_of(m))
    await notifier.remind(wid_of(m), rows)
    await cq.answer(t(lang, "host.reminded", n=len(rows)), show_alert=True)
    await summary_screen(cq, svc, me, lang, cfg, wid_of(m))


@router.callback_query(F.data.regexp(rf"^hb:{N}$").as_("m"))
async def broadcast_ask(cq: CallbackQuery, m, state: FSMContext, svc, me, lang) -> None:
    await svc.require_host(me, wid_of(m))
    await state.set_state(Flow.broadcast)
    await state.update_data(wid=wid_of(m))
    await cq.answer()
    await cq.message.answer(t(lang, "host.broadcast_ask"))


@router.message(StateFilter(Flow.broadcast), F.text)
async def broadcast_text(message: Message, state: FSMContext, svc, me, lang, cfg) -> None:
    wid = (await state.get_data())["wid"]
    text = clean(message.text, 500)
    if len(text) < 3:
        raise Refused("text")
    await state.update_data(text=text)
    n = (await svc.dashboard(me, wid))["summary"]["yes"]
    await show(message, vh.broadcast_confirm(lang, wid, text, n), cfg)


@router.callback_query(StateFilter(Flow.broadcast), F.data.regexp(rf"^hbg:{N}$").as_("m"))
async def broadcast_go(cq: CallbackQuery, m, state: FSMContext, svc, me, lang, cfg, notifier) -> None:
    d = await state.get_data()
    await state.clear()
    if d.get("wid") != wid_of(m) or not d.get("text"):
        raise Refused("stale")
    text, rows = await svc.broadcast(me, wid_of(m), d["text"])
    await notifier.broadcast(wid_of(m), rows, text)
    await cq.answer(t(lang, "host.broadcast_done", n=len(rows)), show_alert=True)
    await summary_screen(cq, svc, me, lang, cfg, wid_of(m))
