// The entry pass on screen: the QR drawn on a <canvas> from shared/qr.js (the same matrix the bot sends as a PNG),
// and the reverse for the demo's door: sample a canvas module by module and read it with shared/qr-read.js.
import { matrix } from '../shared/qr.js';
import { readMatrix } from '../shared/qr-read.js';

export const BORDER = 4;

export function qrCanvas(text, cssPx = 220, label = '') {
  const m = matrix(text);
  const cells = m.length + 2 * BORDER;
  const unit = Math.max(2, Math.floor((cssPx * (window.devicePixelRatio || 1)) / cells));
  const cv = document.createElement('canvas');
  cv.width = cv.height = cells * unit;
  cv.className = 'qr';
  cv.style.width = cv.style.height = `${cssPx}px`;
  cv.setAttribute('role', 'img');
  if (label) cv.setAttribute('aria-label', label);
  const g = cv.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, cv.width, cv.height);
  g.fillStyle = '#111';
  m.forEach((row, r) => row.forEach((v, c) => { if (v) g.fillRect((c + BORDER) * unit, (r + BORDER) * unit, unit, unit); }));
  cv.dataset.cells = String(cells);
  return cv;
}

/** Read a QR canvas drawn by qrCanvas (or a copy of one): try each size, keep the one whose checks pass. */
export function readCanvas(cv) {
  const g = cv.getContext('2d', { willReadFrequently: true });
  const { data, width } = g.getImageData(0, 0, cv.width, cv.height);
  for (let version = 1; version <= 10; version++) {
    const n = 17 + 4 * version;
    const cells = n + 2 * BORDER;
    const unit = width / cells;
    if (unit < 1) break;
    const m = [];
    for (let r = 0; r < n; r++) {
      const row = [];
      for (let c = 0; c < n; c++) {
        const x = Math.floor((c + BORDER + 0.5) * unit);
        const y = Math.floor((r + BORDER + 0.5) * unit);
        row.push(data[(y * width + x) * 4] < 128 ? 1 : 0);
      }
      m.push(row);
    }
    const text = readMatrix(m);
    if (text !== null) return text;
  }
  return null;
}
