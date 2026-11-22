// JS port of toytaklif/core/stats.py: the hosts' live numbers.
import { DAY_MS } from './clock.js';

const empty = () => ({ yes: 0, no: 0, maybe: 0, none: 0, people: 0, maybe_people: 0, invites: 0 });
export const ceilDiv = (a, b) => Math.ceil(a / b);
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export function remindDue(inv, now) {
  if (!['none', 'maybe'].includes(inv.status) || !inv.tg) return false;
  return inv.reminded_at === null || inv.reminded_at === undefined || now - inv.reminded_at >= DAY_MS;
}

function add(bucket, inv) {
  bucket[inv.status] += 1;
  bucket.invites += 1;
  if (inv.status === 'yes') bucket.people += inv.people;
  else if (inv.status === 'maybe') bucket.maybe_people += inv.people;
}

export function summary(wedding, invites, now) {
  const total = empty();
  const sides = { kuyov: empty(), kelin: empty() };
  const groups = new Map();
  let arrived = 0;
  let arrivedInvites = 0;
  let due = 0;
  let seats = 0;
  for (const inv of invites) {
    add(total, inv);
    add(sides[inv.side], inv);
    if (!groups.has(inv.grp)) groups.set(inv.grp, { name: inv.grp, ...empty() });
    add(groups.get(inv.grp), inv);
    seats += inv.seats;
    arrived += inv.checked_in ?? 0;
    arrivedInvites += (inv.checked_in ?? 0) > 0 ? 1 : 0;
    due += remindDue(inv, now) ? 1 : 0;
  }
  const cap = wedding.capacity;
  const per = wedding.per_table;
  const { people } = total;
  return {
    ...total, seats, answered: total.yes + total.no + total.maybe,
    capacity: cap, pct: cap ? Math.min(100, Math.floor((people * 100) / cap)) : 0, free: cap - people,
    over: Math.max(0, people - cap), per_table: per, tables: ceilDiv(people, per),
    tables_max: ceilDiv(people + total.maybe_people, per), sides,
    groups: [...groups.values()].sort((a, b) => b.invites - a.invites || cmp(a.name, b.name)),
    arrived, arrived_invites: arrivedInvites, remind_due: due,
  };
}
