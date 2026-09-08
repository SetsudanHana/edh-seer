import type { Card } from "@edh-seer/engine";
import { isEmblemPart } from "@edh-seer/tagger/emblem";

/** A token a card can make, identified the way the `tokens` collection is indexed.
 *
 *  `printingId` is the EXACT join (against `TokenDoc.printingIds`) — (name, typeLine) alone is
 *  ambiguous: four "Wizard" / "Token Creature — Wizard" rows differ only in oracle text, and Kuja,
 *  Genome Sorcerer's Wizard part is one of them. Optional because a card ingested before
 *  `scryfall.ts` started carrying it has none. */
export interface TokenRef {
  name: string;
  typeLine: string;
  printingId?: string;
  /** An EMBLEM part (spec 2026-09-08): Scryfall's `combo_piece` with an "Emblem — …" type line,
   *  which has its own row in `tokens` under layout `emblem`. Never mediates (`isMediatingTokenRef`
   *  stays false: an emblem replaces no direct edge), and the node built from it carries
   *  `characteristics.emblem`, never `token`. */
  emblem?: true;
}

/** The tokens this card creates, from `allParts`, which `scryfall.ts` already parses and which
 *  resolves 413 of the 424 clause-corpus creators (97.4%).
 *
 *  DEDUPE KEY STAYS (name, typeLine), NOT printingId. A card listing the same token twice (rare, but
 *  Scryfall does not guarantee uniqueness) must still yield one ref, and the printingId is carried
 *  along for whichever occurrence is kept — it does not change which rows collapse.
 *
 *  `meld_part` and a `combo_piece` pointing at a real card are excluded: putting one on the graph
 *  would duplicate a card as a phantom token. The one `combo_piece` that is NOT a card, an emblem,
 *  is kept and flagged. */
export function createdTokenRefs(card: Card): TokenRef[] {
  const parts = (card as unknown as { allParts?: { component?: string; name?: string; typeLine?: string; printingId?: string }[] }).allParts;
  if (!parts) return [];
  const out = new Map<string, TokenRef>();
  for (const p of parts) {
    const emblem = isEmblemPart(p);
    if ((p.component !== "token" && !emblem) || !p.name || !p.typeLine) continue;
    out.set(`${p.name}|${p.typeLine}`, {
      name: p.name,
      typeLine: p.typeLine,
      ...(p.printingId !== undefined ? { printingId: p.printingId } : {}),
      ...(emblem ? { emblem: true as const } : {}),
    });
  }
  return [...out.values()];
}

/** Card types a token must name for a NODE built from it to satisfy anything. A token row whose
 *  type line names none of them is a PLACEHOLDER, not a permanent: Scryfall's "Copy" row is type
 *  line `Token` and its own oracle text says "(This token can be used to represent a token that's a
 *  copy of a permanent.)". 163 of the 995 ingested token rows are typeless this way, and 349 corpus
 *  cards reference one. */
const TOKEN_CARD_TYPES = /\b(Creature|Artifact|Enchantment|Land|Planeswalker|Battle)\b/i;

/** Can a node built from this ref carry a claim at all? A typeless placeholder cannot: it satisfies
 *  no typed subject, and `impliedEvents` gives it no `enters` either, because its type line names no
 *  permanent type. */
function isMediatingTokenRef(ref: TokenRef): boolean {
  return TOKEN_CARD_TYPES.test(ref.typeLine);
}

/** Does this card make at least one token a node can be built from?
 *
 *  THE SUPPRESSION RULE NEEDS THIS, and a live deck is what showed why. Token mediation deletes a
 *  maker's direct "a token enters" edge on the ground that the token NODE re-supplies it one hop
 *  later. Second Harvest ("For each token you control, create a token that's a copy of that
 *  permanent") lists exactly one token part -- the placeholder "Copy" -- so the direct edge was
 *  deleted and the hop it was traded for lands on a node that satisfies nothing. In
 *  `naya-spellslinger` that left a token doubler rated 0.3 with ONE partner, invisible to
 *  Caretaker's Talent's "whenever one or more tokens you control enter", which has 29 partners of
 *  its own. A trade is only sound when something is received. */
export function hasMediatingToken(card: Card): boolean {
  return createdTokenRefs(card).some(isMediatingTokenRef);
}
