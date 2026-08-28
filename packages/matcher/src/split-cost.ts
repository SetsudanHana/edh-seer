/** WHICH COST YOU ACTUALLY PAY FOR A SPLIT CARD.
 *
 *  `Dusk // Dawn` carries `manaCost = "{2}{W}{W} // {3}{W}{W}"` on the card document, because CR
 *  makes a split card's MANA VALUE the sum of both halves outside the stack. Every reader of that
 *  string then priced the card as a single nine-mana spell with four white pips — and on the
 *  Baldur's Gate precon that fiction was **the sole cause of the deck's only colour warning**
 *  ("1 card wants WWWW on turn 9 · 21 of 31 sources") and of a "9-drop" row in HARDEST CASTS.
 *  Found by the skeptic persona 2026-08-26, confirmed by a second persona and the tuner on
 *  2026-08-27, each tracing it back independently from the printed pips.
 *
 *  **MANA VALUE 9 IS NOT THE BUG.** The curve and the land regression are right to see nine — that
 *  is what CR 202.3b says the card's mana value is. What is wrong is the CASTABILITY question, which
 *  asks what you can PAY, and the answer is the cost of the half you are casting.
 *
 *  **THE FAMILY SPLITS THREE WAYS, MEASURED OVER THE CORPUS: 135 split-layout cards — FUSE 22 ·
 *  AFTERMATH 27 · plain split 86.** The combined cost is unpayable on 113 of 135.
 *
 *  - **Fuse** — *"you may cast one or both halves of this card from your hand"*. The combined cost is
 *    genuinely payable, so it is left alone. Strictly a fuse card is ALSO castable at one half, so
 *    keeping the combined cost UNDER-claims its castability; that is the direction this repo takes
 *    everywhere else and it keeps the change to the 113 cards where the current answer is a fiction.
 *  - **Aftermath** — *"cast this spell only from your graveyard"*. The two halves are cast from
 *    DIFFERENT ZONES and never together, and nothing in the mana model has a graveyard, so from hand
 *    only the FRONT half exists.
 *  - **A plain split** — either half, from hand. The card is castable the moment its CHEAPER half is,
 *    so that is the honest answer to "can you pay for this".
 *
 *  **THE DISCRIMINATOR IS STORED AND NEEDS NO PARSING**: `keywords` carries `["Fuse"]` and
 *  `["Aftermath"]` on the card document, and `docToCard` copies both it and `layout`.
 *
 *  CEILING: "cheaper" is the lower converted total, ties to the front half. Two halves of the same
 *  total in different colours (`{1}{U}` // `{1}{B}`) pick the front rather than whichever colour the
 *  board can actually make — a per-board choice this helper has no access to, and the two halves of
 *  a split are almost always different totals. Make `cost` a list of alternatives if that changes.
 */

/** The separator Scryfall prints between the halves of a split card's cost. */
const SPLIT = " // ";

const has = (keywords: readonly string[] | undefined, kw: string): boolean =>
  (keywords ?? []).some((k) => k.toLowerCase() === kw);

/** Converted total of one cost string — generic numbers plus one per symbol. Only ever used to
 *  compare two halves of the same card against each other, so an `{X}` (which no reader here can
 *  price anyway) simply counts as one. */
function convertedTotal(cost: string): number {
  let total = 0;
  for (const symbol of cost.match(/\{[^{}]+\}/g) ?? []) {
    const inner = symbol.slice(1, -1);
    const n = Number(inner);
    total += Number.isFinite(n) ? n : 1;
  }
  return total;
}

export interface SplitCostCard {
  manaCost?: string;
  layout?: string;
  keywords?: readonly string[];
}

/** The mana cost a player actually pays to cast this card from hand.
 *
 *  Identical to `card.manaCost` for everything that is not a split card, so every caller can use it
 *  unconditionally — which is the point: the two readers of this string (`goldfish.ts`'s `parseCost`
 *  and `mana-audit.ts`'s `pipsByColor`) produced the same fiction independently, and a fix in one
 *  would have left the other printing it. */
export function castableManaCost(card: SplitCostCard): string | undefined {
  const cost = card.manaCost;
  if (!cost || !cost.includes(SPLIT)) return cost;
  // The layout is checked as well as the separator: an "Instant // Land" modal DFC never carries a
  // joined cost here (`docToCard` takes the FRONT FACE's cost for those layouts), and a card that
  // somehow did should not be re-split by this function.
  if (card.layout !== undefined && card.layout !== "split") return cost;
  if (has(card.keywords, "fuse")) return cost;
  const halves = cost.split(SPLIT).map((h) => h.trim()).filter((h) => h.length > 0);
  if (halves.length < 2) return cost;
  if (has(card.keywords, "aftermath")) return halves[0];
  return halves.reduce((a, b) => (convertedTotal(b) < convertedTotal(a) ? b : a));
}
