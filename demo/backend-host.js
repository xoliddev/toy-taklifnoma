// The hosts' tools and the door for the in-browser backend (ports toytaklif/hosts.py and door.py).
import { HOUR_MS } from '../shared/clock.js';
import { exportCsv } from '../shared/guestlist.js';
import { normCode, verify } from '../shared/qrtoken.js';
import { summary } from '../shared/stats.js';
import { clean } from '../shared/text.js';

const OPEN_BEFORE = 12 * HOUR_MS;
const OPEN_AFTER = 18 * HOUR_MS;
const copy = (o) => structuredClone(o);

export function installHost(Backend, Refused, guard) {
  const P = Backend.prototype;

  P.requireHost = function requireHost(uid, wid = 1) {
    const h = this.hosts.find((x) => x.user_id === uid);
    if (!h || wid !== 1) throw new Refused('not_found');
    return { ...this.wedding, my_side: h.side };
  };

  P.dashboard = function dashboard(uid, wid = 1, rev) {
    const w = this.requireHost(uid, wid);
    if (rev !== undefined && rev === w.rev) return { same: true, rev };
    const now = this.nowMs();
    const latest = this.invites.filter((x) => x.answered_at).sort((a, b) => b.answered_at - a.answered_at || a.id - b.id).slice(0, 8)
      .map((x) => ({ id: x.id, name: x.name, status: x.status, people: x.people, side: x.side, answered_at: x.answered_at }));
    const pending = this.wishes.filter((k) => k.status === 'pending').sort((a, b) => a.created_at - b.created_at || a.id - b.id)
      .map((k) => ({ id: k.id, text: k.text, name: this.invite(k.invite_id).name }));
    const { host_token: _h, checker_token: _c, ...pub } = w;
    return copy({ wedding: pub, summary: summary(w, this.invites, now), pending, rev: w.rev, latest, now });
  };

  P.inviteLinks = function inviteLinks(uid, wid = 1) {
    this.requireHost(uid, wid);
    return this.invites.map((x) => ({ id: x.id, name: x.name, seats: x.seats, side: x.side, grp: x.grp, status: x.status,
      people: x.people, token: x.token, checked_in: x.checked_in }));
  };

  P.decideWish = function decideWish(uid, wid, wishId, action) {
    this.requireHost(uid, wid);
    if (!['approve', 'hide'].includes(action)) throw new Refused('generic');
    const k = this.wishes.find((x) => x.id === wishId);
    if (!k) throw new Refused('not_found');
    Object.assign(k, { status: action === 'approve' ? 'approved' : 'hidden', decided_at: this.nowMs() });
    this.bump();
    this.emit({ type: 'changed' });
    return { id: wishId, status: k.status };
  };

  P.remind = function remind(uid, wid = 1) {
    this.requireHost(uid, wid);
    const now = this.nowMs();
    const rows = this.invites.filter((x) => Backend.remindable(x, now));
    for (const x of rows) x.reminded_at = now;
    this.bump();
    if (rows.length) this.emit({ type: 'remind', rows: rows.map(copy) });
    this.emit({ type: 'changed' });
    return rows.map(copy);
  };

  P.broadcast = function broadcast(uid, wid, text) {
    this.requireHost(uid, wid);
    const body = typeof text === 'string' ? clean(text, 500) : '';
    if (Array.from(body).length < 3) throw new Refused('text');
    const rows = this.invites.filter((x) => x.status === 'yes' && x.tg);
    this.broadcasts.push({ id: this.broadcasts.length + 1, text: body, sent: rows.length, by_user: uid, created_at: this.nowMs() });
    this.bump();
    this.emit({ type: 'broadcast', rows: rows.map(copy), text: body });
    this.emit({ type: 'changed' });
    return { text: body, sent: rows.length };
  };

  P.settings = function settings(uid, wid, changes) {
    this.requireHost(uid, wid);
    const allowed = { theme: ['milliy', 'oltin', 'bahor'], music: ['soft', 'none'], dress: ['milliy', 'bayram', 'oq', 'erkin'] };
    for (const [k, v] of Object.entries(changes ?? {})) if (!allowed[k]?.includes(v)) throw new Refused('generic');
    Object.assign(this.wedding, changes);
    this.bump();
    this.emit({ type: 'changed' });
    const { theme, music, dress, lat, lon } = this.wedding;
    return { theme, music, dress, lat, lon };
  };

  P.exportCsv = function exportCsvFor(uid, wid = 1) {
    this.requireHost(uid, wid);
    return exportCsv(this.invites);
  };

  // ── the door ──
  P.requireChecker = function requireChecker(uid, wid = 1) {
    if (wid !== 1 || !(this.checkers.has(uid) || this.hosts.some((x) => x.user_id === uid))) throw new Refused('not_found');
    return this.wedding;
  };

  P.doorStatus = function doorStatus(uid, wid = 1) {
    const w = this.requireChecker(uid, wid);
    const arrived = this.invites.reduce((s, x) => s + x.checked_in, 0);
    const people = this.invites.reduce((s, x) => s + (x.status === 'yes' ? x.people : 0), 0);
    return { id: 1, groom: w.groom, bride: w.bride, starts_at: w.starts_at, arrived, people, now: this.nowMs() };
  };

  P.checkin = function checkin(uid, wid, scanned, want = null) {
    const w = this.requireChecker(uid, wid);
    if (want !== null && want !== undefined && !(Number.isInteger(want) && want >= 1 && want <= 10)) throw new Refused('people');
    const now = this.nowMs();
    if (now < w.starts_at - OPEN_BEFORE || now > w.starts_at + OPEN_AFTER) return { result: 'not_today', starts_at: w.starts_at };
    const fields = verify(this.secret, scanned);
    const code = fields ? null : normCode(scanned);
    if (!fields && !code) return { result: 'bad' };
    const inv = fields ? this.invites.find((x) => x.id === fields.invite_id) : this.invites.find((x) => x.entry_code === code);
    if (!inv || inv.status !== 'yes' || inv.people < 1
      || (fields && (fields.wedding_id !== 1 || fields.version !== inv.version || fields.people !== inv.people))) return { result: 'bad' };
    const left = inv.people - inv.checked_in;
    const base = { name: inv.name, total: inv.people };
    if (left <= 0) return { result: 'used', at: inv.last_checkin_at, ...base, arrived: inv.checked_in };
    const n = Math.min(want || left, left);
    inv.checked_in += n;
    inv.last_checkin_at = now;
    this.checkins.push({ id: this.checkins.length + 1, invite_id: inv.id, people: n, version: inv.version, at: now, by_user: uid });
    this.bump();
    this.emit({ type: 'changed' });
    return { result: 'ok', ...base, people: n, arrived: inv.checked_in, left: inv.people - inv.checked_in, at: now };
  };

  P.guard = guard;
}
