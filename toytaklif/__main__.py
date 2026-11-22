"""Run everything in one process: ``python -m toytaklif``.

* the Telegram bot (long polling),
* the aiohttp server: the invitation website (/i/<link>), the Mini App (/webapp/) and their APIs.
State lives in SQLite, so a restart loses nothing.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os

from aiogram import Bot
from aiogram.client.default import DefaultBotProperties
from aiogram.types import MenuButtonWebApp, WebAppInfo
from aiohttp import web

from .bot.notify import Notifier
from .bot.setup import BotConfig, build_dispatcher
from .config import Settings
from .core import seedgen
from .db import Database
from .service import Service
from .web import ROOT, make_app

log = logging.getLogger("toytaklif")


async def main() -> None:
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"),
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    cfg = Settings.from_env()
    db = await Database.open(cfg.db_path)
    service = Service(db, cfg.qr_secret, admins=cfg.admin_ids)
    if cfg.seed_demo:
        with open(ROOT / "shared" / "data" / "names.json", encoding="utf-8") as fh:
            if await service.seed(seedgen.world(json.load(fh), service.now())):
                log.info("seeded the fictional demo wedding (80 invites)")
    bot = Bot(cfg.bot_token, default=DefaultBotProperties(parse_mode="HTML"))
    me = await bot.get_me()
    bcfg = BotConfig(me.username or "", cfg.webapp_url, cfg.public_url)
    dp = build_dispatcher(service, bot, bcfg, cfg.rate_per_minute)
    notifier = Notifier(bot, service, bcfg)
    if cfg.webapp_url:
        await bot.set_chat_menu_button(menu_button=MenuButtonWebApp(text="Taklifnoma", web_app=WebAppInfo(url=cfg.webapp_url)))
    app = make_app(service, cfg.bot_token, notifier, cfg.initdata_max_age, cfg.rate_per_minute, cfg.public_rate_per_minute,
                   cfg.trust_proxy)
    runner = web.AppRunner(app)
    await runner.setup()
    await web.TCPSite(runner, cfg.host, cfg.port).start()
    log.info("invitation site and Mini App on http://%s:%s/  bot: @%s", cfg.host, cfg.port, me.username)
    try:
        await dp.start_polling(bot, allowed_updates=dp.resolve_used_update_types())
    finally:
        await runner.cleanup()
        await bot.session.close()
        await db.close()


if __name__ == "__main__":
    asyncio.run(main())
