// JS port of toytaklif/core/qrtoken.py: the signed entry pass and the short hand-typed code.
import { b64url, hmacSha256, sameText } from './sha256.js';

export const PREFIX = 'TT1';
export const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const TOKEN = /^TT1\.([1-9][0-9]{0,8})\.([1-9][0-9]{0,8})\.([1-9][0-9]?)\.([1-9][0-9]{0,5})\.([A-Za-z0-9_-]{22})$/;
const FOLD = { O: '0', I: '1', L: '1' };

export function sign(secret, weddingId, inviteId, people, version) {
  const body = `${weddingId}.${inviteId}.${people}.${version}`;
  return `${PREFIX}.${body}.${b64url(hmacSha256(secret, `qr|${body}`).slice(0, 16))}`;
}

export function parse(token) {
  if (typeof token !== 'string' || token.length > 80) return null;
  const m = TOKEN.exec(token.trim());
  if (!m) return null;
  return { wedding_id: Number(m[1]), invite_id: Number(m[2]), people: Number(m[3]), version: Number(m[4]), sig: m[5] };
}

export function verify(secret, token) {
  const f = parse(token);
  if (!f) return null;
  return sameText(sign(secret, f.wedding_id, f.invite_id, f.people, f.version), token.trim()) ? f : null;
}

export function entryCode(secret, inviteId, version) {
  const mac = hmacSha256(secret, `code|${inviteId}|${version}`);
  let bits = '';
  for (const b of mac.slice(0, 7)) bits += b.toString(2).padStart(8, '0');
  let out = '';
  for (let k = 0; k < 10; k++) out += CODE_ALPHABET[parseInt(bits.slice(5 * k, 5 * k + 5), 2)];
  return `${out.slice(0, 5)}-${out.slice(5)}`;
}

export function normCode(text) {
  if (typeof text !== 'string' || text.length > 40) return null;
  const s = Array.from(text.toUpperCase()).filter((ch) => /^[A-Z0-9]$/.test(ch)).map((ch) => FOLD[ch] ?? ch).join('');
  if (s.length !== 10 || [...s].some((ch) => !CODE_ALPHABET.includes(ch))) return null;
  return `${s.slice(0, 5)}-${s.slice(5)}`;
}
