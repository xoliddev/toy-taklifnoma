// The browser demo's logic, headless: the wedding on any date (30 days in a row, across New Year, morning and night),
// the guided story in order and out of order, live counts, reminders once per 24 h, the door (full, partial, used,
// forged, old version), forged bot buttons, and the API stand-ins with the server's shapes and error codes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { verify } from '../shared/qrtoken.js';
import { makeT } from '../shared/i18n.js';
import { miniFor, publicFor } from '../demo/api.js';
import { DEMO_SECRET } from '../demo/backend.js';
import { BotSim } from '../demo/bot.js';
import { makeViews } from '../demo/bot-views.js';
import { CHECKER, createDemo, forge, GUEST, HOST, HOST_KELIN, STORY_DECLINE, STORY_FAMILY } from '../demo/seed.js';
import { runStep, STEPS } from '../demo/story.js';

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const names = read('../shared/data/names.json');
const t = makeT({ uz: read('../shared/locales/uz.json'), ru: read('../shared/locales/ru.json') });
const HOUR = 3_600_000;
const at = (iso, hh, mm = 0) => Date.parse(`${iso}T00:00:00Z`) + (hh - 5) * HOUR + mm * 60_000; // Tashkent time

function world(startMs, lang = 'uz') {
  let now = startMs;
  const backend = createDemo({ names, now: () => now, lang });
  const views = makeViews(t);
  const alerts = [];
  const bots = {};
  for (const uid of [GUEST, HOST, CHECKER, HOST_KELIN]) bots[uid] = new BotSim(backend, uid, t, views, { onAlert: (x) => alerts.push(x) });
  backend.on((ev) => { for (const b of Object.values(bots)) b.deliver(ev); });
  bots[GUEST].start(backend.invite(STORY_FAMILY).token);
  for (const uid of [HOST, CHECKER, HOST_KELIN]) bots[uid].start();
  return { backend, bots, alerts, advance: (ms) => { now += ms; } };
}
const all = (bot) => bot.messages.map((m) => m.html).join('\n');
const tap = (bot, re) => {
  for (let i = bot.messages.length - 1; i >= 0; i--) {
    for (const row of bot.messages[i].kb) for (const b of row) if (b.data && re.test(b.data)) return bot.press(bot.messages[i].id, b.data);
  }
  throw new Error(`no button ${re}`);
};

test('the whole story works on 30 consecutive days, across New Year, morning and night', async () => {
  for (let d = 0; d < 30; d++) {
    const day = new Date(Date.parse('2026-12-10T00:00:00Z') + d * 86_400_000).toISOString().slice(0, 10);
    for (const hour of [0, 9, 23]) {
      const w = world(at(day, hour, 30));
      const { backend, bots } = w;
      const before = backend.dashboard(HOST, 1).summary;
      for (let n = 1; n <= STEPS.length; n++) await runStep(n, w);
      const s = backend.dashboard(HOST, 1).summary;
      assert.equal(s.people, before.people + 3, `${day} ${hour}`);
      assert.equal(s.no, before.no + 1);
      assert.equal(backend.invite(STORY_FAMILY).checked_in, 3);
      assert.match(all(bots[HOST]), /Karimovlar oilasi<\/b>: ✅ Kelaman — 3 kishi/);
      assert.match(all(bots[HOST]), /Rustam Nazarov<\/b>: ❌ Kelolmayman/);
      assert.ok(bots[GUEST].messages.some((m) => m.qr), 'the guest got the QR in the bot');
      assert.ok(backend.invitation(backend.invite(STORY_FAMILY).token).wishes.some((k) => k.name === 'Karimovlar oilasi'));
    }
  }
});

test('story steps clicked out of order still work, and running a step twice changes nothing', async () => {
  const w = world(at('2026-11-20', 14));
  await runStep(10, w); // needs the answer, the wedding day, the pass and the first scan: all happen quietly first
  assert.equal(w.backend.invite(STORY_FAMILY).checked_in, 3);
  await runStep(5, w);
  assert.equal(w.backend.wishes.find((k) => k.invite_id === STORY_FAMILY).status, 'approved');
  const snap = () => JSON.stringify([w.backend.invites, w.backend.wishes, w.backend.checkins.length]);
  const before = snap();
  for (const n of [2, 5, 7, 9]) await runStep(n, w);
  assert.equal(snap(), before);
  await runStep(11, w);
  assert.equal(snap(), before, 'a forged pass changes nothing');
});

