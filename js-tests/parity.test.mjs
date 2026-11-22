// The JS port of the core must give exactly what the Python core gives (shared/test_vectors.json).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as clock from '../shared/clock.js';
import * as guestlist from '../shared/guestlist.js';
import * as i18n from '../shared/i18n.js';
import * as qr from '../shared/qr.js';
import { readMatrix } from '../shared/qr-read.js';
import * as qrtoken from '../shared/qrtoken.js';
import * as rsvp from '../shared/rsvp.js';
import * as seedgen from '../shared/seedgen.js';
import { hex, hmacSha256, sha256 } from '../shared/sha256.js';
import * as stats from '../shared/stats.js';
import * as text from '../shared/text.js';

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const V = read('../shared/test_vectors.json');
const names = read('../shared/data/names.json');
const t = i18n.makeT({ uz: read('../shared/locales/uz.json'), ru: read('../shared/locales/ru.json') });

function res(fn) {
  try {
    return { ok: fn() };
  } catch (e) {
    if (e instanceof text.InputError) return { error: e.code };
    throw e;
  }
}

test('Tashkent calendar, clock and countdown (also across New Year)', () => {
  for (const v of V.civil) assert.deepEqual(clock.civil(v.day), v.out, String(v.day));
  for (const v of V.local) {
    assert.equal(clock.localDay(v.ms), v.day);
    assert.equal(clock.localMinute(v.ms), v.minute);
    assert.equal(clock.weekday(v.day), v.wd);
  }
  for (const v of V.countdown) assert.deepEqual(clock.countdown(v.in), v.out, String(v.in));
});

test('text cleaning, whole numbers, FNV-1a', () => {
  for (const v of V.clean) assert.equal(text.clean(v.in, v.n), v.out, String(v.in));
  for (const v of V.whole) assert.deepEqual(res(() => text.whole(v.in, 1, 5, 'people')), v.out, JSON.stringify(v.in));
  for (const v of V.h32) assert.equal(text.h32(v.in), v.out, v.in);
});

test('SHA-256 and HMAC in plain JS match Python hashlib/hmac', () => {
  for (const v of V.sha256) assert.equal(hex(sha256(v.in)), v.out, v.in.slice(0, 20));
  for (const v of V.hmac) assert.equal(hex(hmacSha256(v.key, v.msg)), v.out, v.msg);
});

test('signed passes: same signatures, forged or edited ones refused, short codes', () => {
  const s = V.tokens.secret;
  const signed = [[1, 1, 3, 2], [1, 2, 1, 1], [7, 99, 10, 13]].map((a) => qrtoken.sign(s, ...a));
  assert.deepEqual(signed, V.tokens.signed);
  for (const v of V.tokens.verify) assert.deepEqual(qrtoken.verify(s, v.in), v.out, String(v.in));
  for (const v of V.tokens.codes) assert.equal(qrtoken.entryCode(s, v.i, v.v), v.out);
  for (const v of V.tokens.norm) assert.equal(qrtoken.normCode(v.in), v.out, String(v.in));
});

test('QR encoder draws the same matrix as Python, and the reader gets the text back', () => {
  assert.deepEqual(V.qr_parts.format, [0, 1, 2, 3, 4, 5, 6, 7].map(qr.formatBits));
  assert.deepEqual(V.qr_parts.version, [7, 8, 9, 10].map(qr.versionBits));
  assert.deepEqual(qr.rsRemainder([32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17], 10), V.qr_parts.rs);
  for (const v of V.qr) {
    const m = qr.matrix(v.in);
    assert.equal(qr.asText(m), v.out, v.in.slice(0, 20));
    assert.equal(readMatrix(m), v.in);
    const broken = m.map((row) => row.slice());
    broken[m.length - 3][m.length - 4] ^= 1;
    assert.equal(readMatrix(broken), null, 'one wrong module is refused, not guessed');
  }
});

test('RSVP rules, version bump, new invites', () => {
  const w = seedgen.wedding(V.now);
  const inv = seedgen.invite(1, names, V.now);
  for (const v of V.validate) assert.deepEqual(res(() => rsvp.validate(v.in, inv, w, V.now)), v.out, JSON.stringify(v.in));
  assert.deepEqual(res(() => rsvp.validate({ status: 'no' }, inv, w, w.rsvp_deadline + 1)), V.validate_late);
  assert.deepEqual(res(() => rsvp.validate({ status: 'no' }, { ...inv, checked_in: 1 }, w, V.now)), V.validate_in);
  for (const v of V.apply) assert.deepEqual(rsvp.apply(v.inv, v.a, V.now), v.out);
  for (const v of V.check_invite) assert.deepEqual(res(() => rsvp.checkInvite(v.in)), v.out, JSON.stringify(v.in));
});

test('guest list CSV: import with quotes, delimiters and header detection; defused export', () => {
  for (const v of V.csv) assert.deepEqual(res(() => guestlist.parseCsv(v.in, v.side)), v.out, JSON.stringify(v.in).slice(0, 40));
  assert.deepEqual(res(() => guestlist.parseCsv('Ali Vali;1\n'.repeat(501))), V.csv_big);
  for (const v of V.safe_cell) assert.equal(guestlist.safeCell(v.in), v.out);
  assert.equal(guestlist.exportCsv(V.seed.invites), V.export);
});

test('seed wedding and the live numbers are the same as in Python', () => {
  assert.deepEqual(seedgen.world(names, V.now), V.seed);
  const later = seedgen.world(names, V.nye);
  assert.deepEqual(later.wedding, V.seed_nye.wedding);
  assert.deepEqual(later.invites.slice(0, 3), V.seed_nye.first);
  assert.deepEqual(stats.summary(V.seed.wedding, V.seed.invites, V.now), V.summary);
  assert.deepEqual(stats.summary({ ...V.seed.wedding, capacity: 50 }, V.summary2.invites, V.now + 7_200_000), V.summary2.out);
});

test('texts: dates, time left, people, answers, program (uz and ru)', () => {
  const w = V.seed.wedding;
  for (const v of V.texts) {
    assert.deepEqual([V.now, V.nye, V.nye + 7_200_000, w.starts_at].map((ms) => i18n.dateLong(t, v.lang, ms)), v.dates);
    assert.deepEqual([-1, 0, 59_000, 60_000, 61_000, 3_600_000, 5_400_000, 86_400_000, 25 * 86_400_000 + 3_723_000]
      .map((ms) => i18n.leftText(t, v.lang, ms)), v.left);
    assert.deepEqual([0, 1, 3].map((n) => i18n.people(t, v.lang, n)), v.people);
    assert.deepEqual(V.seed.invites.slice(0, 12).map((x) => i18n.answerLine(t, v.lang, x)), v.answers);
    assert.deepEqual([...w.program, { at: 0, text: 'Kelin salom' }].map((p) => i18n.programTitle(t, v.lang, p)), v.program);
  }
  assert.deepEqual([V.now, V.nye, V.nye + 7_200_000].map(i18n.dateShort), V.short);
  assert.deepEqual([V.now, V.nye, V.nye + 7_200_000].map(i18n.clock), V.clock);
  for (const v of V.bar) assert.equal(i18n.bar(v.pct), v.out);
});
