// The bot, simulated in the page (ports toytaklif/bot/handlers_*.py for the screens the story uses): the same
// callback data, the same texts. Messages are {id, from: 'bot' | 'me', html, kb, at, qr?}; a press edits that message.
import { answerLine, clock, couple, dateLong } from '../shared/i18n.js';
import { Refused } from './backend.js';

const strip = (html) => html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export class BotSim {
  constructor(backend, uid, t, views, { onChange = () => {}, onAlert = () => {} } = {}) {
    Object.assign(this, { b: backend, uid, t, v: views, onChange, onAlert });
    this.messages = [];
    this.ids = 1;
    this.mode = null; // 'wish:<iid>' or 'door'
  }

  get user() { return this.b.user(this.uid); }
  get lang() { return this.user.lang; }

  push(screen, from = 'bot') {
    const msg = { id: this.ids++, from, html: screen.html, kb: screen.kb ?? [], at: this.b.nowMs(), qr: screen.qr ?? null };
    this.messages.push(msg);
    this.onChange();
    return msg;
  }

  show(id, screen) {
    const msg = id && this.messages.find((m) => m.id === id);
    if (!msg || msg.qr) return this.push(screen);
    Object.assign(msg, { html: screen.html, kb: screen.kb ?? [] });
    this.onChange();
    return msg;
  }

  guard(fn, typed = false) {
    try {
      return fn();
    } catch (e) {
      if (!(e instanceof Refused)) throw e;
      const key = this.t(this.lang, `err.${e.code}`) === `err.${e.code}` ? 'err.generic' : `err.${e.code}`;
      if (typed) return this.push({ html: this.t(this.lang, key) });
      this.onAlert(strip(this.t(this.lang, key)));
      return null;
    }
  }

  roles() {
    const w = this.b.wedding;
    return { guest: this.b.guestInvites(this.uid).map((inv) => [inv, w]), host: this.b.hosts.some((x) => x.user_id === this.uid) ? [w] : [],
      door: this.b.checkers.has(this.uid) ? [w] : [] };
  }

  menu(id, hello = false) { return this.show(id, this.v.mainMenu(this.lang, this.user, this.roles(), hello)); }

  /** /start, optionally with a deep link (the guest's invite link). */
  start(arg = '') {
    this.push({ html: esc(arg ? `/start ${arg}` : '/start') }, 'me');
    this.mode = null;
    if (/^[A-Za-z0-9_-]{22}$/.test(arg)) {
      const inv = this.guard(() => this.b.byLink(arg), true);
      if (inv && !inv.tg) inv.tg = this.uid;
      if (inv) return this.card(null, inv.id);
      return null;
    }
    return this.menu(null, true);
  }

  type(text) {
    this.push({ html: esc(text) }, 'me');
    if (this.mode?.startsWith('wish:')) {
      const iid = Number(this.mode.slice(5));
      this.mode = null;
      return this.guard(() => this.wish(iid, text), true);
    }
    if (this.mode === 'door') return this.guard(() => this.doorCode(text), true);
    return this.menu(null);
  }

  mine(iid) {
    const inv = this.b.invite(iid);
    if (inv.tg !== this.uid) throw new Refused('not_found');
    return inv;
  }

  card(id, iid) { return this.show(id, this.v.guestCard(this.lang, this.mine(iid), this.b.wedding, this.b.nowMs())); }

  answer(id, iid, payload) {
    this.mine(iid);
    this.b.answerAs(this.uid, iid, payload);
    this.onAlert(strip(this.t(this.lang, 'guest.saved', { answer: answerLine(this.t, this.lang, this.b.invite(iid)) })));
    return this.card(id, iid);
  }

  wish(iid, text) {
    const inv = this.mine(iid);
    if (text.trim().length < 2) throw new Refused('text');
    const status = inv.status === 'none' ? 'maybe' : inv.status;
    this.push({ html: this.t(this.lang, 'guest.wish_saved') });
    this.b.answerAs(this.uid, iid, { status, people: status === 'no' ? 0 : inv.people || inv.seats, note: inv.note, wish: text });
    return this.card(null, iid);
  }

  sendQr(iid) {
    const inv = this.mine(iid);
    const pass = this.b.passFor(inv);
    if (!pass) throw new Refused('not_found');
    return this.push({ html: this.v.qrCaption(this.lang, inv, this.b.wedding, pass.code), qr: pass.token });
  }

  doorCode(text) {
    const res = this.b.checkin(this.uid, 1, text.slice(0, 80));
    this.push({ html: this.v.doorResult(this.lang, res) });
    return this.push(this.v.doorHome(this.lang, this.b.doorStatus(this.uid, 1)));
  }

  press(id, data) {
    const r = this.guard(() => this.route(id, String(data)));
    if (r === false) this.onAlert(strip(this.t(this.lang, 'err.stale')));
  }

  route(id, data) {
    const lang = this.lang;
    let m;
    if (data === 'n:menu') { this.mode = null; return this.menu(id); }
    if (data === 'n:lang') { this.b.setLang(this.uid, lang === 'uz' ? 'ru' : 'uz'); return this.menu(id); }
    if ((m = /^g:(\d{1,9})$/.exec(data))) return this.card(id, Number(m[1]));
    if ((m = /^r:(\d{1,9}):(yes|no|maybe)$/.exec(data))) {
      const inv = this.mine(Number(m[1]));
      if (m[2] === 'yes' && inv.seats > 1) return this.show(id, this.v.pickPeople(lang, inv));
      return this.answer(id, inv.id, { status: m[2], people: m[2] === 'yes' ? 1 : m[2] === 'maybe' ? inv.seats : 0 });
    }
    if ((m = /^p:(\d{1,9}):(\d{1,2})$/.exec(data))) return this.answer(id, Number(m[1]), { status: 'yes', people: Number(m[2]) });
    if ((m = /^w:(\d{1,9})$/.exec(data))) {
      this.mine(Number(m[1]));
      this.mode = `wish:${m[1]}`;
      return this.push({ html: this.t(lang, 'guest.wish_ask') });
    }
    if ((m = /^q:(\d{1,9})$/.exec(data))) return this.sendQr(Number(m[1]));
    if ((m = /^h:(\d{1,9})$/.exec(data))) return this.show(id, this.v.summary(lang, this.b.dashboard(this.uid, Number(m[1]))));
    if ((m = /^hg:(\d{1,9})$/.exec(data))) return this.show(id, this.v.groups(lang, this.b.dashboard(this.uid, Number(m[1]))));
    if ((m = /^hw:(\d{1,9})$/.exec(data))) return this.show(id, this.v.wish(lang, Number(m[1]), this.b.dashboard(this.uid, Number(m[1])).pending));
    if ((m = /^hwd:(\d{1,9}):(\d{1,9}):([ah])$/.exec(data))) {
      this.b.decideWish(this.uid, Number(m[1]), Number(m[2]), m[3] === 'a' ? 'approve' : 'hide');
      return this.show(id, this.v.wish(lang, Number(m[1]), this.b.dashboard(this.uid, Number(m[1])).pending));
    }
    if ((m = /^hr:(\d{1,9})$/.exec(data))) {
      return this.show(id, this.v.remindAsk(lang, Number(m[1]), this.b.dashboard(this.uid, Number(m[1])).summary.remind_due));
    }
    if ((m = /^hrg:(\d{1,9})$/.exec(data))) {
      const rows = this.b.remind(this.uid, Number(m[1]));
      this.onAlert(strip(this.t(lang, 'host.reminded', { n: rows.length })));
      return this.show(id, this.v.summary(lang, this.b.dashboard(this.uid, Number(m[1]))));
    }
    if ((m = /^d:(\d{1,9})$/.exec(data))) {
      const st = this.b.doorStatus(this.uid, Number(m[1]));
      this.mode = 'door';
      return this.show(id, this.v.doorHome(lang, st));
    }
    return false;
  }

  /** Something the bot sends on its own (a backend event). Returns the new message, or null. */
  deliver(ev) {
    const lang = this.lang;
    const w = this.b.wedding;
    if (ev.type === 'answered' && this.b.hosts.some((x) => x.user_id === this.uid)) {
      const coming = this.b.invites.reduce((s, x) => s + (x.status === 'yes' ? x.people : 0), 0);
      return this.push({ html: this.v.answered(lang, ev.ev.invite, w, coming),
        kb: [[{ text: strip(this.t(lang, 'btn.panel')), app: '#host=1' }], [{ text: strip(this.t(lang, 'btn.refresh')), data: 'h:1' }]] });
    }
    if (ev.type === 'wish' && this.b.hosts.some((x) => x.user_id === this.uid)) {
      return this.push({ html: this.t(lang, 'notify.wish', { name: ev.ev.invite.name }),
        kb: [[{ text: strip(this.t(lang, 'btn.wishes', { n: '…' })), data: 'hw:1' }]] });
    }
    if (ev.type === 'qr' && ev.to === this.uid) {
      const inv = this.b.invite(ev.inv.id);
      const pass = this.b.passFor(inv);
      return pass ? this.push({ html: this.v.qrCaption(lang, inv, w, pass.code), qr: pass.token }) : null;
    }
    if (ev.type === 'remind') {
      const inv = ev.rows.find((x) => x.tg === this.uid);
      if (!inv) return null;
      return this.push({ html: this.t(lang, 'notify.remind', { name: inv.name, couple: couple(w), date: dateLong(this.t, lang, w.starts_at),
        time: clock(w.starts_at), deadline: dateLong(this.t, lang, w.rsvp_deadline) }), kb: [[{ text: strip(this.t(lang, 'btn.yes')), data: `r:${inv.id}:yes` },
        { text: strip(this.t(lang, 'btn.no')), data: `r:${inv.id}:no` }]] });
    }
    if (ev.type === 'broadcast' && ev.rows.some((x) => x.tg === this.uid)) {
      return this.push({ html: this.t(lang, 'notify.broadcast', { couple: couple(w), text: ev.text }) });
    }
    return null;
  }
}
