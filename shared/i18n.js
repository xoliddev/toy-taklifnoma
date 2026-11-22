// JS port of toytaklif/i18n.py: locale templates with escaped params and the formatters every screen needs.
// Used by the invitation page, the Mini App and the browser demo's bot, so every screen reads the same locale JSON.
import { civil, countdown, DAY_MS, hhmm, HOUR_MS, localDay, localMinute, MIN_MS, weekday } from './clock.js';

export const MARKS = { yes: '✅', no: '❌', maybe: '🤔', none: '✉️' };

export class Raw {
  constructor(html) {
    this.html = String(html);
  }

  toString() {
    return this.html;
  }
}

export const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function render(template, params = {}) {
  return template.replace(/\{(\w+)\}/g, (m, k) => {
    if (!(k in params)) return m;
    const v = params[k];
    return v instanceof Raw ? v.html : escapeHtml(v);
  });
}

export const normLang = (code) => (code && String(code).slice(0, 2).toLowerCase() === 'ru' ? 'ru' : 'uz');

/** t(lang, key, params) over {uz, ru} catalogs, falling back to Uzbek, then to the key. */
export function makeT(catalogs) {
  return (lang, key, params) => {
    const l = normLang(lang);
    const template = catalogs[l]?.[key] || catalogs.uz?.[key] || key;
    return render(template, params);
  };
}

export const couple = (w) => `${w.groom} & ${w.bride}`;

export function dateLong(t, lang, ms) {
  const day = localDay(ms);
  const [, month, d] = civil(day);
  return t(lang, 'fmt.date', { d, month: t(lang, `month.${month}`), wd: t(lang, `wd.${weekday(day)}`) });
}

export function dateShort(ms) {
  const [y, m, d] = civil(localDay(ms));
  return `${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}.${y}`;
}

export const clock = (ms) => hhmm(localMinute(ms));

export function leftText(t, lang, leftMs) {
  if (leftMs <= 0) return t(lang, 'left.started');
  const [days, hours, minutes] = countdown(leftMs);
  if (leftMs >= DAY_MS) return t(lang, 'left.days', { d: days, h: hours });
  if (leftMs >= HOUR_MS) return t(lang, 'left.hours', { h: hours, m: minutes });
  return t(lang, 'left.minutes', { m: Math.ceil(leftMs / MIN_MS) });
}

export const people = (t, lang, n) => t(lang, 'fmt.people', { n });

export function bar(pct, width = 10) {
  const full = Math.min(width, Math.max(0, Math.floor((pct * width + 50) / 100)));
  return '▰'.repeat(full) + '▱'.repeat(width - full);
}

export const programTitle = (t, lang, item) => (item.text ? item.text : t(lang, `prog.${item.key}`));

export function answerLine(t, lang, inv) {
  let line = `${MARKS[inv.status]} ${t(lang, `status.${inv.status}`)}`;
  if (['yes', 'maybe'].includes(inv.status) && inv.people) line += ` — ${people(t, lang, inv.people)}`;
  return line;
}
