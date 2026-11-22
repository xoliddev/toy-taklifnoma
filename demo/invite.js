// The full-page invitation from the demo, without phones: the same invitation code with the in-browser backend.
// The guest's link comes from the hash (#t=<link>); without one it opens the Karimov family's invitation.
import { publicFor } from './api.js';
import { DemoBackend } from './backend.js';
import { mountInvite } from '../webapp/invite-view.js';
import { h, loadShared } from '../webapp/util.js';

const shared = await loadShared(new URL('../shared/', import.meta.url), true);
const backend = new DemoBackend({ names: shared.names });
const m = /^#t=([A-Za-z0-9_-]{22})$/.exec(window.location.hash);
const token = m ? m[1] : backend.invite(1).token;
const strip = h('div', { class: 'demo-strip' }, h('span', {}, 'Demo · ismlar va to\'yxona o\'ylab topilgan · hammasi brauzeringizda'),
  h('a', { href: '../' }, '← Demo sahifasi'));
document.body.prepend(strip);
const app = mountInvite(document.getElementById('invite'), { api: publicFor(backend, token), catalogs: shared.catalogs });
await app.refresh(true);
document.body.dataset.ready = '1';
