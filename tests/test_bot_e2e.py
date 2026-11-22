"""The real aiogram handlers against a mocked Bot API: a guest answers in the bot, the hosts see it, the door lets
the family in, and the hosts' tools (add, CSV, wishes, reminders, broadcast, settings, new wedding) work."""

from __future__ import annotations

from toytaklif.core import qrtoken

from .helpers import ADMIN, CHECKER, FAMILY, GUEST, HOST, HOST2, SECRET, STRANGER, link, service_env, wedding_day
from .tg_sim import TgSim


async def test_guest_deep_link_answer_people_wish_and_qr():
    async with service_env() as (svc, _):
        tg = TgSim(svc)
        await tg.say(GUEST, f"/start {await link(svc, FAMILY)}")
        assert "Hurmatli Karimovlar oilasi!" in tg.last(GUEST) and "Javob berilmagan" in tg.last(GUEST)
        await tg.tap(GUEST, "✅ Kelaman")
        assert "Necha kishi" in tg.last(GUEST)
        await tg.tap(GUEST, "3")
        assert "✅ Kelaman — 3 kishi" in tg.last(GUEST)
        assert any("Karimovlar oilasi" in x and "Kelaman" in x for x in tg.texts(HOST))  # the host's phone lights up
        assert any("Karimovlar oilasi" in x for x in tg.texts(HOST2))
        png, caption = tg.session.photos[GUEST][-1]
        assert png.startswith(b"\x89PNG") and "Karimovlar oilasi" in caption and "<code>" in caption
        await tg.tap(GUEST, "✍️ Tabrik")
        await tg.say(GUEST, "Baxtingiz <b>bardavom</b> bo'lsin!")
        assert any("Yangi tabrik" in x for x in tg.texts(HOST))
        assert (await svc.dashboard(HOST, 1))["pending"][-1]["text"] == "Baxtingiz <b>bardavom</b> bo'lsin!"
        await tg.tap(GUEST, "🎟 Kirish QR")
        assert len(tg.session.photos[GUEST]) == 2


async def test_host_summary_wishes_remind_broadcast():
    async with service_env() as (svc, _):
        tg = TgSim(svc)
        await tg.say(HOST, "/start")
        await tg.tap(HOST, "📊 Sardor & Madina")
        text = tg.last(HOST)
        assert "Zal:" in text and "▰" in text and "Stollar" in text and "Kuyov tomoni" in text
        await tg.tap(HOST, "💬 Tabriklar")
        assert "tabrigi" in tg.last(HOST)
        await tg.tap(HOST, "✅ Ko'rsatish")
        assert "Tasdiq kutayotgan tabrik yo'q" in tg.last(HOST)
        await tg.tap(HOST, "⬅️ Orqaga")
        await tg.tap(HOST, "🔔 Eslatma")
        await tg.tap(HOST, "🔔 Yuborish")
        reminded = [uid for uid, msgs in tg.session.chats.items() if any("javob kutmoqda" in m["text"] for m in msgs)]
        assert GUEST in reminded and len(reminded) > 10
        assert any("eslatma yuborildi" in a for a in tg.alerts())
        await tg.tap(HOST, "📣 Hammaga")
        await tg.say(HOST, "Kirish Lolazor ko'chasi tomondan")
        assert "mehmonga yuboriladi" in tg.last(HOST)
        await tg.tap(HOST, "📣 Yuborish")
        assert any("yuborildi" in a for a in tg.alerts())


async def test_host_adds_invite_imports_and_exports_csv():
    async with service_env() as (svc, _):
        tg = TgSim(svc)
        await tg.say(HOST, "/start")
        await tg.tap(HOST, "📊 Sardor")
        await tg.tap(HOST, "➕ Taklif")
        await tg.say(HOST, "Aliyevlar oilasi")
        await tg.tap(HOST, "4")
        await tg.tap(HOST, "👰 Kelin")
        await tg.tap(HOST, "Do'stlar")
        assert "Taklif qo'shildi" in tg.last(HOST) and "https://toy.example/i/" in tg.last(HOST)
        await tg.tap(HOST, "⬅️ Orqaga")
        await tg.tap(HOST, "📥 CSV")
        await tg.send_file(HOST, "list.csv", b"Ism;Joy;Tomon;Guruh\nSobirovlar oilasi;3;kelin;Qo'shnilar\nX;1;;\n")
        assert any("1 ta taklif qo'shildi" in x and "Qabul qilinmagan qatorlar: 3" in x for x in tg.texts(HOST))
        await tg.tap(HOST, "📤 CSV")
        csv = tg.session.documents[HOST][-1].decode("utf-8")
        assert "Aliyevlar oilasi,4,Kelin tomoni,Do'stlar" in csv and "Sobirovlar oilasi" in csv
        await tg.tap(HOST, "📋 Mehmonlar")
        await tg.tap(HOST, "▶️")
        assert "2/" in tg.last(HOST)


