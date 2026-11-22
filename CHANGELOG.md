# Changelog

## 1.0.0 — 2026-11-22

First release (day 4 of the 30-day portfolio challenge).

- Personal wedding invitation page (website at `/i/<link>` and Telegram Mini App): sealed-envelope intro, three looks
  drawn in code (milliy girih, oq-oltin, gulli bahor), live countdown in Tashkent time, venue map with directions,
  program, dress code, approved wishes, Uzbek and Russian. A gentle original waltz synthesised with WebAudio, off by
  default; hosts can switch music off entirely. `prefers-reduced-motion` honoured.
- RSVP: Kelaman / Kelolmayman / Hali bilmayman, people up to the invite's seats (server-side), note and wish, changes
  until the host's deadline; wishes shown after a host approves them.
- Hosts' live dashboard: ring against the hall capacity, answers, kuyov / kelin sides, groups, tables at N per table,
  latest answers, reminders (once per guest per 24 h, claimed with `UPDATE … RETURNING`), broadcast to everyone coming,
  look and music, CSV export; revision-based polling.
- Signed QR passes (HMAC-SHA256, 128-bit tag, version bump on every changed answer) with a 10-character manual code;
  atomic door check-in with partial arrival; door screen with `BarcodeDetector` and manual entry.
- aiogram 3 bot (buttons only, uz/ru): guest card with answers, people, wish and QR photo; host summary, groups, guest
  list with personal links, add one or import a CSV, export, wishes, reminders, broadcast, settings, new-wedding wizard,
  co-host and checker deep links, door by code, admin.
- Pure core with a JS port and shared vectors, including a QR encoder and a plain-JS SHA-256/HMAC; pytest (core,
  service, races, bot end-to-end, HTTP) and `node --test` (parity, demo over 30 days and New Year); Playwright e2e.
- GitHub Pages demo: guest, host and door phones, simulated bot, eleven-step story (in order or out of order), and the
  full-page invitation.
