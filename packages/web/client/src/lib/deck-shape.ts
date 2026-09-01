import type { DeckReport, GraphNode } from "../types.js";

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
export interface RoleBar { role: string; count: number }

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
export function typeSlices(nodes: readonly GraphNode[]): TypeSlice[] {
  const counts = new Map<string, number>();
  for (const n of nodes) {
    if (n.isToken) continue;
    if (n.face !== undefined) continue;
    const type = primaryType(n.types);
    if (type === null) continue;
    counts.set(type, (counts.get(type) ?? 0) + (n.copies ?? 1));
  }
  return TYPE_ORDER.flatMap((type) => {
    const count = counts.get(type);
    return count ? [{ type, count }] : [];
  });
}

/** The deck's four Command-Zone role groups, as counts.
 *
 *  NO TARGETS. Recognition says what the deck IS; whether that is enough is the diagnosis, and it
 *  is already stated as sentences by `Findings`. Printing "17/10" here would put the judgement
 *  back into the step whose whole job is showing the reader we understood their deck. */
export function roleBars(parents: DeckReport["buildParents"] | undefined): RoleBar[] {
  return (parents ?? []).map((p) => ({ role: p.name, count: p.count }));
}
