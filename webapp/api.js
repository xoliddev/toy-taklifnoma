// HTTP clients. The invitation page needs only its link; the Mini App sends Telegram's signed initData, which the
// server checks. The browser demo provides objects with the same methods that run inside the page (demo/api.js).
async function call(method, path, body, headers = {}) {
  let res;
  try {
    res = await fetch(path, { method, headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw Object.assign(new Error('offline'), { code: 'offline' });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error ?? 'generic'), { code: res.status === 404 ? 'not_found' : data.error ?? 'generic' });
  return data;
}

const LINK = /^[A-Za-z0-9_-]{22}$/;

export function publicApi(token) {
  if (!LINK.test(token ?? '')) throw Object.assign(new Error('not_found'), { code: 'not_found' });
  const base = `/api/public/invite/${token}`;
  return {
    invitation: () => call('GET', base),
    answer: (payload) => call('POST', `${base}/rsvp`, payload),
  };
}

export function miniApi(initData) {
  const auth = { Authorization: `tma ${initData}` };
  const id = (n) => Number(n);
  return {
    me: () => call('GET', '/api/me', undefined, auth),
    setLang: (lang) => call('POST', '/api/lang', { lang }, auth),
    dashboard: (wid, rev) => call('GET', `/api/host/${id(wid)}${rev === undefined ? '' : `?rev=${id(rev)}`}`, undefined, auth),
    invites: (wid) => call('GET', `/api/host/${id(wid)}/invites`, undefined, auth),
    decideWish: (wid, wish, action) => call('POST', `/api/host/${id(wid)}/wishes/${id(wish)}`, { action }, auth),
    remind: (wid) => call('POST', `/api/host/${id(wid)}/remind`, {}, auth),
    broadcast: (wid, text) => call('POST', `/api/host/${id(wid)}/broadcast`, { text }, auth),
    settings: (wid, changes) => call('POST', `/api/host/${id(wid)}/settings`, { changes }, auth),
    exportCsv: (wid) => call('POST', `/api/host/${id(wid)}/export`, {}, auth),
    door: (wid) => call('GET', `/api/door/${id(wid)}`, undefined, auth),
    checkin: (wid, code, people) => call('POST', `/api/door/${id(wid)}/checkin`, { code, people }, auth),
  };
}
