// The hosts' live dashboard (Mini App tab): people coming against the hall on a ring, answers, both sides, groups,
// tables, reminders, wishes to approve, a message to everyone coming, the look of the invitation and the CSV.
// It polls with ?rev= (an unchanged dashboard costs one tiny answer); the demo calls refresh() on every event.
import { answerLine, clock, makeT } from '../shared/i18n.js';
import { dashTiles, groupsCard, ringCard, sidesCard, tablesCard } from './dash-parts.js';
import { errText, h, haptic, makeText, toast } from './util.js';

export function mountDash(root, { api, catalogs, lang: start = 'uz', wid, tg = null, poll = 3000, onLang = null }) {
  const t = makeT(catalogs);
  const text = makeText(catalogs);
  let lang = start;
  let data = null;
  let shownPeople = null;
  let timer = null;
  let draft = ''; // the broadcast being typed survives re-renders
  const T = (key, params) => text(lang, key, params);
  const tx = (l, key, params) => text(l, key, params);

  async function act(fn, ok) {
    try {
      const res = await fn();
      haptic(tg, 'success');
      if (ok) toast(root, typeof ok === 'function' ? ok(res) : ok, 'ok');
      await refresh(true);
      return res;
    } catch (err) {
      haptic(tg, 'error');
      toast(root, errText(t, lang, err), 'bad');
      return null;
    }
  }

  function remindCard(s) {
    return h('section', { class: 'dash-card remind', 'data-testid': 'remind' }, h('h3', {}, T('dash.remind')),
      h('p', { class: 'muted' }, s.remind_due ? T('dash.remind_hint', { n: s.remind_due }) : T('dash.remind_none')),
      h('button', { class: 'tt-btn', type: 'button', disabled: !s.remind_due, 'data-testid': 'remind-send',
        onclick: () => act(() => api.remind(wid), (r) => T('dash.reminded', { n: r.sent })) }, `🔔 ${T('dash.remind_btn')}`));
  }

  function wishesCard(pending) {
    const items = pending.map((w) => h('li', { class: 'wish-row', 'data-testid': `wish-${w.id}` }, h('q', {}, w.text), h('b', {}, w.name),
      h('div', { class: 'row-btns' },
        h('button', { class: 'tt-btn small', type: 'button', 'data-testid': `wish-approve-${w.id}`, onclick: () => act(() => api.decideWish(wid, w.id, 'approve')) },
          `✅ ${T('dash.approve')}`),
        h('button', { class: 'tt-btn small ghost', type: 'button', onclick: () => act(() => api.decideWish(wid, w.id, 'hide')) }, T('dash.hide')))));
    return h('section', { class: 'dash-card', 'data-testid': 'pending' }, h('h3', {}, `${T('dash.wishes')} · ${pending.length}`),
      items.length ? h('ul', { class: 'wish-list' }, items) : h('p', { class: 'muted' }, T('dash.no_pending')));
  }

  function latestCard(latest) {
    const items = latest.map((x) => h('li', { class: `is-${x.status}` }, h('span', {}, x.name), h('small', {}, answerLine(tx, lang, x).replace(/^\S+ /, '')),
      h('time', {}, clock(x.answered_at))));
    return h('section', { class: 'dash-card', 'data-testid': 'latest' }, h('h3', {}, T('dash.latest')),
      items.length ? h('ul', { class: 'latest' }, items) : h('p', { class: 'muted' }, T('dash.no_answers')));
  }

  function toolsCard(w) {
    const box = h('textarea', { class: 'tt-input', rows: 2, maxlength: 500, placeholder: T('dash.broadcast_ph'), 'data-testid': 'broadcast-text',
      oninput: () => { draft = box.value; } });
    box.value = draft;
    const themes = ['milliy', 'oltin', 'bahor'].map((k) => h('button', { type: 'button', class: `swatch sw-${k}${w.theme === k ? ' on' : ''}`,
      'aria-pressed': String(w.theme === k), 'data-testid': `theme-${k}`, onclick: () => act(() => api.settings(wid, { theme: k }), T('dash.theme_saved')) },
    h('i'), T(`theme.${k}`)));
    const music = ['soft', 'none'].map((k) => h('button', { type: 'button', class: `chip${w.music === k ? ' on' : ''}`, 'data-testid': `music-${k}`,
      onclick: () => act(() => api.settings(wid, { music: k })) }, T(`music.${k}`)));
    return [
      h('section', { class: 'dash-card' }, h('h3', {}, T('dash.broadcast')), box,
        h('button', { class: 'tt-btn', type: 'button', 'data-testid': 'broadcast-send', onclick: async () => {
          const sent = draft;
          draft = '';
          if (!(await act(() => api.broadcast(wid, sent), (r) => T('dash.broadcast_done', { n: r.sent })))) draft = sent;
        } }, `📣 ${T('dash.broadcast_send')}`)),
      h('section', { class: 'dash-card' }, h('h3', {}, T('dash.look')), h('div', { class: 'swatches' }, themes), h('div', { class: 'chips' }, music)),
      h('button', { class: 'tt-btn ghost wide', type: 'button', 'data-testid': 'export', onclick: () => act(() => api.exportCsv(wid),
        (r) => T(r.csv ? 'dash.csv_ready' : 'dash.export_sent')) }, `📤 ${T('dash.export')}`),
    ];
  }

  function render() {
    const { wedding: w, summary: s } = data;
    const from = shownPeople ?? s.people;
    shownPeople = s.people;
    const page = h('div', { class: 'dash', 'data-testid': 'dashboard' },
      h('header', { class: 'dash-head' }, h('div', {}, h('small', {}, T('dash.title')), h('h2', {}, `${w.groom} & ${w.bride}`)),
        h('span', { class: 'live', title: T('dash.updated', { time: clock(data.now) }) }, h('i'), T('dash.live'))),
      ringCard(T, s, from), dashTiles(T, s), tablesCard(T, s), sidesCard(T, s), remindCard(s), wishesCard(data.pending),
      latestCard(data.latest), groupsCard(T, s), ...toolsCard(w));
    const sc = root.closest('.pane') ?? document.scrollingElement;
    const y = sc?.scrollTop ?? 0;
    root.replaceChildren(page);
    if (sc) sc.scrollTop = y;
  }

  async function refresh(force = false) {
    try {
      const next = await api.dashboard(wid, force || !data ? undefined : data.rev);
      if (next.same) return;
      data = next;
      if (!root.contains(document.activeElement) || !document.activeElement.matches('textarea, input')) render();
    } catch (err) {
      root.replaceChildren(h('p', { class: 'tt-empty' }, errText(t, lang, err)));
    }
  }

  if (poll) timer = setInterval(() => { if (!document.hidden) refresh(); }, poll);
  return {
    refresh, get data() { return data; },
    /** Show the ring filling again from `delta` people fewer (the demo's "the counter jumps" step). */
    replay: (delta) => { if (data) { shownPeople = Math.max(0, data.summary.people - delta); render(); } },
    setLang: (l) => { lang = l; onLang?.(l); if (data) render(); },
    destroy: () => clearInterval(timer),
  };
}
