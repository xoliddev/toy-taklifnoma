// Pieces of the hosts' dashboard: the ring that fills as people say "Kelaman", the four answer tiles, tables,
// the two sides and the groups. All drawn with plain DOM and inline SVG; numbers count up when they change.
import { h, reducedMotion, s } from './util.js';

const R = 64;
const CIRC = 2 * Math.PI * R;

function countUp(el, from, to) {
  if (from === to || reducedMotion()) {
    el.textContent = String(to);
    return;
  }
  const t0 = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - t0) / 700);
    el.textContent = String(Math.round(from + (to - from) * (1 - (1 - k) ** 3)));
    if (k < 1) requestAnimationFrame(step);
  };
  el.textContent = String(from);
  requestAnimationFrame(step);
}

export function ringCard(T, sm, from) {
  const pct = Math.min(1, sm.capacity ? sm.people / sm.capacity : 0);
  const prev = Math.min(1, sm.capacity ? from / sm.capacity : 0);
  const arc = s('circle', { cx: 80, cy: 80, r: R, class: `ring-fill${sm.over ? ' over' : ''}`, 'stroke-dasharray': CIRC.toFixed(1),
    'stroke-dashoffset': (CIRC * (1 - prev)).toFixed(1), transform: 'rotate(-90 80 80)' });
  requestAnimationFrame(() => requestAnimationFrame(() => arc.setAttribute('stroke-dashoffset', (CIRC * (1 - pct)).toFixed(1))));
  const num = h('b', { 'data-testid': 'ring-people' }, String(sm.people));
  countUp(num, from, sm.people);
  const delta = sm.people - from;
  return h('section', { class: 'dash-card ring-card', 'data-testid': 'ring' },
    h('div', { class: 'ring' },
      s('svg', { viewBox: '0 0 160 160', 'aria-hidden': 'true' }, s('circle', { cx: 80, cy: 80, r: R, class: 'ring-track' }), arc),
      h('div', { class: 'ring-mid' }, num, h('small', {}, `/ ${sm.capacity}`), h('span', {}, T('dash.hall_label'))),
      delta > 0 ? h('em', { class: 'bump', 'data-testid': 'bump' }, `+${delta}`) : null),
    h('div', { class: 'ring-side' },
      h('p', { class: 'pct' }, `${sm.pct}%`),
      h('p', { class: sm.over ? 'warn' : 'muted' }, sm.over ? T('dash.over', { n: sm.over }) : T('dash.free', { n: sm.free })),
      h('div', { class: 'meter', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': sm.invites, 'aria-valuenow': sm.answered },
        h('i', { style: { width: `${sm.invites ? (sm.answered * 100) / sm.invites : 0}%` } })),
      h('small', { class: 'muted', 'data-testid': 'answered' }, T('dash.answered', { answered: sm.answered, invites: sm.invites })),
      sm.arrived ? h('p', { class: 'arrived', 'data-testid': 'arrived' }, `🚪 ${T('dash.arrived', { n: sm.arrived })}`) : null));
}

export function dashTiles(T, sm) {
  const tiles = [['yes', 'dash.coming', sm.yes, sm.people], ['no', 'dash.not_coming', sm.no, null],
    ['maybe', 'dash.maybe', sm.maybe, sm.maybe_people], ['none', 'dash.unanswered', sm.none, null]];
  return h('section', { class: 'tiles' }, tiles.map(([k, label, n, people]) => h('div', { class: `tile is-${k}`, 'data-testid': `tile-${k}` },
    h('b', {}, String(n)), h('span', {}, T(label)), h('small', {}, people === null ? T('dash.invites') : `${T('dash.invites')} · ${people} ${T('dash.people_short')}`))));
}

export function tablesCard(T, sm) {
  const dots = Array.from({ length: Math.min(sm.tables_max, 60) }, (_, k) => h('i', { class: k < sm.tables ? 'on' : '' }));
  return h('section', { class: 'dash-card tables', 'data-testid': 'tables' }, h('h3', {}, T('dash.tables')),
    h('p', { class: 'big' }, T('dash.tables_text', { tables: sm.tables, per: sm.per_table })),
    h('div', { class: 'table-dots', 'aria-hidden': 'true' }, dots),
    sm.tables_max > sm.tables ? h('small', { class: 'muted' }, T('dash.tables_max', { n: sm.tables_max })) : null);
}

export function sidesCard(T, sm) {
  const k = sm.sides.kuyov;
  const q = sm.sides.kelin;
  const total = Math.max(1, k.people + q.people);
  return h('section', { class: 'dash-card', 'data-testid': 'sides' }, h('h3', {}, T('dash.sides')),
    h('div', { class: 'split' }, h('i', { class: 'k', style: { width: `${(k.people * 100) / total}%` } }), h('i', { class: 'q' })),
    h('div', { class: 'split-legend' },
      h('span', {}, h('b', {}, `🤵 ${k.people}`), ` ${T('dash.side_kuyov')} · ${k.yes}/${k.invites}`),
      h('span', {}, h('b', {}, `👰 ${q.people}`), ` ${T('dash.side_kelin')} · ${q.yes}/${q.invites}`)));
}

export function groupsCard(T, sm) {
  const max = Math.max(1, ...sm.groups.map((g) => g.invites));
  return h('section', { class: 'dash-card', 'data-testid': 'groups' }, h('h3', {}, T('dash.groups')),
    h('ul', { class: 'groups' }, sm.groups.map((g) => h('li', {},
      h('span', {}, g.name || T('dash.group_none')), h('small', {}, `✅ ${g.yes} · ${g.people} ${T('dash.people_short')} · ✉️ ${g.none}`),
      h('div', { class: 'gbar' }, h('i', { class: 'yes', style: { width: `${(g.yes * 100) / max}%` } }),
        h('i', { class: 'rest', style: { width: `${((g.invites - g.yes) * 100) / max}%` } }))))));
}
