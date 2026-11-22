// Small DOM helpers. No framework, no build step. User text only ever goes through textContent (never innerHTML).
export { makeT } from '../shared/i18n.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Both locale files and the name lists (the bot reads the very same JSON). */
export async function loadShared(base = new URL('../shared/', import.meta.url), withNames = false) {
  const get = (p) => fetch(new URL(p, base)).then((r) => {
    if (!r.ok) throw new Error(`load ${p}`);
    return r.json();
  });
  const [uz, ru, names] = await Promise.all([get('locales/uz.json'), get('locales/ru.json'), withNames ? get('data/names.json') : null]);
  return { catalogs: { uz, ru }, ...(names ? { names } : {}) };
}

function attach(el, attrs, children) {
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.setAttribute('class', v);
    else if (k === 'html') el.innerHTML = v; // only locale templates whose params are escaped, never user text
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** h('div', {class: 'x', onclick: fn}, child, 'text') — children may be nodes, strings or arrays. */
export const h = (tag, attrs = {}, ...children) => attach(document.createElement(tag), attrs, children);
/** The same for SVG elements. */
export const s = (tag, attrs = {}, ...children) => attach(document.createElementNS(SVG_NS, tag), attrs, children);

/** Plain text of a locale template (for aria-labels and buttons). */
export const plain = (html) => {
  const d = document.createElement('div');
  d.innerHTML = html;
  return d.textContent;
};

export const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

export const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

export function haptic(tg, kind = 'light') {
  try {
    if (kind === 'success' || kind === 'error' || kind === 'warning') tg?.HapticFeedback?.notificationOccurred(kind);
    else tg?.HapticFeedback?.impactOccurred(kind);
  } catch {
    /* not inside Telegram */
  }
}

/** A short message at the bottom of `root`. */
export function toast(root, text, kind = '') {
  let box = root.querySelector(':scope > .tt-toasts');
  if (!box) {
    box = h('div', { class: 'tt-toasts', role: 'status', 'aria-live': 'polite' });
    root.append(box);
  }
  const el = h('div', { class: `tt-toast ${kind}` }, text);
  box.append(el);
  setTimeout(() => el.classList.add('out'), 2600);
  setTimeout(() => el.remove(), 3100);
}

export const errText = (t, lang, e) => {
  const key = `err.${e?.code ?? 'generic'}`;
  const txt = t(lang, key);
  return plain(txt === key ? t(lang, 'err.generic') : txt);
};

/** Like t() but without HTML escaping: the result is only ever put into textContent, so nothing is parsed. */
export function makeText(catalogs) {
  return (lang, key, params = {}) => {
    const l = lang === 'ru' ? 'ru' : 'uz';
    const template = catalogs[l]?.[key] || catalogs.uz?.[key] || key;
    return template.replace(/<[^>]+>/g, '').replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m));
  };
}
