import type { BuildCategory } from "./build.js";

/** THE FOUR ROLE PARENTS' IDENTITY -- name, key, leaves -- defined once (#1168). `BUILD_PARENTS`
 *  adds the numbers (target, weight, cost band) to these; the job sentence on a card page and the
 *  map legend read the names and leaves from here. A SEPARATE FILE because the Cloudflare card-page
 *  Function takes `partner-shard.ts` and must not drag in `build.ts` and its rule tables (1 MB
 *  bundle limit). Select a parent by `key`, never by `name`. */
export interface RoleParentIdentity {
  name: string;
  key: "consistency" | "ramp" | "interaction" | "boardWipes";
  leaves: readonly BuildCategory[];
}

export const ROLE_PARENTS: readonly RoleParentIdentity[] = [
  { name: "Card advantage", key: "consistency", leaves: ["draw", "cardSelection", "impulseDraw", "tutor"] },
  { name: "Ramp", key: "ramp", leaves: ["ramp"] },
  { name: "Interaction", key: "interaction", leaves: ["targetedRemoval", "stackInteraction", "graveyardHate", "protection"] },
  { name: "Board wipes", key: "boardWipes", leaves: ["boardWipe"] },
];

/** The parent whose leaves hold a build role, or undefined for burn, stax and lands. */
export const parentOfRole = (role: string): RoleParentIdentity | undefined =>
  ROLE_PARENTS.find((p) => (p.leaves as readonly string[]).includes(role));
