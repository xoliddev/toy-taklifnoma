// The guided scenario. Each step does what a person would do, through the invitation page, the hosts' dashboard,
// the door screen and the simulated bot. Steps run in order (with pauses), all at once, or clicked out of order:
// a step first quietly does whatever it needs from earlier steps. js-tests/demo.test.mjs runs the same steps headless.
import { forge, GUEST, HOST, STORY_DECLINE, STORY_FAMILY, WISH, CHECKER } from './seed.js';

export const STEPS = ['step1', 'step2', 'step3', 'step4', 'step5', 'step6', 'step7', 'step8', 'step9', 'step10', 'step11'];
const NEEDS = { 3: [2], 5: [2], 8: [2, 7], 9: [8], 10: [9], 11: [7] };

const family = (b) => b.invite(STORY_FAMILY);
const wishOf = (b) => b.wishes.find((k) => k.invite_id === STORY_FAMILY);

const ACTIONS = {
  // 1. The Karimov family opens their personal invitation: the envelope, the countdown, the map, the music button.
  async 1({ ui, focus, pause }) {
    focus(GUEST, 'app');
    await ui?.openInvitation();
    await pause(500);
  },
  // 2. They answer "Kelaman" for 3 people and write a wish for the couple.
  async 2({ backend, ui, focus, pause }) {
    if (family(backend).status === 'yes') return;
    focus(GUEST, 'app');
    if (ui) await ui.answerYes(3, WISH);
    else backend.answer(family(backend).token, { status: 'yes', people: 3, wish: WISH });
    await pause(700);
  },
  // 3. The host's counter jumps by 3 and the ring fills; the bot tells both hosts.
  async 3({ ui, focus, pause }) {
    focus(HOST, 'app');
    await ui?.replayRing(3);
    await pause(1400);
  },
  // 4. Another guest (Rustam Nazarov) answers "Kelolmayman": the numbers update again.
  async 4({ backend, focus, pause }) {
    const inv = backend.invite(STORY_DECLINE);
    if (inv.status === 'no') return;
    focus(HOST, 'app');
    backend.answer(inv.token, { status: 'no', note: "Xizmat safarida bo'laman, uzr" });
    await pause(1100);
  },
  // 5. The host approves the Karimovs' wish; it appears on the invitation.
  async 5({ backend, ui, focus, pause }) {
    const k = wishOf(backend);
    if (!k || k.status === 'approved') return;
    focus(HOST, 'app');
    if (ui) await ui.approveWish(k.id);
    else backend.decideWish(HOST, 1, k.id, 'approve');
    await pause(700);
    focus(GUEST, 'app');
    await ui?.scrollGuest('wishes');
    await pause(900);
  },
  // 6. The host reminds everyone who has not answered (each guest at most once in 24 hours).
  async 6({ backend, ui, focus, pause }) {
    if (backend.invites.some((x) => x.reminded_at !== null)) return;
    focus(HOST, 'app');
    if (ui) await ui.remind();
    else backend.remind(HOST, 1);
    await pause(900);
  },
  // 7. The wedding day: the demo clock jumps to 20 minutes before the start.
  async 7({ backend, focus, pause }) {
    if (backend.nowMs() >= backend.wedding.starts_at - 12 * 3_600_000) return;
    backend.jumpTo(backend.wedding.starts_at - 20 * 60_000);
    focus(GUEST, 'app');
    await pause(900);
  },
  // 8. At the door the guest opens the invitation and shows the QR pass.
  async 8({ ui, focus, pause }) {
    focus(GUEST, 'app');
    await ui?.scrollGuest('pass');
    await pause(900);
  },
  // 9. The checker scans it: ✅ "Karimovlar oilasi — 3 kishi".
  async 9({ backend, ui, focus, pause }) {
    if (family(backend).checked_in > 0) return;
    focus(CHECKER, 'app');
    if (ui) await ui.scan('pass');
    else backend.checkin(CHECKER, 1, backend.passFor(family(backend)).token);
    await pause(900);
  },
  // 10. Someone scans the same pass again: ⚠️ already used, with the time it was used.
  async 10({ backend, ui, focus, pause }) {
    focus(CHECKER, 'app');
    if (ui) await ui.scan('pass');
    else backend.checkin(CHECKER, 1, backend.passFor(family(backend)).token);
    await pause(900);
  },
  // 11. A forged pass (a screenshot with "3" changed to "5"): ❌ fake or cancelled.
  async 11({ backend, ui, focus, pause }) {
    const inv = family(backend);
    const token = backend.passFor(inv)?.token ?? backend.passFor({ ...inv, status: 'yes', people: 3 }).token;
    focus(CHECKER, 'app');
    if (ui) await ui.scan(forge(token));
    else backend.checkin(CHECKER, 1, forge(token));
    await pause(900);
  },
};

export async function runStep(n, env, quick = false, done = env.done ?? (env.done = new Set())) {
  for (const k of NEEDS[n] ?? []) if (!done.has(k)) await runStep(k, env, true, done);
  const wait = quick ? async () => {} : env.wait ?? (async () => {});
  const ctx = { ...env, ui: quick ? null : env.ui, focus: quick ? () => {} : env.focus ?? (() => {}), pause: (ms = 650) => wait(ms) };
  await ACTIONS[n](ctx);
  done.add(n);
}
