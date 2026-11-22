// JS port of toytaklif/core/rsvp.py: answer checks, the version bump, a host's new invite.
import { clean, InputError, whole } from './text.js';

export const STATUSES = ['yes', 'no', 'maybe'];
export const SIDES = ['kuyov', 'kelin'];
export const NOTE_MAX = 200;
export const WISH_MAX = 300;
export const NAME_MAX = 60;
export const GROUP_MAX = 40;
export const SEATS = [1, 10];
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

export function validate(answer, invite, wedding, now) {
  if (!isObj(answer)) throw new InputError('generic');
  if (now > wedding.rsvp_deadline) throw new InputError('deadline');
  if ((invite.checked_in ?? 0) > 0) throw new InputError('checked_in');
  const { status } = answer;
  if (!STATUSES.includes(status)) throw new InputError('status');
  const { seats } = invite;
  let people = 0;
  if (status === 'yes') people = whole(answer.people, 1, seats, 'people');
  else if (status === 'maybe') people = whole('people' in answer ? answer.people : seats, 0, seats, 'people');
  const note = 'note' in answer ? answer.note : '';
  const wish = 'wish' in answer ? answer.wish : '';
  if (typeof note !== 'string' || typeof wish !== 'string' || note.length > 2000 || wish.length > 3000) throw new InputError('generic');
  return { status, people, note: clean(note, NOTE_MAX), wish: clean(wish, WISH_MAX) };
}

export function apply(invite, answer, now) {
  const changed = answer.status !== invite.status || answer.people !== invite.people;
  return { ...invite, status: answer.status, people: answer.people, note: answer.note, answered_at: now,
    version: invite.version + (changed ? 1 : 0) };
}

export function checkInvite(data) {
  if (!isObj(data)) throw new InputError('generic');
  const name = typeof data.name === 'string' ? clean(data.name, NAME_MAX) : '';
  if (Array.from(name).length < 2) throw new InputError('name');
  const seats = whole(data.seats, SEATS[0], SEATS[1], 'seats');
  if (!SIDES.includes(data.side)) throw new InputError('side');
  const grp = 'grp' in data ? data.grp : '';
  if (typeof grp !== 'string') throw new InputError('generic');
  return { name, seats, side: data.side, grp: clean(grp, GROUP_MAX) };
}
