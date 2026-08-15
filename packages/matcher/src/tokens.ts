import type { Card } from "@mtg/engine";

/** A token a card can make, identified the way the `tokens` collection is indexed. */
export interface TokenRef { name: string; typeLine: string }

/** The tokens this card creates, from `allParts`, which `scryfall.ts` already parses and which
 *  resolves 413 of the 424 clause-corpus creators (97.4%).
 *
 *  KEYED ON (name, typeLine), NOT NAME. Three different Wizard tokens exist with three different
 *  abilities, and the card's own part entry is what says which one — the reason identity comes from
 *  the collection while the CARD chooses the row.
 *
 *  `meld_part` and `combo_piece` point at real cards and are excluded: putting one on the graph
 *  would duplicate a card as a phantom token. */
export function createdTokenRefs(card: Card): TokenRef[] {
  const parts = (card as unknown as { allParts?: { component?: string; name?: string; typeLine?: string }[] }).allParts;
  if (!parts) return [];
  const out = new Map<string, TokenRef>();
  for (const p of parts) {
    if (p.component !== "token" || !p.name || !p.typeLine) continue;
    out.set(`${p.name}|${p.typeLine}`, { name: p.name, typeLine: p.typeLine });
  }
  return [...out.values()];
}
