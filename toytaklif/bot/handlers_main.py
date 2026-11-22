"""/start (with the deep links ``start=<invite>``, ``start=h_<co-host>``, ``start=c_<checker>``), the main menu,
language, admin, the door chat and the stale-button fallback."""

from __future__ import annotations

from aiogram import F, Router
from aiogram.filters import CommandObject, CommandStart, StateFilter
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, Message

from ..common import LINK
from ..i18n import couple, t
from . import views
from .cb import Flow, N
from .setup import show

router = Router(name="main")
fallback = Router(name="fallback")


async def roles(svc, uid: int) -> dict:
    guest = [(inv, await svc.wedding(inv["wedding_id"])) for inv in await svc.guest_invites(uid)]
    return {"guest": guest, "host": await svc.hosted(uid), "door": await svc.checking(uid), "admin": uid in svc.admins}


async def menu(event, svc, me: int, cfg, hello: bool = False) -> None:
    user = await svc.user(me)
    await show(event, views.main_menu(user["lang"], user, await roles(svc, me), hello), cfg)


@router.message(CommandStart())
async def start(message: Message, state: FSMContext, svc, me, lang, cfg, command: CommandObject | None = None) -> None:
    await state.clear()
    arg = (command.args or "") if command else ""
    if LINK.match(arg):
        inv = await svc.bind(arg, me)
        w = await svc.wedding(inv["wedding_id"])
        await show(message, views.guest_card(lang, inv, w, svc.now()), cfg)
        return
    if arg[:2] in ("h_", "c_") and LINK.match(arg[2:]):
        w, side = await svc.join(me, arg[2:], "host" if arg[0] == "h" else "checker")
        if side == "checker":
            await message.answer(t(lang, "host.checker_joined", couple=couple(w)))
            await show(message, views.door_home(lang, await svc.door_status(me, w["id"])), cfg)
        else:
            await message.answer(t(lang, "host.joined", couple=couple(w), side=t(lang, f"side.{side}")))
            from .handlers_host import summary_screen

            await summary_screen(message, svc, me, lang, cfg, w["id"])
        return
    await menu(message, svc, me, cfg, hello=True)


@router.callback_query(F.data == "n:menu")
async def nav_menu(cq: CallbackQuery, state: FSMContext, svc, me, cfg) -> None:
    await state.clear()
    await menu(cq, svc, me, cfg)


@router.callback_query(F.data == "n:lang")
async def nav_lang(cq: CallbackQuery, svc, me, lang, cfg) -> None:
    await svc.set_lang(me, "ru" if lang == "uz" else "uz")
    await menu(cq, svc, me, cfg)


@router.callback_query(F.data == "n:admin")
async def admin(cq: CallbackQuery, svc, me, lang, cfg) -> None:
    await show(cq, views.admin_list(lang, await svc.admin_weddings(me)), cfg)


@router.callback_query(F.data.regexp(rf"^ad:{N}:([01])$").as_("m"))
async def admin_block(cq: CallbackQuery, m, svc, me, lang, cfg) -> None:
    await svc.admin_block(me, int(m.group(1)), m.group(2) == "1")
    await show(cq, views.admin_list(lang, await svc.admin_weddings(me)), cfg)


@router.callback_query(F.data.regexp(rf"^d:{N}$").as_("m"))
async def door(cq: CallbackQuery, m, state: FSMContext, svc, me, lang, cfg) -> None:
    st = await svc.door_status(me, int(m.group(1)))
    await state.set_state(Flow.door_code)
    await state.update_data(wid=st["id"])
    await show(cq, views.door_home(lang, st), cfg)


@router.message(StateFilter(Flow.door_code), F.text)
async def door_code(message: Message, state: FSMContext, svc, me, lang, cfg) -> None:
    """A checker types the short code (or pastes the pass text): let the family in, all who are left."""
    wid = (await state.get_data()).get("wid")
    res = await svc.checkin(me, wid, (message.text or "")[:80])
    await message.answer(views.door_result(lang, res))
    await show(message, views.door_home(lang, await svc.door_status(me, wid)), cfg)


@router.message(F.text.startswith("/"))
async def unknown_command(message: Message, state: FSMContext, svc, me, cfg) -> None:
    """/start is the only command; anything else just brings the menu back."""
    await state.clear()
    await menu(message, svc, me, cfg)


@fallback.callback_query()
async def stale(cq: CallbackQuery, lang) -> None:
    await cq.answer(t(lang, "err.stale"), show_alert=True)


@fallback.message()
async def other(message: Message, svc, me, cfg) -> None:
    await menu(message, svc, me, cfg)