test('the door: genuine, partial, used, forged, old version, short code, not on other days', () => {
  const { backend, advance } = world(at('2026-11-20', 11));
  const token = backend.invite(STORY_FAMILY).token;
  const first = backend.answer(token, { status: 'yes', people: 3 }).pass;
  assert.ok(verify(DEMO_SECRET, first.token));
  assert.equal(backend.checkin(CHECKER, 1, first.token).result, 'not_today');
  const second = backend.answer(token, { status: 'yes', people: 2 }).pass;
  advance(backend.wedding.starts_at - backend.nowMs() - 30 * 60_000);
  assert.equal(backend.checkin(CHECKER, 1, first.token).result, 'bad', 'the old pass died with the changed answer');
  assert.equal(backend.checkin(CHECKER, 1, forge(second.token)).result, 'bad');
  const part = backend.checkin(CHECKER, 1, second.token, 1);
  assert.deepEqual([part.result, part.people, part.left], ['ok', 1, 1]);
  const rest = backend.checkin(CHECKER, 1, second.code.toLowerCase().replace('-', ' '));
  assert.deepEqual([rest.result, rest.people, rest.arrived], ['ok', 1, 2]);
  const used = backend.checkin(CHECKER, 1, second.token);
  assert.equal(used.result, 'used');
  assert.equal(used.at, rest.at);
  assert.throws(() => backend.answer(token, { status: 'no' }), { code: 'deadline' });
  assert.throws(() => backend.checkin(GUEST, 1, second.token), { code: 'not_found' });
});

test('reminders: each guest at most once in 24 hours; hosts only', () => {
  const { backend, bots, advance } = world(at('2026-11-20', 11));
  const first = backend.remind(HOST, 1);
  assert.ok(first.length > 10 && first.every((x) => ['none', 'maybe'].includes(x.status) && x.tg));
  assert.ok(bots[GUEST].messages.some((m) => /javob kutmoqda/.test(m.html)));
  assert.equal(backend.remind(HOST_KELIN, 1).length, 0);
  advance(23 * HOUR);
  assert.equal(backend.remind(HOST, 1).length, 0);
  advance(HOUR);
  assert.equal(backend.remind(HOST, 1).length, first.length);
  assert.throws(() => backend.remind(GUEST, 1), { code: 'not_found' });
  assert.throws(() => backend.dashboard(CHECKER, 1), { code: 'not_found' });
});

test('bot: deep link, answer with people, wish, QR photo; host summary and wish approval; forged buttons refused', () => {
  const { backend, bots, alerts } = world(at('2026-11-20', 11));
  const g = bots[GUEST];
  assert.match(g.messages.at(-1).html, /Hurmatli Karimovlar oilasi!/);
  tap(g, /^r:1:yes$/);
  tap(g, /^p:1:3$/);
  assert.match(all(g), /Javobingiz: <b>✅ Kelaman — 3 kishi<\/b>/);
  assert.ok(g.messages.some((m) => m.qr && verify(DEMO_SECRET, m.qr)));
  tap(g, /^w:1$/);
  g.type('Tabriklaymiz! <script>alert(1)</script>');
  const h = bots[HOST];
  tap(h, /^h:1$/);
  assert.match(all(h), /Zal: <b>76 \/ 200<\/b>/);
  tap(h, /^hw:1$/);
  const wish = backend.wishes.find((k) => k.invite_id === STORY_FAMILY);
  assert.equal(wish.text, 'Tabriklaymiz! <script>alert(1)</script>');
  assert.ok(all(h).includes('&lt;script&gt;') || !all(h).includes('<script>'), 'never raw HTML from a guest');
  for (const data of ['g:2', 'r:2:yes', 'q:2', 'h:2', 'hwd:1:999:a', 'zz:1', 'r:1:sure']) g.press(g.messages.at(-1).id, data);
  assert.equal(alerts.length >= 7, true);
  assert.equal(backend.invite(STORY_DECLINE).status, 'none');
  for (const data of ['h:1', 'hrg:1', 'hw:1']) bots[CHECKER].press(1, data);
  assert.ok(alerts.slice(-3).every((a) => /Topilmadi/.test(a)));
});

test('the API stand-ins: same shapes, errors carry codes, Russian works', async () => {
  const { backend } = world(at('2026-12-31', 22), 'ru');
  const link = backend.invite(STORY_FAMILY).token;
  const page = await publicFor(backend, link).invitation();
  assert.equal(page.invite.name, 'Karimovlar oilasi');
  assert.equal(JSON.stringify(page).includes(link), false, 'the page never echoes links');
  await assert.rejects(publicFor(backend, 'x'.repeat(22)).invitation(), { code: 'not_found' });
  await assert.rejects(publicFor(backend, link).answer({ status: 'yes', people: 9 }), { code: 'people' });
  const host = miniFor(backend, HOST);
  const d = await host.dashboard(1);
  assert.equal((await host.dashboard(1, d.rev)).same, true);
  const csv = (await host.exportCsv(1)).csv;
  assert.ok(csv.startsWith('﻿Mehmon,') && csv.split('\r\n').length === 82);
  const me = await miniFor(backend, GUEST).me();
  assert.equal(me.lang, 'ru');
  assert.equal(me.guest[0].token, link);
  await assert.rejects(miniFor(backend, GUEST).checkin(1, 'x'), { code: 'not_found' });
  const ru = t('ru', 'host.summary', {});
  assert.match(ru, /Придут/);
});
