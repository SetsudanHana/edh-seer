import type { Combo } from "@mtg/engine";

export interface SpellbookVariant {
  id?: string;
  uses?: Array<{ card?: { name?: string } }>;
  produces?: Array<{ feature?: { name?: string } }>;
}

export interface NormalizedCombo {
  id: string;
  combo: Combo;
}

export function normalizeVariant(raw: SpellbookVariant): NormalizedCombo | null {
  if (!raw.id) return null;

  const cards = (raw.uses ?? [])
    .map((u) => u.card?.name)
    .filter((n): n is string => typeof n === "string" && n.length > 0);

  const results = (raw.produces ?? [])
    .map((p) => p.feature?.name)
    .filter((n): n is string => typeof n === "string" && n.length > 0);

  if (cards.length === 0 || results.length === 0) return null;

  return { id: raw.id, combo: { cards, result: results.join(", ") } };
}

export type FetchFn = typeof fetch;

const SPELLBOOK_HEADERS = {
  "User-Agent": "mtg-synergy-engine/0.1",
  Accept: "application/json",
};

export async function fetchVariants(
  fetchImpl: FetchFn = fetch,
): Promise<SpellbookVariant[]> {
  const res = await fetchImpl("https://json.commanderspellbook.com/variants.json", {
    headers: SPELLBOOK_HEADERS,
  });
  const json = (await res.json()) as { variants?: SpellbookVariant[] } | SpellbookVariant[];
  return Array.isArray(json) ? json : json.variants ?? [];
}
