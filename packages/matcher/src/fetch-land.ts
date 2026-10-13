import { BASIC_LAND_TYPES } from "./typeline.js";
import type { DeckCard } from "./types.js";
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

// WHETHER A CARD FINDS A LAND AT A COST A MODEL CAN PAY is `isFetchSource` (mana-lines.ts), read off the derived `landFetch` and its fetch line (#1169 task
// 2b-2; `isLandFetch` was a regex over the oracle text and agreed with it on every land card of the derived corpus: 0 differences over 32,065 derived cards, measured 2026-10-13). A fetch is not free
// just because a model performs it (roadmap N12): Myriad Landscape's two basics cost {2}, Wayfarer's Bauble is cast for {1} and cracked for {2} a turn later,
// and `isFetchSource` holds a permanent's activation to the cost rule any costed line is held to.

/** The fetched land's own untap clause: Fabled Passage -- 21 slots, and the only LAND of the family that prints it -- untaps the land once you control
 *  four lands, which is the `slow` shape one board count over. CEILING: PRINTED. `landFetch.tapped` says the land ARRIVES tapped; the clause that untaps
 *  it afterwards is in no derived field (4 corpus cards print it: Fabled Passage, Elven Passage, Tiller Engine, Avatar Kyoshi), and a derive field for one
 *  land was not worth a DERIVE_VERSION and a re-derive. */
export const FETCH_UNTAPS = /untap that land/i;

/** The board Fabled Passage's "if you control four or more lands" reads, counted BEFORE the drop the
 *  fetch itself makes -- hence three. Exported so the simulator's slot flag and the audit's turn-N
 *  board cannot drift apart on the one number they share. */
export const FETCH_UNTAP_LANDS = 3;

/** Is the land this fetch finds still tapped when it arrives, with `otherLands` already down? From the derived `landFetch.tapped` ("put it onto the battlefield
 *  TAPPED": Evolving Wilds, Fabled Passage), less Fabled Passage's untap (`FETCH_UNTAPS`).
 *
 *  ASKED OF THE FETCH, NOT OF THE FETCHLAND. `classifyLand` reads the card in front of it and
 *  correctly calls Evolving Wilds untapped: the Wilds enters untapped and the BASIC it finds is the
 *  one that arrives tapped. Nothing a land classifier can see says so, which is why it lives here.
 *
 *  `mana-audit` asks it of a turn-N board; the simulator asks the same question of its own slot
 *  flags against `FETCH_UNTAP_LANDS`. */
export const fetchedLandEntersTapped = (dc: DeckCard, otherLands: number): boolean =>
  dc.tags?.landFetch?.tapped === true && !(FETCH_UNTAPS.test(dc.card.oracleText ?? "") && otherLands >= FETCH_UNTAP_LANDS);

/** The lands in THIS deck a fetch can actually find. Hand it the LIBRARY: a commander is not in it
 *  (CR 903.6) and cannot be fetched. */

/** "SEARCH FOR UP TO TWO BASIC LAND CARDS THAT SHARE A LAND TYPE" -- Myriad Landscape and Hiveheart
 *  Shaman, the two corpus cards that print it. A land with no land type shares none, and WASTES IS
 *  A BASIC LAND WITH NO LAND TYPE (`Basic Land`, no dash), so two Wastes do not answer it (owner,
 *  2026-09-06: "wastes do not have basic land type which they can share, so you can not fetch 2
 *  wastes with myriad landscape"). Read by the edge builder and by `fetchableLands` alike, so the
 *  board and the mana model cannot disagree about it. */
export const SHARES_A_LAND_TYPE = /share a land type/i;
/** A BASIC that carries a basic land type: `Basic Land — Island` yes, `Basic Land` (Wastes) no, and a
 *  dual (`Land — Island Mountain`) no because it is not basic. Both halves are checked here, so the
 *  name promises exactly what it tests. */
export const hasBasicLandType = (typeLine: string): boolean => {
  const line = typeLine.toLowerCase();
  return line.includes("basic") && BASIC_LAND_TYPES.some((t) => line.includes(t));
};

export function fetchableLands<T extends { typeLine: string }>(
  oracleText: string,
  deck: readonly T[],
): T[] {
  const text = oracleText.toLowerCase();
  const named = BASIC_LAND_TYPES.filter((t) => text.includes(t));
  const sharesType = SHARES_A_LAND_TYPE.test(text);
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
    if (sharesType && !hasBasicLandType(line)) return false;
    return true;
  });
}

/** HOW MANY LANDS ONE ACTIVATION ASKS FOR, AND HOW MANY THE LIBRARY CAN GIVE IT. "Not enough
 *  basics" is a deckbuilding fault no colour count sees (owner, 2026-09-06): Myriad Landscape in a
 *  deck with one basic of each type finds one land for its {2}, not two. `found` is the most lands
 *  a single activation can return -- for a shared-type fetch, the largest basic type the library
 *  holds; otherwise every land the fetch can reach. Not gated on the activation's mana cost, unlike
 *  `isFetchSource`: this is about what the card returns when you DO pay, not whether a model does.
 *  CEILING: PRINTED TEXT. `landFetch` carries the colours a fetch reaches (WUBRG) but not how many lands one activation asks for, nor the land types
 *  it names or whether they must share one, which is what this counts against the deck's own lands; there is no derived field to read instead. */
const UP_TO = /search your library for up to (two|three|four)\b/i;
const COUNT: Record<string, number> = { two: 2, three: 3, four: 4 };
export function fetchDemand<T extends { typeLine: string }>(
  oracleText: string,
  library: readonly T[],
): { wants: number; found: number; sharedType: boolean } | null {
  if (!LAND_FETCH.test(oracleText) || !ONTO_BATTLEFIELD.test(oracleText)) return null;
  // THE FETCH'S OWN LINE, not the whole text: a card with a second "search your library" line (an
  // opponent's, or a nonland "up to N") must not lend this one its count.
  const line = oracleText.split("\n").find((l) => LAND_FETCH.test(l)) ?? oracleText;
  const wants = COUNT[UP_TO.exec(line)?.[1]?.toLowerCase() ?? ""] ?? 1;
  const targets = fetchableLands(oracleText, library);
  const sharedType = SHARES_A_LAND_TYPE.test(line);
  const found = sharedType
    ? Math.max(0, ...BASIC_LAND_TYPES.map((t) => targets.filter((c) => c.typeLine.toLowerCase().includes(t)).length))
    : targets.length;
  return { wants, found, sharedType };
}
