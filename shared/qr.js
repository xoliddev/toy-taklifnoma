// JS port of toytaklif/core/qr.py: QR Code encoder, byte mode, level M, versions 1-10, best of 8 masks.
// matrix(text) -> rows of 0/1 without the quiet zone; the server draws the same matrix into the bot's PNG.
export const BLOCKS = { 1: [10, [[1, 16]]], 2: [16, [[1, 28]]], 3: [26, [[1, 44]]], 4: [18, [[2, 32]]], 5: [24, [[2, 43]]],
  6: [16, [[4, 27]]], 7: [18, [[4, 31]]], 8: [22, [[2, 38], [2, 39]]], 9: [22, [[3, 36], [2, 37]]], 10: [26, [[4, 43], [1, 44]]] };
export const ALIGN = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42],
  9: [6, 26, 46], 10: [6, 28, 50] };
const EC_M = 0;
const enc = new TextEncoder();

export const EXP = new Array(512).fill(0);
export const LOG = new Array(256).fill(0);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}
const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

export function rsRemainder(data, n) {
  let gen = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array(gen.length + 1).fill(0);
    gen.forEach((g, j) => {
      next[j] ^= g;
      next[j + 1] ^= mul(g, EXP[i]);
    });
    gen = next;
  }
  let rem = new Array(n).fill(0);
  for (const d of data) {
    const factor = d ^ rem[0];
    rem = [...rem.slice(1), 0];
    for (let j = 0; j < n; j++) rem[j] ^= mul(gen[j + 1], factor);
  }
  return rem;
}

export const capacity = (v) => BLOCKS[v][1].reduce((s, [b, d]) => s + b * d, 0);

export function pickVersion(nBytes) {
  for (let v = 1; v <= 10; v++) if (4 + (v < 10 ? 8 : 16) + 8 * nBytes <= 8 * capacity(v)) return v;
  throw new Error('too long');
}

/** Data codewords split into blocks (the decoder needs the same split). */
export function blockSizes(version) {
  const out = [];
  for (const [count, size] of BLOCKS[version][1]) for (let i = 0; i < count; i++) out.push(size);
  return out;
}

