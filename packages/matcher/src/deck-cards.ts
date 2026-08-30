import { normalizeName } from "@edh-seer/data/names";
import type { CardLookup } from "@edh-seer/data/resolve";
import type { Card } from "@edh-seer/engine";
import type { CardTags } from "@edh-seer/tagger";
import type { DeckCard } from "./types.js";

export interface CardTagsLookup {
  findOne(oracleId: string): Promise<CardTags | null>;
}

/** Pairs already-resolved cards with their structured tags. Re-looks each card up by name to
 *  recover its oracleId (CardDoc._id) — resolveNames only returns the flat Card shape, which
 *  has no oracleId of its own. tags is null when the card was never tagged. */
export async function buildDeckCards(
  cards: Card[],
  lookup: CardLookup,
  tagsLookup: CardTagsLookup,
): Promise<DeckCard[]> {
  const out: DeckCard[] = [];
  for (const card of cards) {
    const doc = await lookup.findByName(normalizeName(card.name));
    const tags = doc ? await tagsLookup.findOne(doc._id) : null;
    out.push({ card, tags });
  }
  return out;
}
