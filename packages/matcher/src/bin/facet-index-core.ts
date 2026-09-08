import { archetypesOf } from "../archetypes.js";
import { cardSignalOf } from "../card-signal.js";
import type { DeckCard } from "../types.js";
import { identityKeyOf, type NameIndexEntry } from "./partners-core.js";

/** THE FACET INDEX (spec 2026-09-08 part 4): one compact row per card the site has a page for, so
 *  the Cards and Commanders pages can answer "draws cards, +1/+1 counters, green" without a server.
 *  Keys are one letter because the file is fetched by the browser: 16,715 rows.
 *
 *  `t` and `d` come from the SAME signal builder and signature matcher the deck report's detector
 *  uses, so a card the search calls "+1/+1 Counters" is one the report would count toward that
 *  archetype. Computed here, never in the browser: the signal needs the derived tags, which the
 *  page does not ship. */
export interface FacetRow {
  /** slug */
  s: string;
  /** colour identity, WUBRG order, "" for colourless */
  i: string;
  /** can lead a deck */
  c: 0 | 1;
  /** effect kinds, sorted, unique */
  e: string[];
  /** archetypes the card's signals satisfy (supply side) */
  t: string[];
  /** the subset it also satisfies on the demand side */
  d: string[];
}

export function buildFacetIndex(all: DeckCard[], index: NameIndexEntry[]): FacetRow[] {
  const byName = new Map(all.map((d) => [d.card.name, d]));
  return index.map((entry) => {
    const d = byName.get(entry.name);
    const key = identityKeyOf(entry.identity);
    const base = { s: entry.slug, i: key === "C" ? "" : key, c: entry.commander ? (1 as const) : (0 as const) };
    if (!d?.tags) return { ...base, e: [], t: [], d: [] };
    const signal = cardSignalOf(d.card, d.tags);
    const { supplies, demands } = archetypesOf(signal);
    return { ...base, e: [...new Set(signal.effectKinds)].sort(), t: supplies, d: demands };
  });
}
