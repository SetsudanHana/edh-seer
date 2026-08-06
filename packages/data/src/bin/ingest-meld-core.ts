/** The meld relation, from Scryfall's `all_parts`.
 *
 *  Meld is the clearest case of a relation the engine cannot currently express: Mishra, Claimed by
 *  Gix names "a creature named Phyrexian Dragon Engine" outright, and the engine matches producer
 *  EVENTS to consumer TRIGGERS, so a card-name-to-card-name relation has no shape. The recall
 *  measurement filed that pair as `miss-inexpressible`; Commander Salt models it as a `named`
 *  qualifier and MTGJSON as `cardParts`, so it is a GAP, not a ceiling.
 *
 *  There are 21 meld cards in the corpus, so this is small and bounded. Names are the join here
 *  rather than oracle ids, because `all_parts` carries printing ids: acceptable at this size, and
 *  the caller verifies every name resolves.
 *
 *  Pure, so the shaping is testable without the network.
 */

export interface ScryfallPart {
  component: string;
  name: string;
}
export interface ScryfallMeldCard {
  name: string;
  layout?: string;
  all_parts?: ScryfallPart[];
}

export interface MeldFields {
  /** The other PART this card melds with. The synergy relation proper: both must be on the
   *  battlefield, so each is a payoff for drawing the other. */
  meldPartner?: string;
  /** What they become. Present on the parts, absent on the result. */
  meldResult?: string;
  /** The parts, present on the RESULT card so the relation is navigable from either end. */
  meldParts?: string[];
}

/** cardName -> meld fields, for every card named in any `all_parts` block.
 *
 *  A part gets its partner and the result; the result gets its parts. A meld set is always exactly
 *  two parts and one result, but a card naming more than two parts is passed through rather than
 *  assumed away — silently dropping the third would be a wrong answer, not a missing one. */
export function buildMeld(cards: readonly ScryfallMeldCard[]): Map<string, MeldFields> {
  const out = new Map<string, MeldFields>();
  for (const card of cards) {
    const parts = (card.all_parts ?? []).filter((p) => p.component === "meld_part").map((p) => p.name);
    const result = (card.all_parts ?? []).find((p) => p.component === "meld_result")?.name;
    if (parts.length === 0 || result === undefined) continue;

    for (const name of parts) {
      const partner = parts.filter((p) => p !== name);
      const prior = out.get(name) ?? {};
      out.set(name, {
        ...prior,
        ...(partner.length === 1 ? { meldPartner: partner[0] } : {}),
        meldResult: result,
      });
    }
    out.set(result, { ...(out.get(result) ?? {}), meldParts: [...parts].sort() });
  }
  return out;
}
