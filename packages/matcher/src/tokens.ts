import type { Card } from "@mtg/engine";

/** A token a card can make, identified the way the `tokens` collection is indexed.
 *
 *  `printingId` is the EXACT join (against `TokenDoc.printingIds`) — (name, typeLine) alone is
 *  ambiguous: four "Wizard" / "Token Creature — Wizard" rows differ only in oracle text, and Kuja,
 *  Genome Sorcerer's Wizard part is one of them. Optional because a card ingested before
 *  `scryfall.ts` started carrying it has none. */
export interface TokenRef { name: string; typeLine: string; printingId?: string }

/** The tokens this card creates, from `allParts`, which `scryfall.ts` already parses and which
 *  resolves 413 of the 424 clause-corpus creators (97.4%).
 *
 *  DEDUPE KEY STAYS (name, typeLine), NOT printingId. A card listing the same token twice (rare, but
 *  Scryfall does not guarantee uniqueness) must still yield one ref, and the printingId is carried
 *  along for whichever occurrence is kept — it does not change which rows collapse.
 *
 *  `meld_part` and `combo_piece` point at real cards and are excluded: putting one on the graph
 *  would duplicate a card as a phantom token. */
export function createdTokenRefs(card: Card): TokenRef[] {
  const parts = (card as unknown as { allParts?: { component?: string; name?: string; typeLine?: string; printingId?: string }[] }).allParts;
  if (!parts) return [];
  const out = new Map<string, TokenRef>();
  for (const p of parts) {
    if (p.component !== "token" || !p.name || !p.typeLine) continue;
    out.set(`${p.name}|${p.typeLine}`, {
      name: p.name,
      typeLine: p.typeLine,
      ...(p.printingId !== undefined ? { printingId: p.printingId } : {}),
    });
  }
  return [...out.values()];
}
