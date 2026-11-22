// The invitation website: /i/<link> on the server. The link in the address bar is the only key.
import { publicApi } from './api.js';
import { mountInvite } from './invite-view.js';
import { h, loadShared } from './util.js';

const root = document.getElementById('invite');
const shared = await loadShared(new URL('../shared/', import.meta.url));
const token = window.location.pathname.split('/').filter(Boolean).pop() ?? '';
try {
  const app = mountInvite(root, { api: publicApi(token), catalogs: shared.catalogs, lang: navigator.language?.startsWith('ru') ? 'ru' : 'uz' });
  await app.refresh(true);
  if (app.view) document.title = `${app.view.wedding.groom} & ${app.view.wedding.bride}`;
  document.addEventListener('visibilitychange', () => { if (!document.hidden) app.refresh(); });
} catch {
  root.replaceChildren(h('p', { class: 'inv-missing' }, shared.catalogs.uz['inv.not_found']));
}
