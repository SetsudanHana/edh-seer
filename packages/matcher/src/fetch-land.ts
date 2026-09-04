/** A CARD THAT PUTS A LAND ONTO THE BATTLEFIELD FROM THE LIBRARY, and what colours that reaches.
 *
 *  Split out of `goldfish.ts` (2026-09-04) because two models read the same cards and only one of
 *  them knew about fetches: the simulator counted Polluted Delta as a blue source and `mana-audit`
 *  did not, so a MONO-BLUE deck with six fetchlands was told *"Blue is short at the top of your
 *  curve"*. `producedMana` is empty on a fetchland and correctly so -- the land itself taps for
 *  nothing. The colour arrives with what it FINDS, which is a fact about the deck and not about the
 *  card, so it takes both to answer.
 *
 *  Imported by `goldfish.ts` and `mana-audit.ts`, which cannot import each other. The predicates are
 *  the ones goldfish shipped, moved unchanged. */

/** A spell or land that searches out a land -- the same two cues `rules.json`'s `ramp.landFetchSpell`
 *  already pairs, kept here rather than routed through the rule engine because callers need the
 *  TAPPED half too and a rule row carries no payload.
 *
 *  THE GATE IS THE SAME FOR A LAND AND A SPELL ALIKE (roadmap N2, 2026-08-26). It used to demand the
 *  literal words "land card" on the land side, and the fetch cycle does not print them -- Scalding
 *  Tarn says "an Island or Mountain CARD" -- so all ten real fetchlands fell through, 110 of the 162
 *  slots this reaches. One predicate, because the two sides ask the same question, and the land side
 *  needs `ONTO_BATTLEFIELD` with it: a search that puts the land in HAND is not a land drop. */
const LAND_FETCH = /search your library for (?:a |an |up to \w+ )?(?:basic )?(?:land|forest|island|swamp|mountain|plains)/i;
const ONTO_BATTLEFIELD = /onto the battlefield/i;

/** A FETCH IS NOT FREE JUST BECAUSE A MODEL PERFORMS IT (roadmap N12). Myriad Landscape's two basics
 *  cost `{2}`, Urza's Cave `{3}`, and **Wayfarer's Bauble is cast for {1} and then cracked for {2} a
 *  turn later** -- none of which these models pay, so each was a free land the moment it appeared.
 *  The activation cost is what sits before the colon on the fetch's own line; `{T}` and a sacrifice
 *  and a life payment are all costs a model CAN pay, and a mana symbol is not.
 *
 *  A LAND THAT FAILS THIS IS STILL A LAND -- Myriad Landscape taps for `{C}` and enters tapped -- it
 *  simply neither fixes colours nor thins until someone pays. That is the under-claiming direction,
 *  and it is 63 land slots plus 25 spell slots across the 71 decks. */
const MANA_IN_COST = /\{(?!t\}|q\})[^{}]+\}/i;
function fetchCostsMana(text: string): boolean {
  const line = text.split("\n").find((l) => LAND_FETCH.test(l)) ?? "";
  return line.includes(":") && MANA_IN_COST.test(line.slice(0, line.indexOf(":")));
}

/** Does this card find a land, at a cost these models can pay? */
export const isLandFetch = (oracleText: string): boolean =>
  LAND_FETCH.test(oracleText) && ONTO_BATTLEFIELD.test(oracleText) && !fetchCostsMana(oracleText);

/** The fetched land's own tapped state, printed on the fetch: "put it onto the battlefield TAPPED".
 *  Fabled Passage -- 21 slots, and the only card of the family that prints the clause -- then untaps
 *  it once you control four lands, which is the `slow` shape one board count over. */
export const FETCH_UNTAPS = /untap that land/i;
export const FETCHES_TAPPED = /onto the battlefield tapped/i;

/** The board Fabled Passage's "if you control four or more lands" reads, counted BEFORE the drop the
 *  fetch itself makes -- hence three. Exported so the simulator's slot flag and the audit's turn-N
 *  board cannot drift apart on the one number they share. */
export const FETCH_UNTAP_LANDS = 3;

/** Is the land this fetch finds still tapped when it arrives, with `otherLands` already down?
 *
 *  ASKED OF THE FETCH, NOT OF THE FETCHLAND. `classifyLand` reads the card in front of it and
 *  correctly calls Evolving Wilds untapped: the Wilds enters untapped and the BASIC it finds is the
 *  one that arrives tapped. Nothing a land classifier can see says so, which is why it lives here.
 *
 *  `mana-audit` asks it of a turn-N board; the simulator asks the same question of its own slot
 *  flags against `FETCH_UNTAP_LANDS`. */
export const fetchedLandEntersTapped = (oracleText: string, otherLands: number): boolean =>
  FETCHES_TAPPED.test(oracleText) && !(FETCH_UNTAPS.test(oracleText) && otherLands >= FETCH_UNTAP_LANDS);

/** The lands in THIS deck a fetch can actually find. Hand it the LIBRARY: a commander is not in it
 *  (CR 903.6) and cannot be fetched. */
const BASIC_TYPES = ["plains", "island", "swamp", "mountain", "forest"] as const;
export function fetchableLands<T extends { typeLine: string }>(
  oracleText: string,
  deck: readonly T[],
): T[] {
  const text = oracleText.toLowerCase();
  const named = BASIC_TYPES.filter((t) => text.includes(t));
  // NAMING A TYPE IS NOT DEMANDING A BASIC, and the two are independent (owner, 2026-08-25).
  // Scalding Tarn searches for "an Island or Mountain CARD", so it finds Steam Vents -- a
  // `Land - Island Mountain` -- and every other dual carrying one of those types, 20 lands in
  // `iz-it-izzet` rather than the 19 basics. Seething Landscape says "a BASIC Island, Swamp, or
  // Mountain card" and finds only basics. The word is read on its own, not as a fallback for a
  // fetch that names nothing. `nonbasic` needs no stripping -- `\b` does not match inside it, which
  // the test asserts rather than assumes, because it is exactly the kind of thing that stops being
  // true when someone "simplifies" the pattern.
  const wantsBasic = /\bbasic\b/.test(text);
  return deck.filter((c) => {
    const line = c.typeLine.toLowerCase();
    if (!line.includes("land")) return false;
    if (named.length > 0 && !named.some((t) => line.includes(t))) return false;
    if (wantsBasic && !line.includes("basic")) return false;
    return true;
  });
}
