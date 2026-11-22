// Demo page: three phones (the guest, the host, the door checker), the guided story (in order, all at once, or out
// of order), the live Tashkent clock and the language switch. Everything runs in this page.
import { clock, makeT } from '../shared/i18n.js';
import { mountDash } from '../webapp/dash-view.js';
import { mountDoor } from '../webapp/door-view.js';
import { mountInvite } from '../webapp/invite-view.js';
import { qrCanvas, readCanvas } from '../webapp/qrview.js';
import { h, loadShared, makeText, store } from '../webapp/util.js';
import { miniFor, publicFor } from './api.js';
import { BotSim } from './bot.js';
import { makeViews } from './bot-views.js';
import { createPhone } from './phone.js';
import { CHECKER, createDemo, GUEST, HOST, STORY_FAMILY } from './seed.js';
import { runStep, STEPS } from './story.js';

const shared = await loadShared(new URL('../shared/', import.meta.url), true);
const t = makeT(shared.catalogs);
const text = makeText(shared.catalogs);
let lang = store.get('toytaklif.lang') === 'ru' ? 'ru' : 'uz';
const P = (key, params) => text(lang, key, params);
const backend = createDemo({ names: shared.names, lang });
const views = makeViews(t);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const UIDS = [GUEST, HOST, CHECKER];
const people = { [GUEST]: { who: 'guest', label: 'demo.guest', role: 'demo.role_guest' },
  [HOST]: { who: 'host', label: 'demo.host', role: 'demo.role_host' }, [CHECKER]: { who: 'door', label: 'demo.door', role: 'demo.role_door' } };
const familyLink = backend.invite(STORY_FAMILY).token;
const phones = {};
const bots = {};
const apps = {};
const camera = { source: null, caption: '' };
let shown = GUEST;

function focus(uid, pane) {
  phones[uid].show(pane);
  if (window.matchMedia('(max-width: 760px)').matches) pick(uid);
}
const pane = (uid) => phones[uid].appRoot;
const $ = (uid, sel) => pane(uid).querySelector(sel);
async function until(uid, sel, ms = 5000) {
  for (let i = 0; i < ms / 50; i++) {
    const el = $(uid, sel);
    if (el) return el;
    await wait(50);
  }
  throw new Error(`demo: ${sel} did not appear`);
}
async function scrollTo(uid, sel, gap = 70) {
  const el = await until(uid, sel);
  const root = pane(uid);
  root.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop - gap), behavior: 'smooth' });
  await wait(700);
}

// The demo's "camera": the picture in the viewfinder is a copy of the guest's on-screen pass, read module by module.
async function demoCamera(check, finder) {
  const src = camera.source;
  if (!src) return null;
  const copy = document.createElement('canvas');
  copy.width = copy.height = 330;
  copy.getContext('2d').drawImage(src, 0, 0, 330, 330);
  finder.querySelector('canvas')?.remove();
  finder.prepend(copy);
  finder.querySelector('.cam-hint').textContent = camera.caption;
  finder.classList.add('live');
  await wait(1000);
  const read = readCanvas(copy);
  finder.classList.remove('live');
  return check(read ?? 'unreadable');
}

