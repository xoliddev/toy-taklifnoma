// The people of the demo. The wedding itself (80 invites, 25 days ahead) comes from the shared seed generator and is
// always relative to "now", so the demo works on any date and at any hour (also across New Year).
import { CHECKER, GUEST, GUEST2, HOST_KELIN, HOST_KUYOV, STORY_DECLINE, STORY_FAMILY } from '../shared/seedgen.js';
import { DemoBackend } from './backend.js';

export { CHECKER, GUEST, GUEST2, HOST_KELIN, HOST_KUYOV, STORY_DECLINE, STORY_FAMILY };
export const HOST = HOST_KUYOV; // Akmal aka, the groom's side
export const WISH = "Sardor va Madina, baxtingiz bardavom bo'lsin! Oilangiz mehrga to'la, dasturxoningiz doim to'kin bo'lsin.";

export function createDemo({ now, names, lang = 'uz' }) {
  const b = new DemoBackend({ now, names });
  for (const u of Object.values(b.users)) u.lang = lang;
  return b;
}

/** The same pass with "3 kishi" changed to "5 kishi": the signature no longer matches. */
export const forge = (token) => token.replace(/^(TT1\.\d+\.\d+\.)(\d+)\./, (_, head) => `${head}5.`);
