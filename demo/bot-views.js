// The bot's screens for the demo, ported from toytaklif/bot/views.py and views_host.py (the screens the story uses).
// A screen is {html, kb: [[{text, data} | {text, app}]]}; texts come from the same locale files as the real bot.
import { answerLine, bar, clock, couple, dateLong, leftText, MARKS, people, Raw } from '../shared/i18n.js';

const unescape = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

export function makeViews(t) {
  const b = (lang, key, data, params) => ({ text: unescape(t(lang, key, params)), data });
  const back = (lang, to = 'n:menu') => [b(lang, 'btn.back', to)];
  return {
    mainMenu(lang, user, roles, hello = false) {
      const kb = [
        ...roles.guest.map(([inv, w]) => [b(lang, 'btn.guest', `g:${inv.id}`, { couple: couple(w) })]),
        ...roles.host.map((w) => [b(lang, 'btn.host', `h:${w.id}`, { couple: couple(w) })]),
        ...roles.door.map((w) => [b(lang, 'btn.door', `d:${w.id}`, { couple: couple(w) })]),
        [b(lang, 'btn.new', 'n:new')], [b(lang, 'btn.lang', 'n:lang')]];
      return { html: hello ? t(lang, 'menu.hello', { name: user.name }) : t(lang, 'menu.text'), kb };
    },
    guestCard(lang, inv, w, now) {
      let html = t(lang, 'guest.card', { couple: couple(w), name: inv.name, lead: t(lang, 'inv.lead'), date: dateLong(t, lang, w.starts_at),
        time: clock(w.starts_at), venue: w.venue, address: w.address, left: leftText(t, lang, w.starts_at - now), answer: answerLine(t, lang, inv) });
      const kb = [];
      if (now <= w.rsvp_deadline && inv.checked_in === 0) {
        html += `\n${t(lang, 'guest.deadline', { date: dateLong(t, lang, w.rsvp_deadline) })}`;
        kb.push([b(lang, 'btn.yes', `r:${inv.id}:yes`), b(lang, 'btn.no', `r:${inv.id}:no`)], [b(lang, 'btn.maybe', `r:${inv.id}:maybe`)],
          [b(lang, 'btn.wish', `w:${inv.id}`)]);
      } else html += `\n${t(lang, 'guest.closed')}`;
      if (inv.status === 'yes') kb.push([b(lang, 'btn.qr', `q:${inv.id}`)]);
      kb.push([{ text: unescape(t(lang, 'btn.open_invite')), app: `#i=${inv.token}` }], back(lang));
      return { html, kb };
    },
    pickPeople(lang, inv) {
      const nums = Array.from({ length: inv.seats }, (_, k) => ({ text: String(k + 1), data: `p:${inv.id}:${k + 1}` }));
      return { html: t(lang, 'guest.people', { seats: inv.seats }), kb: [nums, back(lang, `g:${inv.id}`)] };
    },
    qrCaption: (lang, inv, w, code) => t(lang, 'guest.qr', { name: inv.name, people: people(t, lang, inv.people), couple: couple(w),
      date: dateLong(t, lang, w.starts_at), code }),
    summary(lang, d) {
      const { wedding: w, summary: s } = d;
      let html = t(lang, 'host.summary', { couple: couple(w), date: dateLong(t, lang, w.starts_at), time: clock(w.starts_at),
        left: leftText(t, lang, w.starts_at - d.now), yes: s.yes, people: people(t, lang, s.people), no: s.no, maybe: s.maybe,
        maybe_people: people(t, lang, s.maybe_people), none: s.none, count: s.people, capacity: s.capacity, bar: bar(s.pct), pct: s.pct,
        tables: s.tables, per: s.per_table, kuyov: people(t, lang, s.sides.kuyov.people), kelin: people(t, lang, s.sides.kelin.people) });
      if (s.over) html += `\n${t(lang, 'host.over', { n: s.over })}`;
      if (s.arrived) html += `\n${t(lang, 'host.arrived', { n: s.arrived })}`;
      const id = w.id;
      return { html, kb: [[{ text: unescape(t(lang, 'btn.panel')), app: `#host=${id}` }],
        [b(lang, 'btn.refresh', `h:${id}`), b(lang, 'btn.groups', `hg:${id}`)],
        [b(lang, 'btn.wishes', `hw:${id}`, { n: d.pending.length }), b(lang, 'btn.remind', `hr:${id}`, { n: s.remind_due })], back(lang)] };
    },
    groups(lang, d) {
      const lines = d.summary.groups.map((g) => t(lang, 'host.group_line', { name: g.name || t(lang, 'dash.group_none'), invites: g.invites,
        yes: g.yes, people: people(t, lang, g.people), none: g.none }));
      return { html: t(lang, 'host.groups', { lines: new Raw(lines.join('\n')) }), kb: [back(lang, `h:${d.wedding.id}`)] };
    },
    wish(lang, wid, pending) {
      if (!pending.length) return { html: t(lang, 'host.no_wishes'), kb: [back(lang, `h:${wid}`)] };
      const [first] = pending;
      return { html: t(lang, 'host.wish', { name: first.name, text: first.text, n: pending.length - 1 }),
        kb: [[b(lang, 'btn.approve', `hwd:${wid}:${first.id}:a`), b(lang, 'btn.hide', `hwd:${wid}:${first.id}:h`)], back(lang, `h:${wid}`)] };
    },
    remindAsk(lang, wid, due) {
      if (!due) return { html: t(lang, 'host.remind_none'), kb: [back(lang, `h:${wid}`)] };
      return { html: t(lang, 'host.remind_ask', { n: due }), kb: [[b(lang, 'btn.remind_go', `hrg:${wid}`)], back(lang, `h:${wid}`)] };
    },
    doorHome(lang, st) {
      return { html: t(lang, 'door.bot', { couple: couple(st), arrived: st.arrived, people: st.people }),
        kb: [[{ text: unescape(t(lang, 'btn.scanner')), app: `#door=${st.id}` }], [b(lang, 'btn.refresh', `d:${st.id}`)], back(lang)] };
    },
    doorResult(lang, res) {
      if (res.result === 'ok') return t(lang, 'door.bot_ok', { name: res.name, people: people(t, lang, res.people), arrived: res.arrived, total: res.total });
      if (res.result === 'used') return t(lang, 'door.bot_used', { time: res.at ? clock(res.at) : '—', name: res.name, total: res.total });
      if (res.result === 'not_today') return t(lang, 'door.bot_not_today', { date: dateLong(t, lang, res.starts_at) });
      return t(lang, 'door.bot_bad');
    },
    answered: (lang, inv, w, coming) => t(lang, 'notify.answered', { mark: MARKS[inv.status], name: inv.name, answer: answerLine(t, lang, inv),
      couple: couple(w), people: coming, capacity: w.capacity }),
  };
}