export function codewords(data, version) {
  const bits = [];
  const put = (value, n) => { for (let k = 0; k < n; k++) bits.push((value >> (n - 1 - k)) & 1); };
  put(0b0100, 4);
  put(data.length, version < 10 ? 8 : 16);
  for (const b of data) put(b, 8);
  const total = 8 * capacity(version);
  put(0, Math.min(4, total - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  const out = [];
  for (let k = 0; k < bits.length; k += 8) out.push(parseInt(bits.slice(k, k + 8).join(''), 2));
  const pad = [0xec, 0x11];
  const used = bits.length / 8;
  while (out.length < capacity(version)) out.push(pad[(out.length - used) % 2]);
  const ecN = BLOCKS[version][0];
  const blocks = [];
  let k = 0;
  for (const size of blockSizes(version)) {
    blocks.push(out.slice(k, k + size));
    k += size;
  }
  const ecs = blocks.map((b) => rsRemainder(b, ecN));
  const final = [];
  const longest = Math.max(...blocks.map((b) => b.length));
  for (let i = 0; i < longest; i++) for (const b of blocks) if (i < b.length) final.push(b[i]);
  for (let i = 0; i < ecN; i++) for (const e of ecs) final.push(e[i]);
  return final;
}

export function functionMap(version) {
  const n = 17 + 4 * version;
  const m = Array.from({ length: n }, () => new Array(n).fill(0));
  const fn = Array.from({ length: n }, () => new Array(n).fill(false));
  const setf = (r, c, v) => { m[r][c] = v; fn[r][c] = true; };
  for (const [r0, c0] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
    for (let dr = -1; dr < 8; dr++) {
      for (let dc = -1; dc < 8; dc++) {
        const r = r0 + dr;
        const c = c0 + dc;
        if (r < 0 || r >= n || c < 0 || c >= n) continue;
        const inside = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        const ring = dr === 0 || dr === 6 || dc === 0 || dc === 6;
        const core = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        setf(r, c, inside && (ring || core) ? 1 : 0);
      }
    }
  }
  const pos = ALIGN[version];
  for (const r of pos) {
    for (const c of pos) {
      if (fn[r][c]) continue;
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) setf(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1 ? 1 : 0);
    }
  }
  for (let i = 8; i < n - 8; i++) {
    setf(6, i, 1 - (i % 2));
    setf(i, 6, 1 - (i % 2));
  }
  for (let i = 0; i < 9; i++) {
    if (!fn[8][i]) setf(8, i, 0);
    if (!fn[i][8]) setf(i, 8, 0);
  }
  for (let i = 0; i < 8; i++) {
    setf(8, n - 1 - i, 0);
    setf(n - 1 - i, 8, 0);
  }
  setf(n - 8, 8, 1);
  if (version >= 7) {
    for (let i = 0; i < 18; i++) {
      setf(n - 11 + (i % 3), Math.floor(i / 3), 0);
      setf(Math.floor(i / 3), n - 11 + (i % 3), 0);
    }
  }
  return [m, fn];
}

function bch(value, poly, deg) {
  const len = (x) => (x === 0 ? 0 : 32 - Math.clz32(x));
  let rem = value << deg;
  const top = len(poly) - 1;
  while (len(rem) - 1 >= top) rem ^= poly << (len(rem) - 1 - top);
  return (value << deg) | rem;
}
export const formatBits = (mask) => bch((EC_M << 3) | mask, 0x537, 10) ^ 0x5412;
export const versionBits = (version) => bch(version, 0x1f25, 12);

export const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

export function zigzag(n) {
  const out = [];
  let right = n - 1;
  while (right >= 1) {
    if (right === 6) right = 5;
    const upward = ((right + 1) & 2) === 0;
    for (let vert = 0; vert < n; vert++) {
      const r = upward ? n - 1 - vert : vert;
      for (let j = 0; j < 2; j++) out.push([r, right - j]);
    }
    right -= 2;
  }
  return out;
}

export function drawInfo(m, version, mask) {
  const n = m.length;
  const bits = formatBits(mask);
  const b = Array.from({ length: 15 }, (_, i) => (bits >> i) & 1);
  for (let i = 0; i < 6; i++) m[i][8] = b[i];
  [m[7][8], m[8][8], m[8][7]] = [b[6], b[7], b[8]];
  for (let i = 9; i < 15; i++) m[8][14 - i] = b[i];
  for (let i = 0; i < 8; i++) m[8][n - 1 - i] = b[i];
  for (let i = 8; i < 15; i++) m[n - 15 + i][8] = b[i];
  m[n - 8][8] = 1;
  if (version >= 7) {
    const vb = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const bit = (vb >> i) & 1;
      m[Math.floor(i / 3)][n - 11 + (i % 3)] = bit;
      m[n - 11 + (i % 3)][Math.floor(i / 3)] = bit;
    }
  }
}

const FINDER_A = '10111010000';
const FINDER_B = '00001011101';

export function penalty(m) {
  const n = m.length;
  let score = 0;
  const lines = [...m, ...Array.from({ length: n }, (_, c) => m.map((row) => row[c]))];
  for (const line of lines) {
    let run = 1;
    for (let k = 1; k <= n; k++) {
      if (k < n && line[k] === line[k - 1]) run += 1;
      else {
        if (run >= 5) score += 3 + run - 5;
        run = 1;
      }
    }
    const s = line.join('');
    for (let k = 0; k < n - 10; k++) {
      const seg = s.slice(k, k + 11);
      if (seg === FINDER_A || seg === FINDER_B) score += 40;
    }
  }
  for (let r = 0; r < n - 1; r++) {
    for (let c = 0; c < n - 1; c++) {
      const v = m[r][c];
      if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) score += 3;
    }
  }
  const dark = m.reduce((s, row) => s + row.reduce((a, b) => a + b, 0), 0);
  return score + 10 * Math.floor(Math.abs(dark * 100 - n * n * 50) / (n * n * 5));
}

export function matrix(text) {
  const data = enc.encode(text);
  const version = pickVersion(data.length);
  const cw = codewords(data, version);
  const [base, fn] = functionMap(version);
  const order = zigzag(base.length).filter(([r, c]) => !fn[r][c]);
  const nbits = 8 * cw.length;
  order.forEach(([r, c], k) => { base[r][c] = k < nbits ? (cw[k >> 3] >> (7 - (k & 7))) & 1 : 0; });
  let best = null;
  let bestScore = -1;
  MASKS.forEach((rule, mask) => {
    const m = base.map((row) => row.slice());
    for (const [r, c] of order) if (rule(r, c)) m[r][c] ^= 1;
    drawInfo(m, version, mask);
    const s = penalty(m);
    if (best === null || s < bestScore) {
      best = m;
      bestScore = s;
    }
  });
  return best;
}

export const asText = (m) => m.map((row) => row.join('')).join('/');
