// The page's and the Mini App's APIs, answered by the in-browser backend instead of HTTP (same shapes as
// toytaklif/web.py and web_api.py). Errors carry the same codes the server sends, so the page code is identical.
export function run(fn) {
  return Promise.resolve().then(() => {
    try {
      return structuredClone(fn());
    } catch (e) {
      throw Object.assign(new Error(e.code ?? 'generic'), { code: e.code ?? 'generic' });
    }
  });
}

export const publicFor = (b, token) => ({
  invitation: () => run(() => b.invitation(token)),
  answer: (payload) => run(() => b.answer(token, payload)),
});

export function miniFor(b, uid, { onCsv } = {}) {
  return {
    me: () => run(() => ({ id: uid, lang: b.user(uid).lang, guest: b.guestInvites(uid).map((x) => ({ id: x.id, token: x.token, name: x.name, wedding_id: 1 })),
      host: b.hosts.some((x) => x.user_id === uid) ? [{ id: 1, groom: b.wedding.groom, bride: b.wedding.bride }] : [],
      door: b.checkers.has(uid) ? [{ id: 1, groom: b.wedding.groom, bride: b.wedding.bride }] : [], now: b.nowMs() })),
    setLang: (lang) => run(() => { b.setLang(uid, lang); return { lang }; }),
    dashboard: (wid, rev) => run(() => b.dashboard(uid, Number(wid), rev === undefined ? undefined : Number(rev))),
    invites: (wid) => run(() => ({ items: b.inviteLinks(uid, Number(wid)) })),
    decideWish: (wid, wish, action) => run(() => b.decideWish(uid, Number(wid), Number(wish), action)),
    remind: (wid) => run(() => ({ sent: b.remind(uid, Number(wid)).length })),
    broadcast: (wid, text) => run(() => b.broadcast(uid, Number(wid), text)),
    settings: (wid, changes) => run(() => b.settings(uid, Number(wid), changes)),
    exportCsv: (wid) => run(() => {
      const csv = b.exportCsv(uid, Number(wid));
      onCsv?.(csv);
      return { csv };
    }),
    door: (wid) => run(() => b.doorStatus(uid, Number(wid))),
    checkin: (wid, code, people) => run(() => b.checkin(uid, Number(wid), code, people ?? null)),
  };
}
