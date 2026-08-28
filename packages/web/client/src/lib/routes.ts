import type { CardGraph } from "../types.js";

type Edge = CardGraph["edges"][number];

/** HOW A CARD IS REACHED THROUGH ANOTHER ONE — the two-hop route, named at every step.
 *
 *  **THE CASE THIS EXISTS FOR, in the owner's own words (2026-08-27):** Ghyrson Starn does not
 *  synergise with token creation. Add Impact Tremors and it does — because Impact Tremors triggers
 *  on `enters:creature` and emits `non-combat-damage`, and Ghyrson triggers on damage. So a token
 *  maker reaches Ghyrson through Impact Tremors, and the deck gains a route it did not have.
 *
 *  **THE ENGINE ALREADY KNEW THIS AND THE PRODUCT NEVER SAID IT.** Both edges are formed, and
 *  `computeFlow` already walks both hops onto the board. What was missing is the SEMANTICS: the
 *  flow drew geometry with no statement of what each hop was, and the inspector listed one hop in
 *  each direction and stopped. A player could see that three cards were connected and not why.
 *
 *  **A ROUTE IS HETEROGENEOUS IN EVENT TYPE, WHICH IS THE WHOLE POINT AND THE REASON A FILTER
 *  CANNOT SHOW ONE.** The first attempt at this complaint shipped an event filter: name one verb,
 *  dim the rest. That is useful for "show me the death chain" and it is exactly wrong here — tracing
 *  `enters` hides the damage hop, tracing damage hides the token hop, and the route disappears
 *  either way. What a route needs is not fewer mechanisms but NAMED ones.
 *
 *  **EXACTLY TWO HOPS.** A one-hop connection is a direct edge and the inspector already lists it;
 *  beyond two the claim stops being checkable by a reader and starts being a graph search. Two is
 *  the shortest path that is not already on screen, which is precisely the news.
 *
 *  **GROUPED BY THE MIDDLE CARD, because the middle card IS the finding.** "Twelve cards reach this
 *  through Impact Tremors" is the sentence a deckbuilder acts on — it says what to keep, and by
 *  implication what adding it bought.
 */

/** Middles listed before the rest become a count, and sources named within one. Both are the same
 *  reason the legality report caps its lists at eight: a list long enough to scroll is not read. */
export const ROUTE_MIDDLE_CAP = 4;
export const ROUTE_SOURCE_CAP = 6;

export interface Route {
  /** The card in the middle — the one that makes the route exist. */
  through: string;
  /** Direction relative to the root: `in` means `source -> through -> root`. */
  dir: "in" | "out";
  /** The far ends, nearest-first by edge weight, capped. */
  ends: string[];
  /** How many far ends there are in total, capped or not. */
  total: number;
  /** The tag on the far hop (`source -> through`) and on the near hop (`through -> root`). */
  farTag?: string;
  nearTag?: string;
}

/** Two-hop routes into and out of `rootId`, grouped by the card in the middle.
 *
 *  A far end that ALREADY connects directly to the root is dropped: the inspector lists that edge a
 *  few lines above, and repeating it as a "route" would present the same relationship twice and
 *  make the genuinely new one harder to find. */
export function routesThrough(edges: readonly Edge[], rootId: string): Route[] {
  const real = edges.filter((e) => e.from !== e.to);
  const direct = new Set<string>();
  for (const e of real) {
    if (e.from === rootId) direct.add(e.to);
    if (e.to === rootId) direct.add(e.from);
  }

  const out: Route[] = [];
  for (const dir of ["in", "out"] as const) {
    // `in`:  source -> middle -> root.   `out`: root -> middle -> far.
    const nearHops = real.filter((e) => (dir === "in" ? e.to === rootId : e.from === rootId));
    for (const near of nearHops) {
      const middle = dir === "in" ? near.from : near.to;
      const farHops = real
        .filter((e) => (dir === "in" ? e.to === middle : e.from === middle))
        .map((e) => ({ end: dir === "in" ? e.from : e.to, weight: e.weight, tag: e.tags[0] }))
        // The root is not its own route, and a far end already directly connected is not news.
        .filter((h) => h.end !== rootId && h.end !== middle && !direct.has(h.end))
        .sort((a, b) => b.weight - a.weight);
      if (farHops.length === 0) continue;
      out.push({
        through: middle,
        dir,
        ends: farHops.slice(0, ROUTE_SOURCE_CAP).map((h) => h.end),
        total: farHops.length,
        ...(farHops[0]?.tag !== undefined ? { farTag: farHops[0].tag } : {}),
        ...(near.tags[0] !== undefined ? { nearTag: near.tags[0] } : {}),
      });
    }
  }
  // The middle that opens the most routes first: that is the card whose presence is doing the most
  // work, and the one a reader most needs named.
  out.sort((a, b) => b.total - a.total || a.through.localeCompare(b.through));
  return out.slice(0, ROUTE_MIDDLE_CAP);
}
