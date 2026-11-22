// Mini App entry inside Telegram. The hash picks the screen: #i=<link> (the guest's invitation), #host=<id> (the
// hosts' live dashboard), #door=<id> (the door). Nothing is validated here: the server checks initData and roles.
import { miniApi, publicApi } from './api.js';
import { mountDash } from './dash-view.js';
import { mountDoor } from './door-view.js';
import { mountInvite } from './invite-view.js';
import { h, loadShared, makeText } from './util.js';

const tg = window.Telegram?.WebApp;
const root = document.getElementById('app');
const shared = await loadShared();
const text = makeText(shared.catalogs);
const hash = window.location.hash;
const link = /^#i=([A-Za-z0-9_-]{22})$/.exec(hash);

if (link) {
  tg?.ready();
  tg?.expand();
  const app = mountInvite(root, { api: publicApi(link[1]), catalogs: shared.catalogs, tg, openLink: (url) => tg?.openLink(url) ?? window.open(url) });
  await app.refresh(true);
} else if (!tg?.initData) {
  root.replaceChildren(h('p', { class: 'tt-empty' }, text('uz', 'app.open_in_telegram')), h('p', { class: 'tt-empty' }, text('ru', 'app.open_in_telegram')));
} else {
  tg.ready();
  tg.expand();
  const api = miniApi(tg.initData);
  const me = await api.me().catch(() => null);
  const lang = me?.lang ?? 'uz';
  const host = /^#host=(\d{1,9})$/.exec(hash);
  const door = /^#door=(\d{1,9})$/.exec(hash);
  if (host) mountDash(root, { api, catalogs: shared.catalogs, lang, wid: Number(host[1]), tg }).refresh(true);
  else if (door) mountDoor(root, { api, catalogs: shared.catalogs, lang, wid: Number(door[1]), tg });
  else {
    const T = (k) => text(lang, k);
    const items = [
      ...(me?.guest ?? []).map((x) => h('a', { class: 'tt-btn wide', href: `#i=${x.token}` }, `💌 ${x.name}`)),
      ...(me?.host ?? []).map((w) => h('a', { class: 'tt-btn wide', href: `#host=${w.id}` }, `📊 ${w.groom} & ${w.bride}`)),
      ...(me?.door ?? []).map((w) => h('a', { class: 'tt-btn wide ghost', href: `#door=${w.id}` }, `🚪 ${w.groom} & ${w.bride}`)),
    ];
    root.replaceChildren(h('div', { class: 'dash' }, h('h2', {}, T(items.length ? 'dash.pick' : 'dash.empty')), items));
    window.addEventListener('hashchange', () => window.location.reload());
  }
}
