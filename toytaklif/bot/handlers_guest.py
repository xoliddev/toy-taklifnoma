"""The guest in the bot: the invitation card, Kelaman / Kelolmayman / Hali bilmayman, how many people, a wish,
and the QR pass as a picture. Only invites this Telegram user opened (deep link) are reachable."""

from __future__ import annotations

from aiogram import F, Router
from aiogram.filters import StateFilter
from aiogram.fsm.context import FSMContext
from aiogram.types import BufferedInputFile, CallbackQuery, Message

from ..common import Refused
from ..i18n import answer_line, plain, t
from ..qrpng import png
from . import views
from .cb import Flow, N
from .setup import show

router = Router(name="guest")


async def mine(svc, me: int, iid: int) -> tuple[dict, dict]:
    inv = await svc.invite(iid)
    if inv["tg"] != me:
        raise Refused("not_found")
    w = await svc.wedding(inv["wedding_id"])
    if w["status"] != "active":
        raise Refused("not_found")
    return inv, w


async def card(event, svc, me, lang, cfg, iid: int) -> None:
    inv, w = await mine(svc, me, iid)
    await show(event, views.guest_card(lang, inv, w, svc.now()), cfg)


async def answered(event, svc, me, lang, cfg, notifier, iid: int, answer: dict) -> None:
    view, ev = await svc.answer_as(me, iid, answer)
    if ev["changed"]:
        await notifier.answered(ev)
    if ev["wish"]:
        await notifier.wish(ev)
    if isinstance(event, CallbackQuery):
        await event.answer(plain(t(lang, "guest.saved", answer=answer_line(lang, ev["invite"]))))
    await card(event, svc, me, lang, cfg, iid)
    if ev["changed"] and view["pass"]:
        await notifier.qr(ev["invite"])


@router.callback_query(F.data.regexp(rf"^g:{N}$").as_("m"))
async def open_card(cq: CallbackQuery, m, state: FSMContext, svc, me, lang, cfg) -> None:
    await state.clear()
    await card(cq, svc, me, lang, cfg, int(m.group(1)))


@router.callback_query(F.data.regexp(rf"^r:{N}:(yes|no|maybe)$").as_("m"))
async def answer(cq: CallbackQuery, m, svc, me, lang, cfg, notifier) -> None:
    iid, status = int(m.group(1)), m.group(2)
    inv, _ = await mine(svc, me, iid)
    if status == "yes" and inv["seats"] > 1:
        await show(cq, views.pick_people(lang, inv), cfg)
        return
    people = 1 if status == "yes" else inv["seats"] if status == "maybe" else 0
    await answered(cq, svc, me, lang, cfg, notifier, iid, {"status": status, "people": people})


@router.callback_query(F.data.regexp(rf"^p:{N}:(\d{{1,2}})$").as_("m"))
async def answer_people(cq: CallbackQuery, m, svc, me, lang, cfg, notifier) -> None:
    await answered(cq, svc, me, lang, cfg, notifier, int(m.group(1)), {"status": "yes", "people": int(m.group(2))})


@router.callback_query(F.data.regexp(rf"^w:{N}$").as_("m"))
async def ask_wish(cq: CallbackQuery, m, state: FSMContext, svc, me, lang) -> None:
    inv, _ = await mine(svc, me, int(m.group(1)))
    await state.set_state(Flow.wish)
    await state.update_data(iid=inv["id"])
    await cq.answer()
    await cq.message.answer(t(lang, "guest.wish_ask"))


@router.message(StateFilter(Flow.wish), F.text)
async def got_wish(message: Message, state: FSMContext, svc, me, lang, cfg, notifier) -> None:
    iid = (await state.get_data()).get("iid")
    await state.clear()
    inv, _ = await mine(svc, me, iid)
    if len((message.text or "").strip()) < 2:
        raise Refused("text")
    answer = {"status": inv["status"] if inv["status"] != "none" else "maybe", "people": inv["people"] or inv["seats"],
              "note": inv["note"], "wish": message.text[:3000]}
    if answer["status"] == "no":
        answer["people"] = 0
    await message.answer(t(lang, "guest.wish_saved"))
    await answered(message, svc, me, lang, cfg, notifier, iid, answer)


@router.callback_query(F.data.regexp(rf"^q:{N}$").as_("m"))
async def send_qr(cq: CallbackQuery, m, svc, me, lang) -> None:
    inv, w = await mine(svc, me, int(m.group(1)))
    pas = svc.pass_for(inv)
    if not pas:
        await cq.answer(t(lang, "guest.no_qr"), show_alert=True)
        return
    await cq.answer()
    await cq.message.answer_photo(BufferedInputFile(png(pas["token"]), "qr.png"),
                                  caption=views.qr_caption(lang, inv, w, pas["code"]))
