// JS port of toytaklif/core/seedgen.py: the fictional wedding 25 days after "now", with 80 invites.
import { atLocal, localDay, MIN_MS } from './clock.js';
import { h32 } from './text.js';

export const STORY_FAMILY = 1;
export const STORY_DECLINE = 2;
export const GUEST = 1001;
export const GUEST2 = 1002;
export const HOST_KUYOV = 2001;
export const HOST_KELIN = 2002;
export const CHECKER = 2101;
export const INVITES = 80;
export const PROGRAM = [[1080, 'welcome'], [1110, 'entrance'], [1140, 'feast'], [1230, 'cake'], [1350, 'farewell']];

export function wedding(now) {
  const day = localDay(now) + 25;
  return { id: 1, groom: 'Sardor', bride: 'Madina', starts_at: atLocal(day, 18 * 60), rsvp_deadline: atLocal(day - 3, 23 * 60 + 59),
    venue: "Gulbahor to'yxonasi", address: "Chilonzor tumani, Lolazor ko'chasi, 14-uy", lat: 41.28562, lon: 69.20341,
    capacity: 200, per_table: 10, theme: 'milliy', music: 'soft', dress: 'bayram',
    program: PROGRAM.map(([at, key]) => ({ at, key })), status: 'active' };
}

export function invite(i, names, now) {
  const h = h32(`inv:${i}`);
  const fam = names.families;
  let name;
  let seats;
  if (h % 10 < 6) [name, seats] = [`${fam[(i - 1) % fam.length]}lar oilasi`, 2 + ((h >>> 4) % 4)];
  else if ((h >>> 3) % 2) [name, seats] = [`${names.men[i % names.men.length]} ${fam[(i * 3) % fam.length]}`, 1 + ((h >>> 4) % 2)];
  else [name, seats] = [`${names.women[i % names.women.length]} ${fam[(i * 3) % fam.length]}a`, 1 + ((h >>> 4) % 2)];
  const r = (h >>> 12) % 100;
  let status = r < 42 ? 'yes' : r < 52 ? 'no' : r < 60 ? 'maybe' : 'none';
  let tg = (h >>> 20) % 10 < 7 ? 6000 + i : null;
  let side = (h >>> 8) % 2 === 0 ? 'kuyov' : 'kelin';
  let grp = names.groups[(h >>> 9) % names.groups.length];
  if (i === STORY_FAMILY) [name, seats, status, tg, side, grp] = ['Karimovlar oilasi', 3, 'none', GUEST, 'kuyov', 'Qarindoshlar'];
  else if (i === STORY_DECLINE) [name, seats, status, tg, side, grp] = ['Rustam Nazarov', 2, 'none', GUEST2, 'kelin', 'Hamkasblar'];
  let people = 0;
  if (status === 'yes') people = seats - (seats > 1 && (h >>> 16) % 3 === 0 ? 1 : 0);
  else if (status === 'maybe') people = seats;
  const answered = status === 'none' ? null : now - (((h >>> 18) % 9000) + 30) * MIN_MS;
  return { id: i, wedding_id: 1, name, seats, side, grp, status, people, note: '', answered_at: answered, version: 1, checked_in: 0,
    last_checkin_at: null, reminded_at: null, tg, lang: (h >>> 24) % 10 === 0 ? 'ru' : 'uz' };
}

export function world(names, now) {
  const invites = Array.from({ length: INVITES }, (_, k) => invite(k + 1, names, now));
  const yes = invites.filter((x) => x.status === 'yes');
  const wishes = [0, 1, 2, 3].map((k) => ({ id: k + 1, invite_id: yes[k * 5].id, text: names.wishes[k],
    status: k < 3 ? 'approved' : 'pending', created_at: now - (k + 2) * 3 * 3_600_000 }));
  const users = [{ id: HOST_KUYOV, name: 'Akmal aka' }, { id: HOST_KELIN, name: 'Zulfiya opa' }, { id: CHECKER, name: 'Bobur' },
    { id: GUEST, name: 'Anvar Karimov' }, { id: GUEST2, name: 'Rustam Nazarov' }];
  return { wedding: wedding(now), invites, wishes, users,
    hosts: [{ user_id: HOST_KUYOV, side: 'kuyov' }, { user_id: HOST_KELIN, side: 'kelin' }], checkers: [CHECKER] };
}
