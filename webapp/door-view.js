// The door checker's screen: pick how many walk in now (everyone, or 1, 2, 3 for a family arriving in parts), scan
// the guest's QR (the phone camera through BarcodeDetector where the browser has it) or type the 10-character code,
// and get a big ✅ / ⚠️ / ❌. The server decides; this screen only shows. No guest list is ever shown here.
import { clock, dateLong, makeT, people as peopleText } from '../shared/i18n.js';
import { errText, h, haptic, makeText } from './util.js';

const ICON = { ok: '✅', used: '⚠️', bad: '❌', not_today: '⏳' };

export function mountDoor(root, { api, catalogs, lang = 'uz', wid, tg = null, demoCamera = null }) {
  const t = makeT(catalogs);
  const text = makeText(catalogs);
  const T = (key, params) => text(lang, key, params);
  const tx = (l, key, params) => text(l, key, params);
  let want = null;
  let stream = null;
  let scanning = false;
  const counter = h('p', { class: 'door-count', 'data-testid': 'door-count' });
  const title = h('h2');
  const result = h('section', { class: 'door-result', 'data-testid': 'door-result', 'aria-live': 'assertive', hidden: true });
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': T('door.who') });
  const video = h('video', { class: 'door-video', muted: true, playsinline: true, hidden: true });
  const finder = h('div', { class: 'door-cam', 'data-testid': 'door-cam' }, video, h('i', { class: 'scanline' }), h('span', { class: 'cam-hint' }, T('door.hint')));
  const camBtn = h('button', { class: 'tt-btn', type: 'button', 'data-testid': 'door-camera', onclick: () => (stream ? stopCamera() : startCamera()) },
    `📷 ${T('door.scan')}`);
  const input = h('input', { class: 'tt-input code', maxlength: 80, autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false',
    placeholder: 'K7Q2M-9XD4A', 'aria-label': T('door.code'), 'data-testid': 'door-code' });
  const form = h('form', { class: 'door-manual', onsubmit: (e) => { e.preventDefault(); check(input.value); } }, input,
    h('button', { class: 'tt-btn', type: 'submit', 'data-testid': 'door-check' }, T('door.check')));

  function paintChips() {
    chips.replaceChildren(...[null, 1, 2, 3, 4, 5].map((n) => h('button', { type: 'button', class: `chip${want === n ? ' on' : ''}`,
      'data-testid': `door-want-${n ?? 'all'}`, onclick: () => { want = n; paintChips(); } }, n === null ? T('door.all') : String(n))));
  }

  async function status() {
    try {
      const st = await api.door(wid);
      title.textContent = `${st.groom} & ${st.bride}`;
      counter.textContent = T('door.arrived', { arrived: st.arrived, people: st.people });
    } catch (err) {
      counter.textContent = errText(t, lang, err);
    }
  }

  function show(res) {
    const kind = res.result;
    let head;
    let sub = '';
    if (kind === 'ok') {
      head = T('door.ok', { name: res.name, people: peopleText(tx, lang, res.people) });
      sub = `${T('door.ok_sub', { arrived: res.arrived, total: res.total })}${res.left ? ` · ${T('door.ok_more', { n: res.left })}` : ''}`;
    } else if (kind === 'used') {
      head = T('door.used', { time: res.at ? clock(res.at) : '—' });
      sub = T('door.used_sub', { name: res.name, total: res.total });
    } else if (kind === 'not_today') {
      head = T('door.not_today', { date: dateLong(tx, lang, res.starts_at) });
    } else {
      head = T('door.bad');
      sub = T('door.bad_sub');
    }
    haptic(tg, kind === 'ok' ? 'success' : kind === 'used' ? 'warning' : 'error');
    result.className = `door-result is-${kind}`;
    result.hidden = false;
    result.replaceChildren(h('span', { class: 'big-icon', 'aria-hidden': 'true' }, ICON[kind]), h('b', { 'data-testid': 'door-head' }, head),
      sub ? h('p', {}, sub) : null, h('button', { class: 'tt-btn ghost', type: 'button', onclick: () => { result.hidden = true; input.value = ''; } }, T('door.next')));
  }

  async function check(code) {
    const value = String(code ?? '').trim();
    if (!value) return null;
    try {
      const res = await api.checkin(wid, value, want);
      show(res);
      want = null;
      paintChips();
      await status();
      return res;
    } catch (err) {
      show({ result: 'bad' });
      result.querySelector('p')?.replaceChildren(errText(t, lang, err));
      return null;
    }
  }

  async function startCamera() {
    if (demoCamera) return demoCamera(check, finder);
    if (!('BarcodeDetector' in window) || !navigator.mediaDevices?.getUserMedia) {
      finder.querySelector('.cam-hint').textContent = T('door.camera_off');
      input.focus();
      return null;
    }
    try {
      const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      video.srcObject = stream;
      video.hidden = false;
      await video.play();
      finder.classList.add('live');
      camBtn.textContent = `■ ${T('door.stop')}`;
      const loop = async () => {
        if (!stream) return;
        if (!scanning) {
          const codes = await detector.detect(video).catch(() => []);
          if (codes[0]?.rawValue) {
            scanning = true;
            await check(codes[0].rawValue);
            setTimeout(() => { scanning = false; }, 2500); // one family at a time
          }
        }
        requestAnimationFrame(loop);
      };
      loop();
    } catch {
      finder.querySelector('.cam-hint').textContent = T('door.camera_off');
    }
    return null;
  }

  function stopCamera() {
    stream?.getTracks().forEach((tr) => tr.stop());
    stream = null;
    video.hidden = true;
    finder.classList.remove('live');
    camBtn.textContent = `📷 ${T('door.scan')}`;
  }

  paintChips();
  root.replaceChildren(h('div', { class: 'door', 'data-testid': 'door' },
    h('header', { class: 'dash-head' }, h('div', {}, h('small', {}, T('door.title')), title), counter),
    h('section', { class: 'dash-card' }, h('h3', {}, T('door.who')), chips),
    h('section', { class: 'dash-card' }, finder, camBtn, h('p', { class: 'muted or' }, T('door.manual')), form),
    result));
  status();
  return { check, status, startCamera, stopCamera, get result() { return result; } };
}
