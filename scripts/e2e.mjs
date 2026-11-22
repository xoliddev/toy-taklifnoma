// Browser test of the demo at 1440 px and 375 px. Fails on any console error, page error or failed request.
//   PW_CHANNEL=chrome node scripts/e2e.mjs        (needs `playwright`: npm i --no-save playwright)
// Map tiles are answered locally with a blank image, so the test never depends on (or loads) openstreetmap.org.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startServer } from './serve.mjs';

const PORT = Number(process.env.E2E_PORT ?? 4318);
const BASE = process.env.E2E_URL ?? `http://127.0.0.1:${PORT}/`;
const server = process.env.E2E_URL ? null : await startServer(PORT);
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined });
const TILE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');
const errors = [];
let checks = 0;
const ok = (cond, msg) => {
  assert.ok(cond, msg);
  checks += 1;
};

async function open(width, height, { lang = 'uz', path = '' } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, locale: 'uz-UZ', timezoneId: 'Asia/Tashkent' });
  await ctx.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: TILE,
    headers: { 'Access-Control-Allow-Origin': '*' } }));
  await ctx.addInitScript((l) => { try { localStorage.setItem('toytaklif.lang', l); } catch { /* */ } }, lang);
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(`[${width}] ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`[${width}] ${e.message}`));
  page.on('requestfailed', (r) => {
    if (r.url().startsWith('https://tile.openstreetmap.org/') && r.failure()?.errorText === 'net::ERR_ABORTED') return;
    errors.push(`[${width}] request failed ${r.url()} ${r.failure()?.errorText}`);
  });
  await page.goto(BASE + path);
  await page.waitForSelector('body[data-ready="1"]', { timeout: 20_000 });
  return page;
}

const text = (page, sel) => page.locator(sel).first().innerText();
const has = (page, sel, s) => page.waitForFunction(([q, v]) => document.querySelector(q)?.innerText.includes(v), [sel, s], { timeout: 15_000 });
const noScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
async function step(page, n) {
  await page.getByTestId(`story-${n}`).click();
  await page.waitForFunction((k) => document.querySelector(`[data-testid=story-${k}]`).classList.contains('done'), n, { timeout: 60_000 });
}
const show = async (page, mobile, who, pane) => {
  if (mobile) await page.getByTestId(`switch-${who}`).click();
  await page.getByTestId(`${who}-tab-${pane}`).click();
};

async function story(page, mobile) {
  ok((await text(page, '[data-testid=demo-badge]')).includes('brauzeringizda'), 'demo badge');
  if (mobile) {
    ok(await page.getByTestId('guest-phone').isVisible(), 'guest phone visible on a phone');
    ok(!(await page.getByTestId('host-phone').isVisible()), 'one phone at a time');
  } else {
    ok(await page.getByTestId('host-phone').isVisible() && await page.getByTestId('door-phone').isVisible(), 'three phones at 1440 px');
  }
  ok(await noScroll(page), 'no horizontal scroll');
  const guest = page.getByTestId('guest-app');
  ok(await guest.getByTestId('envelope').isVisible(), 'the invitation starts as a sealed envelope');
  await step(page, 1);
  ok(await guest.getByTestId('envelope').count() === 0, 'the envelope opened');
  ok((await text(page, '[data-testid=guest-app] [data-testid=greeting]')) === 'Hurmatli Karimovlar oilasi!', 'personal greeting');
  ok(await guest.locator('.leaflet-container').count() === 1, 'venue map');
  ok(await guest.getByTestId('inv-music').getAttribute('aria-pressed') === 'false', 'music is off by default');
  const days = Number(await text(page, '[data-testid=guest-app] .cd-cell b'));
  ok(days >= 24 && days <= 25, 'countdown about 25 days');
  await step(page, 2);
  ok(await guest.getByTestId('pass').count() === 1, 'a pass after Kelaman');
  ok((await text(page, '[data-testid=guest-app] [data-testid=rsvp-current]')).includes('3 kishi'), 'answer shown on the page');
  await step(page, 3);
  await show(page, mobile, 'host', 'app');
  await has(page, '[data-testid=host-app] [data-testid=ring-people]', '76');
  ok(true, 'the host counter jumped to 76');
  await show(page, mobile, 'host', 'chat');
  ok((await text(page, '[data-testid=host-chat]')).includes('Karimovlar oilasi: ✅ Kelaman — 3 kishi'), 'the host bot got the answer');
  await show(page, mobile, 'host', 'app');
  const noBefore = Number(await text(page, '[data-testid=host-app] [data-testid=tile-no] b'));
  await step(page, 4);
  await page.waitForFunction((n) => Number(document.querySelector('[data-testid=host-app] [data-testid=tile-no] b').innerText) === n + 1, noBefore);
  ok(true, 'Kelolmayman counted live');
  await step(page, 5);
  await has(page, '[data-testid=guest-app] [data-testid=wishes]', 'Sardor va Madina, baxtingiz');
  ok(true, 'approved wish appears on the invitation');
  await step(page, 6);
  ok((await text(page, '[data-testid=host-app] [data-testid=remind]')).includes("Hozir eslatma yuboriladigan mehmon yo'q"), 'reminders sent, none due again');
  await step(page, 7);
  ok(Number(await text(page, '[data-testid=guest-app] .cd-cell b')) === 0, 'wedding day: 0 days left');
  await step(page, 8);
  await step(page, 9);
  await show(page, mobile, 'door', 'app');
  ok((await text(page, '[data-testid=door-app] [data-testid=door-head]')) === 'Karimovlar oilasi — 3 kishi', 'checker: ✅ 3 kishi');
  await step(page, 10);
  ok((await text(page, '[data-testid=door-app] [data-testid=door-head]')).includes('allaqachon ishlatilgan'), 'checker: ⚠️ already used');
  await step(page, 11);
  ok((await text(page, '[data-testid=door-app] [data-testid=door-head]')) === 'Soxta yoki bekor qilingan QR', 'checker: ❌ forged');
  ok((await text(page, '[data-testid=door-app] [data-testid=door-count]')).includes('3 /'), 'three inside');
  ok(await noScroll(page), 'still no horizontal scroll');
}

async function outOfOrder(page) {
  await step(page, 10);
  await page.getByTestId('switch-door').click();
  await page.getByTestId('door-tab-app').click();
  ok((await text(page, '[data-testid=door-app] [data-testid=door-head]')).includes('allaqachon'), 'step 10 first still works');
  await step(page, 5);
  ok(await page.locator('[data-testid=story-2].done').count() === 1, 'needed steps marked done');
}

async function hostTools(page) {
  const host = page.getByTestId('host-app');
  await host.getByTestId('theme-bahor').click();
  await page.waitForFunction(() => document.querySelector('[data-testid=guest-app] .inv')?.dataset.theme === 'bahor');
  ok(true, 'the host switches the look; the invitation follows');
  await host.getByTestId('music-none').click();
  await page.waitForFunction(() => !document.querySelector('[data-testid=guest-app] [data-testid=inv-music]'));
  ok(true, 'musiqasiz hides the music button');
  await host.getByTestId('broadcast-text').fill("To'yxonaga kirish Lolazor ko'chasi tomondan");
  await host.getByTestId('broadcast-send').click();
  await has(page, '[data-testid=guest-app] [data-testid=news]', 'Lolazor');
  ok(true, 'broadcast shows on the invitation');
  await page.getByTestId('door-tab-app').click();
  const door = page.getByTestId('door-app');
  await door.getByTestId('door-code').fill('ABCDE-FGHJK');
  await door.getByTestId('door-check').click();
  await has(page, '[data-testid=door-app] [data-testid=door-head]', 'Soxta');
  ok(true, 'a wrong typed code is refused');
  await page.getByTestId('demo-lang').click();
  await has(page, '[data-testid=demo-badge]', 'браузере');
  await has(page, '[data-testid=host-app]', 'Придут');
  ok(true, 'Russian switch');
}

async function standalone(width) {
  const page = await open(width, 900, { path: 'demo/invite.html' });
  await page.getByTestId('envelope-open').click();
  await page.getByTestId('envelope').waitFor({ state: 'detached' });
  await page.getByTestId('rsvp-yes').click();
  await page.getByTestId('rsvp-send').click();
  await page.getByTestId('pass').waitFor();
  ok((await text(page, '[data-testid=rsvp-current]')).includes('2 kishi'), `full-page invitation works at ${width} px`);
  await page.getByTestId('inv-music').click();
  ok(await page.getByTestId('inv-music').getAttribute('aria-pressed') === 'true', 'music toggles on');
  await page.getByTestId('inv-music').click();
  ok(await noScroll(page), 'full page: no horizontal scroll');
  await page.context().close();
}

try {
  for (const [w, h] of [[1440, 900], [375, 812]]) {
    const page = await open(w, h);
    await story(page, w < 760);
    await page.context().close();
  }
  let page = await open(375, 812);
  await outOfOrder(page);
  await page.context().close();
  page = await open(1440, 900);
  await hostTools(page);
  await page.context().close();
  await standalone(1440);
  await standalone(375);
  const ru = await open(375, 812, { lang: 'ru' });
  ok((await text(ru, '[data-testid=demo-badge]')).includes('браузере'), 'opens in Russian on a phone');
  await ru.context().close();
  assert.deepEqual(errors, [], `console errors:\n${errors.join('\n')}`);
  console.log(`e2e: ${checks} checks passed at 1440 px and 375 px, 0 console errors`); // eslint-disable-line no-console
} finally {
  await browser.close();
  server?.close();
}