async def test_door_by_code_and_roles_stay_apart():
    async with service_env() as (svc, clock):
        tg = TgSim(svc)
        page, _ = await svc.answer(await link(svc, FAMILY), {"status": "yes", "people": 3})
        await wedding_day(svc, clock)
        await tg.say(CHECKER, "/start")
        assert "📊" not in " ".join(tg.buttons(CHECKER))  # a checker has no host panel
        await tg.tap(CHECKER, "🚪 Sardor")
        await tg.say(CHECKER, page["pass"]["code"].lower())
        assert any("✅ <b>Karimovlar oilasi</b> — 3 kishi" in x for x in tg.texts(CHECKER))
        await tg.say(CHECKER, page["pass"]["code"])
        assert any("allaqachon ishlatilgan" in x for x in tg.texts(CHECKER))
        forged = page["pass"]["token"].replace(".3.", ".5.")
        await tg.say(CHECKER, forged)
        assert "Soxta" in tg.texts(CHECKER)[-2]
        for data in ("h:1", "hl:1:0", "hx:1", "hrg:1", "hwd:1:1:a", "hs:1"):
            await tg.tap_data(CHECKER, data)
        assert all("Topilmadi" in a or "eskirgan" in a for a in tg.alerts())
        assert qrtoken.verify(SECRET, page["pass"]["token"])


async def test_forged_buttons_and_other_peoples_invites():
    async with service_env() as (svc, _):
        tg = TgSim(svc)
        await tg.say(STRANGER, "/start")
        for data in ("g:1", "r:1:yes", "p:1:3", "q:1", "hi:1", "ad:1:1", "zz:1", "r:1:sure", "d:1", "n:admin"):
            await tg.tap_data(STRANGER, data)
        alerts = tg.alerts()
        assert len(alerts) == 10 and all("Topilmadi" in a or "eskirgan" in a for a in alerts)
        assert (await svc.invite(FAMILY))["status"] == "none"
        await tg.say(STRANGER, "/start h_" + "A" * 22)
        assert any("Topilmadi" in x for x in tg.texts(STRANGER))


async def test_new_wedding_wizard_settings_links_and_admin():
    async with service_env() as (svc, _):
        tg = TgSim(svc)
        await tg.say(STRANGER, "/start")
        await tg.tap(STRANGER, "💍 Yangi")
        for answer in ("Jasur va Laylo", "31.02.2027"):
            await tg.say(STRANGER, answer)
        assert "KK.OO.YYYY" in tg.last(STRANGER)
        for answer in ("05.01.2027", "17:30", "Navbahor", "Yunusobod, 4-kvartal", "150"):
            await tg.say(STRANGER, answer)
        await tg.tap(STRANGER, "👰 Kelin")
        assert any("yaratildi" in x for x in tg.texts(STRANGER)), tg.texts(STRANGER)[-4:]
        assert "Jasur &amp; Laylo" in tg.last(STRANGER)
        await tg.tap(STRANGER, "⚙️ Sozlamalar")
        await tg.tap(STRANGER, "Gulli bahor")
        assert "Ko'rinish: Gulli bahor" in tg.last(STRANGER)
        await tg.tap(STRANGER, "📍 Joylashuv")
        await tg.send_location(STRANGER, 41.36, 69.28)
        assert "xaritada belgilangan" in tg.last(STRANGER)
        await tg.tap(STRANGER, "🤝 Ikkinchi")
        cohost = tg.last(STRANGER).split("start=")[1].split()[0]
        await tg.say(HOST, f"/start {cohost}")
        assert any("Jasur &amp; Laylo" in x and "Kuyov tomoni" in x for x in tg.texts(HOST))
        await tg.say(ADMIN, "/start")
        await tg.tap(ADMIN, "🛡 Admin")
        assert "Jasur &amp; Laylo" in tg.last(ADMIN)
        await tg.tap(ADMIN, "🚫 Yopish #1")
        assert (await svc.wedding(1))["status"] == "blocked"
