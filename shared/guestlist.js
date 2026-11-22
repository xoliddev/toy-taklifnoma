// JS port of toytaklif/core/guestlist.py: CSV import and the defused CSV export.
import { GROUP_MAX, NAME_MAX, SEATS } from './rsvp.js';
import { clean, InputError } from './text.js';

export const MAX_ROWS = 500;
export const SIDE_WORDS = { kuyov: 'kuyov', 'kuyov tomoni': 'kuyov', k: 'kuyov', жених: 'kuyov', groom: 'kuyov',
  kelin: 'kelin', 'kelin tomoni': 'kelin', q: 'kelin', невеста: 'kelin', bride: 'kelin' };
const HEADER_WORDS = new Set(['name', 'ism', 'mehmon', 'имя', 'гость', 'guest', 'familiya']);
export const EXPORT_HEAD = ['Mehmon', 'Joylar', 'Tomon', 'Guruh', 'Javob', 'Kishi', 'Keldi', 'Izoh'];
export const STATUS_WORDS = { yes: 'Kelaman', no: 'Kelolmayman', maybe: 'Hali bilmayman', none: "Javob yo'q" };
const count = (s, d) => s.split(d).length - 1;
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export function splitRows(input) {
  const text = input.startsWith('﻿') ? input.slice(1) : input;
  const first = text.split('\n', 1)[0];
  let delim = ';';
  for (const d of [',', '\t']) {
    const a = [count(first, d), d === ','];
    const b = [count(first, delim), delim === ','];
    if (a[0] > b[0] || (a[0] === b[0] && a[1] && !b[1])) delim = d;
  }
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === delim) {
      row.push(cell);
      cell = '';
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

export function parseCsv(text, defaultSide = 'kuyov') {
  if (typeof text !== 'string' || text.length > 200_000) throw new InputError('csv');
  const rows = splitRows(text);
  const start = rows.length && HEADER_WORDS.has(clean(rows[0][0], 40).toLowerCase()) ? 1 : 0;
  if (rows.length - start > MAX_ROWS) throw new InputError('csv_too_many');
  const out = [];
  const errors = [];
  rows.slice(start).forEach((raw, k) => {
    const n = start + k + 1;
    const cells = [...raw, '', '', ''];
    const name = clean(cells[0], NAME_MAX);
    const seatsRaw = clean(cells[1], 4);
    const sideRaw = clean(cells[2], 20).toLowerCase();
    if (Array.from(name).length < 2) {
      errors.push({ line: n, code: 'name' });
      return;
    }
    if (seatsRaw && !(/^[0-9]+$/.test(seatsRaw) && Number(seatsRaw) >= SEATS[0] && Number(seatsRaw) <= SEATS[1])) {
      errors.push({ line: n, code: 'seats' });
      return;
    }
    if (sideRaw && !Object.hasOwn(SIDE_WORDS, sideRaw)) {
      errors.push({ line: n, code: 'side' });
      return;
    }
    out.push({ name, seats: seatsRaw ? Number(seatsRaw) : 1, side: sideRaw ? SIDE_WORDS[sideRaw] : defaultSide, grp: clean(cells[3], GROUP_MAX) });
  });
  return { rows: out, errors };
}

export function safeCell(value) {
  let s = String(value);
  if (['=', '+', '-', '@', '\t', '\r'].includes(s.slice(0, 1))) s = `'${s}`;
  if (/[,"\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function exportCsv(invites) {
  const lines = [EXPORT_HEAD.join(',')];
  const sorted = [...invites].sort((a, b) => cmp(a.side, b.side) || cmp(a.grp, b.grp) || cmp(a.name, b.name) || a.id - b.id);
  for (const inv of sorted) {
    lines.push([inv.name, inv.seats, inv.side === 'kuyov' ? 'Kuyov tomoni' : 'Kelin tomoni', inv.grp, STATUS_WORDS[inv.status],
      inv.people, inv.checked_in ?? 0, inv.note ?? ''].map(safeCell).join(','));
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}
