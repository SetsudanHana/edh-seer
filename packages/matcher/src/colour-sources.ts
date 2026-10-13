/** THE CARDS THAT ARE A SOURCE OF EACH COLOUR IN ONE DECK -- the single count the colour audit's `supplied` and the mana base's
 *  `colourSources` both read (#1169, task 2a). They used to count two different things (Gisa's black: 38 and 33; Fairdrazi's
 *  colours 16-17 and 9-10) and `MANA_BASE_COST.colourMiss` was fitted on one of them.
 *
 *  A card is a source of a colour when it is DIRECT (its own tap or static line makes the colour, `colourSourceColours`) or it is a
 *  FETCH that can find a land of the colour in this deck (`isFetchSource`, from the derived `landFetch`). Whether a fetch can
 *  find one is a fact about the deck and not the card, so it takes both; `fetchableLands` answers it.
 *
 *  A GATED LINE COUNTS where the deck meets its gate (owner 2026-10-13: one answer for the audit and castability), judged against `deck` -- the whole decklist, commanders in it
 *  (`gate.ts`) -- which is the library when the caller names none, and then nothing gated counts.
 *
 *  Leaf module: imports the fetch predicates and the line reader, not the audit. */
import type { Card } from "@edh-seer/engine";
import { fetchableLands } from "./fetch-land.js";
import { colourSourceColours, isFetchSource, WUBRG, type DeckIdentity } from "./mana-lines.js";
import type { DeckCard } from "./types.js";

/** THE FETCHES THAT COUNT AS A SOURCE FOR ONE REQUIREMENT, capped at what there is to find. Every fetch is a wildcard for its own
 *  fetchable set, but the sets overlap and the library is finite: `codie` runs 15 fetches over 5 white-producing lands, so
 *  calling all 15 white sources claims ten cards that can never produce white. Measured over the 71 calibration decks the cap
 *  binds on 31 of 153 colour rows across 8 decks -- a cap and not a comment. The CHEAPEST fetches survive it: a fetch that is a
 *  land beats one that costs {2}, which is the same order `availableBy` prices. Asked of the LIBRARY: a commander is not in it
 *  (CR 903.6) and cannot be fetched.
 *
 *  `finds` says which lands satisfy the requirement (a colour, or a basic land type); `direct` are the cards that satisfy it themselves. */
// CEILING: a fetch is credited for every colour of a land it COULD find in this deck, capped at how many such lands there are; it ignores that
// the lands may already be on the battlefield or drawn, and a costed permanent fetch (Myriad Landscape) is not credited at all.
export function withFetches(library: readonly DeckCard[], direct: readonly DeckCard[], finds: (land: Card) => boolean): DeckCard[] {
  const cards = library.map((dc) => dc.card);
  const fetches = library.filter((dc) => !direct.includes(dc) && isFetchSource(dc)
    && fetchableLands(dc.card.oracleText ?? "", cards).some(finds));
  const reachable = new Set(fetches.flatMap((f) => fetchableLands(f.card.oracleText ?? "", cards)));
  const targets = [...reachable].filter(finds).length;
  return [...direct, ...[...fetches].sort((a, b) => a.card.manaValue - b.card.manaValue).slice(0, targets)];
}

/** The colours a library card makes by itself, keyed by the card, so a fetch's targets (plain `Card`s) can be asked what they make. */
export function ownColoursByCard(library: readonly DeckCard[], identity: DeckIdentity, deck?: readonly DeckCard[]): Map<Card, ReadonlySet<string>> {
  return new Map(library.map((dc) => [dc.card, new Set(colourSourceColours(dc, identity, "five", deck))]));
}

/** Every colour in `WUBRG`, and the cards that are a source of it. */
export function colourSourceCards(library: readonly DeckCard[], identity: DeckIdentity, deck?: readonly DeckCard[]): Map<string, DeckCard[]> {
  const own = ownColoursByCard(library, identity, deck);
  return new Map(WUBRG.map((colour) => [
    colour,
    withFetches(library, library.filter((dc) => own.get(dc.card)!.has(colour)), (land) => own.get(land)?.has(colour) ?? false),
  ]));
}

/** THE COLOURS A FETCH CAN REACH IN THIS DECK: the colours of the lands it can find. */
export function fetchedColours(oracleText: string, library: readonly DeckCard[], identity: DeckIdentity, deck?: readonly DeckCard[]): Set<string> {
  const own = ownColoursByCard(library, identity, deck);
  return new Set(fetchableLands(oracleText, library.map((dc) => dc.card)).flatMap((c) => [...(own.get(c) ?? [])]));
}
