// Reads a clean QR matrix back to text (the demo's door scanner reads the guest's on-screen pass module by module).
// Error correction is used only to *check*: any wrong module makes the read fail instead of guessing.
import { blockSizes, BLOCKS, formatBits, functionMap, MASKS, rsRemainder, zigzag } from './qr.js';

const dec = new TextDecoder('utf-8', { fatal: true });

function readFormat(m) {
  const n = m.length;
  let a = 0;
  let b = 0;
  const first = [];
  for (let i = 0; i < 6; i++) first.push(m[i][8]);
  first.push(m[7][8], m[8][8], m[8][7]);
  for (let i = 9; i < 15; i++) first.push(m[8][14 - i]);
  const second = [];
  for (let i = 0; i < 8; i++) second.push(m[8][n - 1 - i]);
  for (let i = 8; i < 15; i++) second.push(m[n - 15 + i][8]);
  first.forEach((bit, i) => { a |= bit << i; });
  second.forEach((bit, i) => { b |= bit << i; });
  for (let mask = 0; mask < 8; mask++) if (formatBits(mask) === a || formatBits(mask) === b) return mask;
  return null; // another error-correction level or damaged format bits: not one of our passes
}

/** rows of 0/1 (no quiet zone) -> text, or null when it is not a readable level-M QR from this encoder. */
export function readMatrix(m) {
  const n = m?.length ?? 0;
  if (n < 21 || (n - 17) % 4 !== 0 || m.some((row) => row.length !== n)) return null;
  const version = (n - 17) / 4;
  if (!(version in BLOCKS)) return null;
  const mask = readFormat(m);
  if (mask === null) return null;
  const [, fn] = functionMap(version);
  const order = zigzag(n).filter(([r, c]) => !fn[r][c]);
  const bits = order.map(([r, c]) => m[r][c] ^ (MASKS[mask](r, c) ? 1 : 0));
  const sizes = blockSizes(version);
  const ecN = BLOCKS[version][0];
  const total = sizes.reduce((s, x) => s + x, 0) + ecN * sizes.length;
  const cw = [];
  for (let k = 0; k < total; k++) cw.push(parseInt(bits.slice(8 * k, 8 * k + 8).join(''), 2));
  const blocks = sizes.map(() => []);
  let k = 0;
  for (let i = 0; i < Math.max(...sizes); i++) sizes.forEach((s, b) => { if (i < s) blocks[b].push(cw[k++]); });
  const ecs = sizes.map(() => []);
  for (let i = 0; i < ecN; i++) ecs.forEach((e) => e.push(cw[k++]));
  if (blocks.some((b, i) => rsRemainder(b, ecN).some((x, j) => x !== ecs[i][j]))) return null;
  const data = blocks.flat();
  const stream = data.map((x) => x.toString(2).padStart(8, '0')).join('');
  if (stream.slice(0, 4) !== '0100') return null;
  const lenBits = version < 10 ? 8 : 16;
  const len = parseInt(stream.slice(4, 4 + lenBits), 2);
  const start = 4 + lenBits;
  if (start + 8 * len > stream.length) return null;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = parseInt(stream.slice(start + 8 * i, start + 8 * i + 8), 2);
  try {
    return dec.decode(out);
  } catch {
    return null;
  }
}
