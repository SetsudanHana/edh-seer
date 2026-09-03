import type { GraphNode } from "../types.js";

/** THE SLICE ORDER, FIXED, AND IT IS THE VALIDATED COLOUR ORDER.
 *
 *  Not alphabetical, not by size. `enchantment` and `sorcery` are both blues and sit at dE 12.5 in
 *  normal vision -- below the floor where a full-colour reader can tell a pair apart. They pass the
 *  categorical validator ONLY because this order never places them adjacent. A caller that sorts
 *  these segments by value breaks that guarantee silently, which is why `TypeBar` renders them in
 *  this order and a test pins it. */
export const TYPE_ORDER = [
  "creature", "enchantment", "artifact", "instant", "planeswalker", "sorcery",
] as const;

/** Precedence for a card that prints several types. An artifact creature is a CREATURE: that is
 *  what it is on the board and what a player names it by. Lands are absent on purpose -- see
 *  `primaryType`. */
const PRECEDENCE = ["creature", "planeswalker", "artifact", "enchantment", "instant", "sorcery"] as const;

export interface TypeSlice { type: string; count: number }

/** The one type a card counts as, or null when it is not on this chart.
 *
 *  A STACKED BAR ASSERTS PART-TO-WHOLE, so every card must land in exactly one segment. (The noun
 *  changed and the argument did not, 2026-09-01: the ring this rule was written for became a
 *  stacked bar, which makes the same claim on a shared baseline.) The graph counts a
 *  card in BOTH its types and says so in its legend; summing that gives 125 for a 100-card deck,
 *  which is a chart a reader catches by counting. Hence a precedence rather than a fan-out.
 *
 *  LANDS ARE NOT A SLICE. They are ~38% of a Commander deck and would drown the composition
 *  question this chart exists to answer; they have their own panel; and the owner already ruled
 *  that deck statistics run over nonlands only. */
export function primaryType(types: readonly string[]): string | null {
  if (types.some((t) => t.toLowerCase() === "land")) return null;
  const lower = types.map((t) => t.toLowerCase());
  const hit = PRECEDENCE.find((p) => lower.includes(p));
  return hit ?? null;
}

/** Card types as part-to-whole slices over the deck's NONLAND cards.
 *
 *  Three counting rules, each of which has been a real defect in this repo:
 *  - COPIES, not nodes: 24 basic Mountains are one node carrying `copies: 24`.
 *  - Tokens are excluded: a token node is a permanent the deck MAKES, not a card it holds.
 *  - A multi-face card is TWO nodes. `face` is absent on a front face and on a single-face card,
 *    so `face === undefined` takes each physical card exactly once. `card-drawer.tsx` selects the
 *    front face by the same test. */
/** The cards whose OTHER printed face is a land, by name.
 *
 *  A MODAL DFC IS A LAND, ON THIS CENSUS TOO (roadmap T3, applying the 2026-08-31 ruling). The
 *  census used to read the front face, where the same card is a spell, so it printed 34 lands on
 *  the report's first screen while every other surface -- `deckMath.lands.actual`,
 *  `report.landCount`, the build row, the opening-hand chart -- printed 38. Four phone-judge runs
 *  failed the question "how many lands does this deck have", and the fourth named the moment it
 *  would put the tool down: *"shot 5, the second I read `38 in deck (4 MDFC)` after the front page
 *  had told me `34 lands`. At that point I don't trust the count."* Two bridging parentheticals
 *  had already been tried and neither survived a run.
 *
 *  THE RULING ALREADY DECIDED THIS. The measurement behind it (55 of 71 calibration decks, three
 *  conventions) put an MDFC on the land side AND took its mana value out of the spell pool --
 *  `docs/engineering-log/2026-08-31.md`, "the other half of the double count". A census that keeps
 *  it as a spell is the last reader disagreeing with that.
 *
 *  READ OFF THE BACK-FACE NODE'S OWN `types`, not a regex over a printed type line: a multi-face
 *  card is one node per face and the back carries `face: 1` plus its real types, which is the same
 *  field `primaryType` reads. A Pathway is land // land and lands in here too -- harmless, its
 *  front is already a land, and a Set cannot count it twice. */
export function landBackCards(nodes: readonly GraphNode[]): ReadonlySet<string> {
  const names = new Set<string>();
  for (const n of nodes) {
    if (n.face === undefined) continue;
    if (!n.types.some((t) => t.toLowerCase() === "land")) continue;
    if (n.cardName !== undefined) names.add(n.cardName);
  }
  return names;
}

/** Land cards, on the EXACT same basis `typeSlices` uses for nonlands: skip `n.isToken`, skip
 *  `n.face !== undefined`, sum `copies`. Deriving both figures from the identical traversal is what
 *  makes "nonland + land == the deck" true by construction rather than by luck.
 *
 *  A card with a land back counts HERE and not as a slice, per `landBackCards` -- so this figure
 *  now agrees with `report.landCount` and `deckMath.lands.actual` instead of trailing them by
 *  `deckMath.lands.mdfc`. Still computed from the nodes rather than read off the report, because
 *  the invariant that matters is that the two halves of one census come from ONE traversal:
 *  `docs/engineering-log/2026-08-31.md` is the record of what happens when figures from two
 *  different traversals are summed as if they were one number. */
export function landCount(nodes: readonly GraphNode[]): number {
  const landBacks = landBackCards(nodes);
  let count = 0;
  for (const n of nodes) {
    if (n.isToken) continue;
    if (n.face !== undefined) continue;
    if (!isLand(n, landBacks)) continue;
    count += n.copies ?? 1;
  }
  return count;
}

function isLand(n: GraphNode, landBacks: ReadonlySet<string>): boolean {
  if (n.types.some((t) => t.toLowerCase() === "land")) return true;
  return n.cardName !== undefined && landBacks.has(n.cardName);
}

export function typeSlices(nodes: readonly GraphNode[]): TypeSlice[] {
  const landBacks = landBackCards(nodes);
  const counts = new Map<string, number>();
  for (const n of nodes) {
    if (n.isToken) continue;
    if (n.face !== undefined) continue;
    if (isLand(n, landBacks)) continue;
    const type = primaryType(n.types);
    if (type === null) continue;
    counts.set(type, (counts.get(type) ?? 0) + (n.copies ?? 1));
  }
  return TYPE_ORDER.flatMap((type) => {
    const count = counts.get(type);
    return count ? [{ type, count }] : [];
  });
}
