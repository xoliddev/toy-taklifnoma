// The invitation itself, the same code on the website (/i/<link>), in the Telegram Mini App and in the demo phone.
// mountInvite(root, {api, catalogs, lang}) -> {refresh(), open(), setLang()}. `api` answers invitation() and
// answer(payload): over HTTP on the website, inside the page in the demo.
import { countdown } from '../shared/clock.js';
import { clock, dateLong, makeT, programTitle } from '../shared/i18n.js';
import { backdrop, corner, divider } from './art.js';
import { mountEnvelope } from './envelope.js';
import { routeUrl, venueMap } from './invite-map.js';
import { passSection, rsvpSection, wishesSection } from './invite-rsvp.js';
import { createMusic } from './music.js';
import { errText, h, makeText, store } from './util.js';

export function mountInvite(root, { api, catalogs, lang: start = 'uz', tg = null, envelope = true, onLang = null, openLink = null,
  scroller = () => document.scrollingElement }) {
  const t = makeT(catalogs);
  const text = makeText(catalogs);
  const music = createMusic();
  let lang = store.get('toytaklif.lang') === 'ru' ? 'ru' : start;
  let view = null;
  let offset = 0;
  let ticker = null;
  let map = null;
  let env = null;
  const T = (key, params) => text(lang, key, params);
  const tx = (l, key, params) => text(l, key, params);
  const now = () => Date.now() + offset;

  function countdownBox(startsAt) {
    const cells = ['cd_days', 'cd_hours', 'cd_min', 'cd_sec'].map((k) => {
      const num = h('b', {}, '0');
      return [num, h('div', { class: 'cd-cell' }, num, h('small', {}, T(`inv.${k}`)))];
    });
    const note = h('p', { class: 'cd-note' });
    const box = h('section', { class: 'inv-sec cd', 'data-testid': 'countdown', 'aria-live': 'off' }, h('h3', {}, T('inv.countdown')),
      h('div', { class: 'cd-row' }, cells.map((c) => c[1])), note);
    const paint = () => {
      const left = startsAt - now();
      const parts = countdown(left);
      cells.forEach(([num], k) => { num.textContent = String(parts[k]).padStart(k ? 2 : 1, '0'); });
      note.textContent = left > 0 ? '' : T(left > -18 * 3_600_000 ? 'inv.started' : 'inv.passed');
      box.classList.toggle('done', left <= 0);
    };
    paint();
    clearInterval(ticker);
    ticker = setInterval(paint, 1000);
    return box;
  }

  function tools(w) {
    const langBtn = h('button', { type: 'button', class: 'inv-tool', 'data-testid': 'inv-lang', onclick: () => setLang(lang === 'uz' ? 'ru' : 'uz') },
      T('inv.lang'));
    if (w.music === 'none') return h('div', { class: 'inv-tools' }, langBtn);
    const label = () => T(music.playing ? 'inv.music_on' : 'inv.music_off');
    const btn = h('button', { type: 'button', class: 'inv-tool music', 'data-testid': 'inv-music', 'aria-pressed': 'false' },
      h('span', { class: 'eq', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')), h('span', { class: 'lbl' }, label()));
    btn.addEventListener('click', async () => {
      await music.toggle();
      btn.classList.toggle('on', music.playing);
      btn.setAttribute('aria-pressed', String(music.playing));
      btn.querySelector('.lbl').textContent = label();
    });
    return h('div', { class: 'inv-tools' }, btn, langBtn);
  }

  function details(w) {
    const mapEl = h('div', { class: 'inv-map', 'data-testid': 'venue-map', role: 'img', 'aria-label': T('inv.map') });
    const route = h('a', { class: 'inv-btn ghost', href: routeUrl(w.lat ?? 41.3111, w.lon ?? 69.2797), target: '_blank', rel: 'noopener',
      'data-testid': 'route' }, T('inv.route'));
    if (openLink) route.addEventListener('click', (e) => { e.preventDefault(); openLink(route.href); });
    const program = h('ol', { class: 'prog' }, w.program.map((p) => h('li', {}, h('time', {}, clock(p.at * 60_000 - 5 * 3_600_000)),
      h('span', {}, programTitle(tx, lang, p)))));
    setTimeout(() => {
      map?.destroy();
      map = w.lat !== null ? venueMap(mapEl, w.lat, w.lon, w.venue) : null;
    }, 0);
    return [
      h('section', { class: 'inv-sec where' }, h('div', { class: 'ww' },
        h('div', {}, h('h4', {}, T('inv.when')), h('p', { class: 'big' }, dateLong(tx, lang, w.starts_at)),
          h('p', {}, T('inv.at', { time: clock(w.starts_at) }))),
        h('div', {}, h('h4', {}, T('inv.where')), h('p', { class: 'big' }, w.venue), h('p', {}, w.address))),
      w.lat !== null ? mapEl : null, route),
      h('section', { class: 'inv-sec' }, h('h3', {}, T('inv.program')), program),
      h('section', { class: 'inv-sec dress' }, h('h3', {}, T('inv.dress')), h('p', { class: 'big' }, T(`dress.${w.dress}`)),
        h('p', { class: 'inv-muted' }, T(`dress.${w.dress}_hint`))),
    ];
  }

  function render(keepScroll = false) {
    const sc = scroller();
    const y = keepScroll && sc ? sc.scrollTop : 0;
    const w = view.wedding;
    const inv = view.invite;
    const ctx = { T, t, lang, view, api, tg, root, onView: (v, scrollToPass) => { setView(v); render(true); if (scrollToPass) focusPass(); } };
    document.documentElement.lang = lang;
    const card = h('article', { class: 'inv-card' },
      ['tl', 'tr', 'bl', 'br'].map((p) => corner(w.theme, p)),
      h('header', { class: 'inv-hero' }, h('p', { class: 'kicker' }, T('inv.kicker')),
        h('h1', { class: 'names', 'data-testid': 'names' }, h('span', {}, w.groom), h('span', { class: 'amp', 'aria-hidden': 'true' }, '&'),
          h('span', {}, w.bride)),
        h('p', { class: 'when' }, `${dateLong(tx, lang, w.starts_at)} · ${clock(w.starts_at)}`)),
      divider(w.theme),
      h('section', { class: 'inv-sec greet' }, h('h2', { 'data-testid': 'greeting' }, T('inv.dear', { name: inv.name })), h('p', {}, T('inv.lead'))),
      countdownBox(w.starts_at),
      view.news ? h('section', { class: 'inv-sec news', 'data-testid': 'news' }, h('h3', {}, T('inv.news')), h('p', {}, view.news.text)) : null,
      divider(w.theme), ...details(w), divider(w.theme),
      rsvpSection(ctx), passSection(ctx), wishesSection(ctx),
      h('footer', { class: 'inv-foot' }, h('p', { class: 'sig' }, T('inv.signature')), h('small', {}, T('inv.made'))));
    const page = h('div', { class: `inv theme-${w.theme}`, 'data-theme': w.theme, 'data-testid': 'invitation' }, backdrop(w.theme), tools(w), card);
    root.replaceChildren(page);
    if (envelope && !env?.opened) env = mountEnvelope(root, { T, name: inv.name, groom: w.groom, bride: w.bride, onOpen: () => root.classList.add('opened') });
    if (keepScroll && sc) sc.scrollTop = y;
  }

  function focusPass() {
    const el = root.querySelector('[data-testid=pass]') ?? root.querySelector('[data-testid=rsvp]');
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  function setView(v) {
    view = v;
    offset = v.now - Date.now();
  }

  async function refresh(force = false) {
    if (!force && root.contains(document.activeElement) && document.activeElement.matches('input, textarea')) return;
    try {
      setView(await api.invitation());
      render(true);
    } catch (err) {
      root.replaceChildren(h('div', { class: 'inv inv-missing' }, h('p', {}, err?.code === 'not_found' ? T('inv.not_found') : errText(t, lang, err))));
    }
  }

  function setLang(next) {
    lang = next === 'ru' ? 'ru' : 'uz';
    store.set('toytaklif.lang', lang);
    onLang?.(lang);
    if (view) render(true);
  }

  return {
    refresh, setLang, focusPass,
    open: () => env?.open(),
    get view() { return view; },
    get music() { return music; },
    countdown: () => (view ? countdown(view.wedding.starts_at - now()) : null),
    destroy: () => { clearInterval(ticker); music.stop(); map?.destroy(); },
  };
}