const ui = {
  async openInvitation() {
    await until(GUEST, '[data-testid=envelope-open]', 6000).then((b) => b.click()).catch(() => {});
    await wait(2100);
    await scrollTo(GUEST, '[data-testid=countdown]');
    await wait(500);
    await scrollTo(GUEST, '[data-testid=venue-map]', 140);
    $(GUEST, '[data-testid=inv-music]')?.classList.add('hint');
  },
  async answerYes(n, wish) {
    apps[GUEST].open();
    await wait(400);
    await scrollTo(GUEST, '[data-testid=rsvp]', 20);
    (await until(GUEST, '[data-testid=rsvp-yes]')).click();
    for (let i = 0; i < 4 && !$(GUEST, '[data-testid=rsvp-count]').textContent.startsWith(String(n)); i++) {
      $(GUEST, '[data-testid=rsvp-plus]').click();
      await wait(250);
    }
    const box = $(GUEST, '[data-testid=rsvp-wish]');
    for (let i = 8; i <= wish.length; i += 8) {
      box.value = wish.slice(0, i);
      await wait(25);
    }
    box.value = wish;
    $(GUEST, '[data-testid=rsvp-send]').click();
    await until(GUEST, '[data-testid=pass]');
  },
  async replayRing(delta) {
    await scrollTo(HOST, '[data-testid=ring]', 60);
    apps[HOST].replay(delta);
  },
  async approveWish(id) {
    await scrollTo(HOST, '[data-testid=pending]');
    (await until(HOST, `[data-testid=wish-approve-${id}]`)).click();
  },
  async remind() {
    await scrollTo(HOST, '[data-testid=remind]');
    (await until(HOST, '[data-testid=remind-send]')).click();
    await wait(400);
  },
  async scrollGuest(id) {
    apps[GUEST].open();
    await scrollTo(GUEST, `[data-testid=${id}]`, 30);
  },
  async scan(what) {
    camera.source = what === 'pass' ? $(GUEST, '[data-testid=pass-qr] canvas') ?? qrCanvas(backend.passFor(backend.invite(STORY_FAMILY)).token)
      : qrCanvas(what, 220);
    camera.caption = P(what === 'pass' ? 'demo.camera' : 'demo.forged');
    await scrollTo(CHECKER, '[data-testid=door-cam]', 120);
    await apps[CHECKER].startCamera();
    await scrollTo(CHECKER, '[data-testid=door-result]', 200);
  },
};

