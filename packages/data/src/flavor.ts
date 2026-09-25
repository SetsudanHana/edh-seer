import type { Collection } from "mongodb";
import { normalizeName } from "./names.js";
import type { CardDoc } from "./docs.js";

import { scryfallSearch, scryfallSearchUrl, type ScryfallSearchOptions } from "./scryfall.js";

export type FetchFn = typeof fetch;

const FLAVOR_SEARCH_URL = scryfallSearchUrl("has:flavorname", { unique: "prints" });

export interface FlavorPair {
  oracleId: string;
  flavorName: string;
}

interface ScryfallSearchCard {
  oracle_id?: string;
  flavor_name?: string;
}

interface ScryfallSearchPage {
  data?: ScryfallSearchCard[];
  has_more?: boolean;
  next_page?: string;
}

export function extractFlavorPairs(page: ScryfallSearchPage): FlavorPair[] {
  return (page.data ?? [])
    .filter(
      (c): c is { oracle_id: string; flavor_name: string } =>
        typeof c.oracle_id === "string" && typeof c.flavor_name === "string",
    )
    .map((c) => ({ oracleId: c.oracle_id, flavorName: c.flavor_name }));
}

export async function fetchFlavorNames(
  fetchImpl: FetchFn = fetch,
  opts: Omit<ScryfallSearchOptions, "fetchImpl"> = {},
): Promise<FlavorPair[]> {
  const pairs: FlavorPair[] = [];
  for await (const data of scryfallSearch<ScryfallSearchCard>(FLAVOR_SEARCH_URL, { ...opts, fetchImpl })) {
    pairs.push(...extractFlavorPairs({ data }));
  }
  return pairs;
}

export interface FlavorCounts {
  applied: number;
  skipped: number;
}

export async function ingestFlavorNames(
  pairs: FlavorPair[],
  cards: Collection<CardDoc>,
): Promise<FlavorCounts> {
  let applied = 0;
  let skipped = 0;
  for (const { oracleId, flavorName } of pairs) {
    // AN EMPTY KEY IS NOT A NAME (roadmap I3). Two corpus cards carried one from this path —
    // Arcane Denial and Force of Negation, whose Secret Lair flavor names clean to nothing — and a
    // decklist line that cleaned to empty resolved to one of them at random. Skipped rather than
    // written, and counted as such so a rising rate would be visible.
    const key = normalizeName(flavorName);
    if (key === "") { skipped++; continue; }
    const res = await cards.updateOne(
      { _id: oracleId },
      { $addToSet: { searchNames: key } },
    );
    if (res.matchedCount === 0) {
      skipped++;
    } else {
      applied++;
    }
  }
  return { applied, skipped };
}
