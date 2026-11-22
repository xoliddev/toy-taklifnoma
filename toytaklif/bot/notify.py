"""Messages the bot sends on its own: a new answer or wish for the hosts, the QR pass for a guest who said
"Kelaman", reminders, the hosts' broadcast and the exported CSV. Used by the bot and the web APIs."""

from __future__ import annotations

import logging

from aiogram import Bot
from aiogram.exceptions import TelegramAPIError
from aiogram.types import BufferedInputFile

from ..i18n import MARKS, answer_line, clock, couple, date_long, date_short, people, t
from ..qrpng import png
from .markup import markup
from .views import qr_caption

log = logging.getLogger(__name__)


class Notifier:
    def __init__(self, bot: Bot, service, cfg) -> None:
        self.bot, self.svc, self.cfg = bot, service, cfg

    async def _send(self, uid: int, text: str, rows=None) -> bool:
        try:
            await self.bot.send_message(uid, text, reply_markup=markup(rows or [], self.cfg.webapp_url),
                                        disable_web_page_preview=True)
            return True
        except TelegramAPIError as err:  # blocked the bot, deleted account...
            log.info("could not notify %s: %s", uid, err)
            return False

    async def _lang(self, uid: int, fallback: str = "uz") -> str:
        return ((await self.svc.user(uid)) or {}).get("lang", fallback)

    async def _hosts(self, wid: int) -> list[int]:
        return [r["user_id"] for r in await self.svc.db.all("SELECT user_id FROM hosts WHERE wedding_id = ?", (wid,))]

    async def answered(self, event: dict) -> None:
        inv, wid = event["invite"], event["wedding_id"]
        w = await self.svc.wedding(wid)
        coming = await self.svc.db.one("SELECT COALESCE(SUM(people), 0) AS n FROM invites WHERE wedding_id = ? "
                                       "AND status = 'yes'", (wid,))
        for uid in await self._hosts(wid):
            lang = await self._lang(uid)
            await self._send(uid, t(lang, "notify.answered", mark=MARKS[inv["status"]], name=inv["name"],
                                    answer=answer_line(lang, inv), couple=couple(w), people=coming["n"],
                                    capacity=w["capacity"]), [[(t(lang, "btn.panel"), f"@app#host={wid}")],
                                                              [(t(lang, "btn.refresh"), f"h:{wid}")]])

    async def wish(self, event: dict) -> None:
        wid = event["wedding_id"]
        for uid in await self._hosts(wid):
            lang = await self._lang(uid)
            await self._send(uid, t(lang, "notify.wish", name=event["invite"]["name"]),
                             [[(t(lang, "btn.wishes", n="…"), f"hw:{wid}")]])

    async def qr(self, inv: dict) -> None:
        if not inv.get("tg"):
            return
        pas = self.svc.pass_for(inv)
        if not pas:
            return
        w = await self.svc.wedding(inv["wedding_id"])
        lang = await self._lang(inv["tg"], inv.get("lang", "uz"))
        try:
            await self.bot.send_photo(inv["tg"], BufferedInputFile(png(pas["token"]), "qr.png"),
                                      caption=qr_caption(lang, inv, w, pas["code"]))
        except TelegramAPIError as err:
            log.info("could not send the pass to %s: %s", inv["tg"], err)

    async def remind(self, wid: int, rows: list[dict]) -> int:
        w = await self.svc.wedding(wid)
        sent = 0
        for inv in rows:
            lang = await self._lang(inv["tg"], inv.get("lang", "uz"))
            sent += await self._send(inv["tg"], t(lang, "notify.remind", name=inv["name"], couple=couple(w),
                                                  date=date_long(lang, w["starts_at"]), time=clock(w["starts_at"]),
                                                  deadline=date_long(lang, w["rsvp_deadline"])),
                                     [[(t(lang, "btn.yes"), f"r:{inv['id']}:yes"), (t(lang, "btn.no"), f"r:{inv['id']}:no")],
                                      [(t(lang, "btn.open_invite"), f"@app#i={inv['token']}")]])
        return sent

    async def broadcast(self, wid: int, rows: list[dict], text: str) -> int:
        w = await self.svc.wedding(wid)
        sent = 0
        for inv in rows:
            lang = await self._lang(inv["tg"], inv.get("lang", "uz"))
            sent += await self._send(inv["tg"], t(lang, "notify.broadcast", couple=couple(w), text=text))
        return sent

    async def export(self, uid: int, wid: int, csv: str) -> None:
        w = await self.svc.wedding(wid)
        lang = await self._lang(uid)
        name = f"mehmonlar-{w['groom']}-{w['bride']}.csv".replace(" ", "_")
        await self.bot.send_document(uid, BufferedInputFile(csv.encode("utf-8"), name),
                                     caption=t(lang, "host.export_caption", couple=couple(w), date=date_short(self.svc.now())))


__all__ = ["Notifier", "people"]