// ── phones, bots, apps ──
for (const uid of UIDS) {
  bots[uid] = new BotSim(backend, uid, t, views, { onChange: () => phones[uid]?.renderChat(), onAlert: (x) => phones[uid].alert(x) });
  phones[uid] = createPhone({ who: people[uid].who, label: '', role: people[uid].role, bot: bots[uid], texts: { P }, now: () => backend.nowMs(),
    onOpenApp: () => focus(uid, 'app'), onShowApp: () => {} });
}
function mountApps() {
  for (const uid of UIDS) apps[uid]?.destroy?.();
  apps[GUEST] = mountInvite(pane(GUEST), { api: publicFor(backend, familyLink), catalogs: shared.catalogs, lang, scroller: () => pane(GUEST),
    onLang: (l) => setLang(l) });
  apps[GUEST].refresh(true);
  apps[HOST] = mountDash(pane(HOST), { api: miniFor(backend, HOST, { onCsv: download }), catalogs: shared.catalogs, lang, wid: 1, poll: 0 });
  apps[HOST].refresh(true);
  apps[CHECKER] = mountDoor(pane(CHECKER), { api: miniFor(backend, CHECKER), catalogs: shared.catalogs, lang, wid: 1, demoCamera });
}
function download(csv) {
  const a = h('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })), download: 'mehmonlar-demo.csv' });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
backend.on((ev) => {
  for (const uid of UIDS) {
    const msg = ['answered', 'wish', 'qr', 'remind', 'broadcast'].includes(ev.type) ? bots[uid].deliver(ev) : null;
    if (msg) phones[uid].ping(msg.html);
  }
  if (ev.type === 'changed' || ev.type === 'clock') {
    apps[GUEST]?.refresh();
    apps[HOST]?.refresh();
    apps[CHECKER]?.status();
    paintClock();
  }
});

// ── page ──
const timeEl = h('span', { class: 'demo-date', 'data-testid': 'demo-time' });
const badgeText = h('span');
const langBtn = h('button', { class: 'demo-btn', type: 'button', 'data-testid': 'demo-lang', onclick: () => setLang(lang === 'uz' ? 'ru' : 'uz') });
const resetBtn = h('button', { class: 'demo-btn', type: 'button', onclick: () => window.location.reload() });
const playBtn = h('button', { class: 'demo-btn solid', type: 'button', 'data-testid': 'play', onclick: () => play() });
const fullLink = h('a', { class: 'demo-full', href: `demo/invite.html#t=${familyLink}`, target: '_blank', rel: 'noopener', 'data-testid': 'full-invite' });
const bar = h('header', { class: 'demo-bar' },
  h('a', { class: 'demo-logo', href: './' }, h('span', { class: 'demo-mark', html: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="14" r="5.2" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="15" cy="14" r="5.2" fill="none" stroke="currentColor" stroke-width="2"/></svg>' }),
    "To'y Taklifnoma"),
  h('span', { class: 'demo-badge', 'data-testid': 'demo-badge' }, h('span', { class: 'dot' }), badgeText),
  h('span', { class: 'demo-time' }, timeEl),
  h('div', { class: 'demo-tools' }, playBtn, langBtn, resetBtn,
    h('a', { class: 'demo-btn gh', href: 'https://github.com/xoliddev/toy-taklifnoma', target: '_blank', rel: 'noopener' }, 'GitHub')));
const title = h('h1');
const lead = h('p');
const foot = h('p', { class: 'demo-foot' });
const env = { backend, bots, wait, focus, ui, done: new Set() };
let running = false;
async function step(i) {
  if (running) return;
  running = true;
  paintStory();
  try {
    await runStep(i + 1, env);
  } catch (err) {
    console.error(err); // eslint-disable-line no-console
    phones[shown].alert(P('err.generic'));
  }
  running = false;
  paintStory();
}
async function play() {
  for (let i = 0; i < STEPS.length; i++) if (!env.done.has(i + 1)) await step(i);
}
const storyBtns = STEPS.map((key, i) => h('button', { class: 'story-btn', type: 'button', 'data-testid': `story-${i + 1}`, onclick: () => step(i) },
  h('b', {}, String(i + 1)), h('span')));
function paintStory() {
  const next = STEPS.findIndex((_, i) => !env.done.has(i + 1));
  storyBtns.forEach((b, i) => {
    b.lastChild.textContent = P(`demo.${STEPS[i]}`);
    b.classList.toggle('done', env.done.has(i + 1));
    b.classList.toggle('next', i === next && !running);
    b.disabled = running;
  });
  playBtn.disabled = running || next < 0;
}
const whoBtns = UIDS.map((uid) => h('button', { type: 'button', 'data-testid': `switch-${people[uid].who}`, onclick: () => pick(uid) }));
function pick(uid) {
  shown = uid;
  whoBtns.forEach((b, i) => b.classList.toggle('on', UIDS[i] === uid));
  for (const id of UIDS) phones[id].side.classList.toggle('show', id === uid);
}
const paintClock = () => { timeEl.textContent = P('demo.time', { time: `${new Date(backend.nowMs() + 5 * 3_600_000).toISOString().slice(0, 10).split('-').reverse().join('.')} ${clock(backend.nowMs())}` }); };
function paintTexts() {
  document.documentElement.lang = lang;
  badgeText.textContent = P('demo.badge');
  langBtn.textContent = lang === 'uz' ? 'RU' : 'UZ';
  resetBtn.textContent = P('demo.reset');
  playBtn.textContent = P('demo.play');
  fullLink.textContent = `↗ ${P('demo.full')}`;
  title.textContent = P('demo.title');
  lead.textContent = P('demo.lead');
  foot.textContent = P('demo.no_bot');
  whoBtns.forEach((b, i) => { b.textContent = P(people[UIDS[i]].label); });
  paintStory();
  paintClock();
  for (const uid of UIDS) {
    phones[uid].renderLabels();
    phones[uid].side.querySelector('.side-label b').textContent = P(people[uid].label);
  }
}
function setLang(next) {
  if (next === lang) return;
  lang = next;
  store.set('toytaklif.lang', lang);
  for (const uid of UIDS) backend.setLang(uid, lang);
  apps[GUEST].setLang(lang);
  apps[HOST].setLang(lang);
  apps[CHECKER] = mountDoor(pane(CHECKER), { api: miniFor(backend, CHECKER), catalogs: shared.catalogs, lang, wid: 1, demoCamera });
  paintTexts();
}
setInterval(() => { paintClock(); for (const uid of UIDS) phones[uid].tick(); }, 15_000);

document.body.append(bar, h('section', { class: 'demo-intro' }, title, lead, fullLink), h('nav', { class: 'story', 'aria-label': 'story' }, storyBtns),
  h('div', { class: 'who-switch', role: 'tablist' }, whoBtns),
  h('main', { class: 'demo-stage' }, UIDS.map((uid) => phones[uid].side)), foot);
mountApps();
bots[GUEST].start(familyLink);
bots[HOST].start();
bots[CHECKER].start();
phones[GUEST].show('app');
phones[HOST].show('app');
pick(GUEST);
paintTexts();
document.body.dataset.ready = '1';
