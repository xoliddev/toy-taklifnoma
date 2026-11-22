// The guest's part of the invitation: the answer (Kelaman / Kelolmayman / Hali bilmayman, how many, a note, a
// wish), the entry pass once the answer is "Kelaman", and the wall of wishes the hosts approved.
import { dateLong, people as peopleText } from '../shared/i18n.js';
import { qrCanvas } from './qrview.js';
import { errText, h, haptic, toast } from './util.js';

const MARK = { yes: '✅', no: '❌', maybe: '🤔' };

export function rsvpSection(ctx) {
  const { T, t, lang, view } = ctx;
  const inv = view.invite;
  const w = view.wedding;
  const state = { status: inv.status === 'none' ? null : inv.status, people: inv.people || Math.min(inv.seats, 2) };
  if (state.people < 1) state.people = 1;
  const choices = ['yes', 'no', 'maybe'].map((st) => h('button', { type: 'button', class: 'rsvp-choice', 'data-v': st,
    'data-testid': `rsvp-${st}`, 'aria-pressed': 'false', onclick: () => pick(st) }, h('span', { class: 'mk' }, MARK[st]), T(`status.${st}`)));
  const count = h('output', { class: 'rsvp-count', 'data-testid': 'rsvp-count' });
  const minus = h('button', { type: 'button', class: 'step', 'aria-label': T('inv.minus'), 'data-testid': 'rsvp-minus', onclick: () => bump(-1) }, '−');
  const plus = h('button', { type: 'button', class: 'step', 'aria-label': T('inv.plus'), 'data-testid': 'rsvp-plus', onclick: () => bump(1) }, '+');
  const peopleRow = h('div', { class: 'rsvp-people' }, h('span', {}, T('inv.people'), h('small', {}, T('inv.people_of', { seats: inv.seats }))),
    h('div', { class: 'stepper' }, minus, count, plus));
  const note = h('input', { class: 'rsvp-input', maxlength: 200, placeholder: T('inv.note_ph'), 'data-testid': 'rsvp-note', value: inv.note ?? '' });
  const wish = h('textarea', { class: 'rsvp-input', rows: 3, maxlength: 300, placeholder: T('inv.wish_ph'), 'data-testid': 'rsvp-wish' });
  const send = h('button', { type: 'submit', class: 'inv-btn', 'data-testid': 'rsvp-send' });
  const own = view.wish ? h('p', { class: 'rsvp-own' }, T('inv.your_wish', { status: T(`inv.wish_${view.wish.status}`) }), h('q', {}, view.wish.text)) : null;

  function paint() {
    choices.forEach((b) => {
      const on = b.dataset.v === state.status;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    peopleRow.hidden = !(state.status === 'yes' || state.status === 'maybe');
    count.textContent = peopleText((l, k, p) => T(k, p), lang, state.people);
    minus.disabled = state.people <= 1;
    plus.disabled = state.people >= inv.seats;
    send.disabled = !state.status;
    send.textContent = T(inv.status === 'none' ? 'inv.send' : 'inv.update');
  }
  function pick(st) {
    state.status = st;
    haptic(ctx.tg);
    paint();
  }
  function bump(d) {
    state.people = Math.max(1, Math.min(inv.seats, state.people + d));
    paint();
  }
  const form = h('form', { class: 'rsvp-form', onsubmit: async (e) => {
    e.preventDefault();
    if (!state.status) return;
    send.disabled = true;
    send.textContent = T('inv.sending');
    try {
      const payload = { status: state.status, people: state.status === 'no' ? 0 : state.people, note: note.value, wish: wish.value };
      const next = await ctx.api.answer(payload);
      haptic(ctx.tg, 'success');
      toast(ctx.root, T('inv.saved'), 'ok');
      ctx.onView(next, true);
    } catch (err) {
      haptic(ctx.tg, 'error');
      toast(ctx.root, errText(t, lang, err), 'bad');
      paint();
    }
  } }, h('div', { class: 'rsvp-choices', role: 'group', 'aria-label': T('inv.choose') }, choices), peopleRow,
  h('label', { class: 'rsvp-label' }, T('inv.note'), note), h('label', { class: 'rsvp-label' }, T('inv.wish'), wish),
  h('small', { class: 'rsvp-hint' }, T('inv.wish_hint')), send);
  paint();

  const lead = view.open ? T('inv.rsvp_lead', { date: plainDate(t, lang, w.rsvp_deadline) }) : T('inv.closed');
  const current = inv.status === 'none' ? null
    : h('p', { class: `rsvp-current is-${inv.status}`, 'data-testid': 'rsvp-current' },
      T('inv.your_answer', { answer: `${MARK[inv.status]} ${T(`status.${inv.status}`)}${inv.people && inv.status !== 'no'
        ? ` — ${peopleText((l, k, p) => T(k, p), lang, inv.people)}` : ''}` }));
  return h('section', { class: 'inv-sec rsvp', id: 'rsvp', 'data-testid': 'rsvp' }, h('h3', {}, T('inv.rsvp')),
    h('p', { class: 'inv-muted' }, lead), current, own, view.open ? form : null,
    view.open && inv.status !== 'none' ? h('small', { class: 'rsvp-hint' }, T('inv.change_until', { date: plainDate(t, lang, w.rsvp_deadline) })) : null);
}

const plainDate = (t, lang, ms) => dateLong(t, lang, ms).replace(/&amp;/g, '&');

export function passSection(ctx) {
  const { T, lang, view } = ctx;
  const p = view.pass;
  if (!p) return null;
  const inv = view.invite;
  const label = `${inv.name} — ${peopleText((l, k, q) => T(k, q), lang, inv.people)}`;
  const arrived = inv.checked_in > 0 ? h('p', { class: 'pass-in' }, T('inv.arrived', { arrived: inv.checked_in, people: inv.people })) : null;
  return h('section', { class: 'inv-sec pass', id: 'pass', 'data-testid': 'pass' }, h('h3', {}, T('inv.pass')),
    h('div', { class: 'ticket' },
      h('div', { class: 'ticket-qr', 'data-testid': 'pass-qr' }, qrCanvas(p.token, 208, label)),
      h('div', { class: 'ticket-side' }, h('b', {}, inv.name), h('span', {}, peopleText((l, k, q) => T(k, q), lang, inv.people)),
        h('small', {}, T('inv.pass_code')), h('code', { 'data-testid': 'pass-code' }, p.code))),
    arrived, h('p', { class: 'inv-muted' }, T('inv.pass_lead')), h('small', { class: 'rsvp-hint' }, T('inv.pass_old')));
}

export function wishesSection(ctx) {
  const { T, view } = ctx;
  const list = view.wishes.length
    ? view.wishes.map((w, k) => h('figure', { class: `wish w${k % 3}` }, h('blockquote', {}, w.text), h('figcaption', {}, w.name)))
    : [h('p', { class: 'inv-muted' }, T('inv.wishes_empty'))];
  return h('section', { class: 'inv-sec wishes', 'data-testid': 'wishes' }, h('h3', {}, T('inv.wishes')), h('div', { class: 'wish-wall' }, list));
}
