// In-browser stand-in for the server: the same rules as toytaklif/service.py, hosts.py and door.py, on the JS port
// of the core. Nothing leaves the browser. The clock can jump forward (to the wedding day) for the story.
import { DAY_MS } from '../shared/clock.js';
import { entryCode, sign } from '../shared/qrtoken.js';
import * as rsvp from '../shared/rsvp.js';
import { world } from '../shared/seedgen.js';
import { b64url, hmacSha256, sameText } from '../shared/sha256.js';
import { InputError } from '../shared/text.js';
import { installHost } from './backend-host.js';

// Demo only: the real server reads QR_SECRET from its environment and makes random 128-bit links.
export const DEMO_SECRET = 'demo-only-secret-the-real-server-uses-QR_SECRET';
const LINK = /^[A-Za-z0-9_-]{22}$/;
const PUBLIC_WEDDING = ['id', 'groom', 'bride', 'starts_at', 'rsvp_deadline', 'venue', 'address', 'lat', 'lon', 'theme', 'music', 'dress', 'program'];
const PUBLIC_INVITE = ['id', 'name', 'seats', 'side', 'status', 'people', 'note', 'version', 'checked_in', 'lang'];
const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k]]));
const copy = (o) => structuredClone(o);

export class Refused extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export function guard(fn) {
  try {
    return fn();
  } catch (e) {
    if (e instanceof InputError) throw new Refused(e.code);
    throw e;
  }
}

export class DemoBackend {
  constructor({ now = () => Date.now(), names }) {
    Object.assign(this, { realNow: now, offset: 0, secret: DEMO_SECRET, listeners: new Set() });
    const w = world(names, this.nowMs());
    const link = (what) => b64url(hmacSha256(this.secret, `link|${what}`)).slice(0, 22);
    this.wedding = { ...w.wedding, rev: 0, host_token: link('host'), checker_token: link('checker') };
    this.invites = w.invites.map((x) => ({ ...x, token: link(`invite:${x.id}`), entry_code: entryCode(this.secret, x.id, x.version) }));
    this.wishes = w.wishes.map((k) => ({ ...k, wedding_id: 1, decided_at: k.status === 'pending' ? null : k.created_at }));
    this.users = Object.fromEntries(w.users.map((u) => [u.id, { ...u, lang: 'uz' }]));
    this.hosts = w.hosts;
    this.checkers = new Set(w.checkers);
    this.broadcasts = [];
    this.checkins = [];
  }

  // ── clock and events ──
  nowMs() { return this.realNow() + this.offset; }
  jumpTo(ms) {
    this.offset += Math.max(0, ms - this.nowMs());
    this.emit({ type: 'clock', now: this.nowMs() });
  }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(ev) { for (const fn of this.listeners) fn(ev); }
  bump() { this.wedding.rev += 1; }

  user(uid) { return this.users[uid]; }
  setLang(uid, lang) {
    if (!['uz', 'ru'].includes(lang)) throw new Refused('generic');
    this.users[uid].lang = lang;
  }

  // ── guests ──
  invite(iid) {
    const x = this.invites.find((i) => i.id === iid);
    if (!x) throw new Refused('not_found');
    return x;
  }

  byLink(token) {
    if (typeof token !== 'string' || !LINK.test(token)) throw new Refused('not_found');
    const x = this.invites.find((i) => sameText(i.token, token));
    if (!x || this.wedding.status !== 'active') throw new Refused('not_found');
    return x;
  }

  passFor(inv) {
    if (inv.status !== 'yes' || inv.people < 1) return null;
    return { token: sign(this.secret, 1, inv.id, inv.people, inv.version), code: entryCode(this.secret, inv.id, inv.version) };
  }

  view(inv) {
    const now = this.nowMs();
    const own = this.wishes.find((k) => k.invite_id === inv.id);
    const wishes = this.wishes.filter((k) => k.status === 'approved')
      .sort((a, b) => (b.decided_at ?? 0) - (a.decided_at ?? 0) || b.id - a.id).slice(0, 30)
      .map((k) => ({ name: this.invite(k.invite_id).name, text: k.text }));
    const news = this.broadcasts.at(-1);
    return copy({ wedding: pick(this.wedding, PUBLIC_WEDDING), invite: pick(inv, PUBLIC_INVITE),
      wish: own ? { text: own.text, status: own.status } : null, wishes, news: news ? { text: news.text, at: news.created_at } : null,
      pass: this.passFor(inv), open: now <= this.wedding.rsvp_deadline && inv.checked_in === 0, now });
  }

  invitation(token) { return this.view(this.byLink(token)); }

  answer(token, data) { return this.doAnswer(this.byLink(token), data); }

  answerAs(uid, iid, data) {
    const inv = this.invite(iid);
    if (inv.tg !== uid) throw new Refused('not_found');
    return this.doAnswer(inv, data);
  }

  doAnswer(inv, data) {
    const now = this.nowMs();
    const a = guard(() => rsvp.validate(data, inv, this.wedding, now));
    const before = [inv.status, inv.people];
    const next = rsvp.apply(inv, a, now);
    Object.assign(inv, next, { entry_code: entryCode(this.secret, inv.id, next.version) });
    let wishNew = false;
    if (a.wish) {
      const old = this.wishes.find((k) => k.invite_id === inv.id);
      if (!old) {
        this.wishes.push({ id: this.wishes.length + 1, invite_id: inv.id, wedding_id: 1, text: a.wish, status: 'pending', created_at: now, decided_at: null });
        wishNew = true;
      } else if (old.text !== a.wish) {
        Object.assign(old, { text: a.wish, status: 'pending', created_at: now, decided_at: null });
        wishNew = true;
      }
    }
    this.bump();
    const changed = before[0] !== inv.status || before[1] !== inv.people;
    const ev = { wedding_id: 1, invite: copy(inv), before, changed, wish: wishNew };
    if (changed) this.emit({ type: 'answered', ev });
    if (changed && inv.status === 'yes' && inv.tg) this.emit({ type: 'qr', to: inv.tg, inv: copy(inv) });
    if (wishNew) this.emit({ type: 'wish', ev });
    this.emit({ type: 'changed' });
    return this.view(inv);
  }

  guestInvites(uid) { return this.invites.filter((x) => x.tg === uid).map(copy); }

  /** Reminders are due once per 24 h (also used by tests to check the rule). */
  static remindable(inv, now) {
    return ['none', 'maybe'].includes(inv.status) && inv.tg && (inv.reminded_at === null || now - inv.reminded_at >= DAY_MS);
  }
}

installHost(DemoBackend, Refused, guard);
