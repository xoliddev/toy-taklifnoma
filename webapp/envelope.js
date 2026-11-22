// The open-the-envelope intro: a sealed envelope addressed to the guest; a tap breaks the seal, the flap swings
// open, the card rises out and the envelope fades away. With prefers-reduced-motion it simply disappears.
import { seal } from './art.js';
import { h, reducedMotion } from './util.js';

export function mountEnvelope(host, { T, name, groom, bride, onOpen }) {
  const btn = h('button', { class: 'env-open', type: 'button', 'data-testid': 'envelope-open' }, T('inv.open'));
  const overlay = h('div', { class: 'env-overlay', 'data-testid': 'envelope' },
    h('div', { class: 'env' },
      h('div', { class: 'env-back' }),
      h('div', { class: 'env-letter' }, h('span', { class: 'env-letter-names' }, `${groom} & ${bride}`)),
      h('div', { class: 'env-front' },
        h('small', {}, T('inv.envelope')),
        h('b', { class: 'env-to' }, name)),
      h('div', { class: 'env-flap' }),
      h('div', { class: 'env-seal-wrap' }, seal(groom, bride))),
    btn);
  let done = false;
  function open() {
    if (done) return;
    done = true;
    const finish = () => {
      overlay.remove();
      onOpen?.();
    };
    if (reducedMotion()) {
      finish();
      return;
    }
    overlay.classList.add('opening');
    setTimeout(() => overlay.classList.add('leaving'), 1250);
    setTimeout(finish, 1900);
  }
  btn.addEventListener('click', open);
  overlay.querySelector('.env').addEventListener('click', open);
  host.append(overlay);
  setTimeout(() => btn.focus({ preventScroll: true }), 50);
  return { open, get opened() { return done; } };
}
