import { BRACKET_3_GAME_CHANGERS, CHEAP_COMBO_MV, isInfiniteCombo } from "@edh-seer/matcher/brackets";
import type { DeckReport } from "../types.js";

/** THE BRACKET, WITH ITS WORKING SHOWN (owner, 2026-09-26: "we should be able to assess the
 *  bracket"). The panel said "Bracket 3 · 1 infinite combo" and never named the combo, and a 1-2
 *  deck read "No Game Changers and no two-card infinite combos here", which is word for word what a
 *  tool that missed a combo would say. Every seat in the baseline round that asked about power hit
 *  it: the phone seat could not answer "which combo?", and the bracket seat could not tell "none
 *  found" from "never looked". r/EDH says the same: "It got 4 on Brackcheck, 2 on EDHpowerlevel and
 *  3 on deckcheck", and Game Changers and combos are the only facts players agree on. So the panel
 *  names both, with what each combo does, and says in one sentence why the deck sits where it does.
 *
 *  Everything here is a JOIN over what the report already carries: the bracket's own band and Game
 *  Changers, the report's full combo list, and each card's mana value. The rule for "infinite" and
 *  the cost ceiling are the matcher's own, so this list and the band cannot disagree. */
export interface InfiniteCombo {
  cards: string[];
  result: string;
  /** Mana value of every piece, added together. */
  manaValue: number;
  /** Two cards at or under the ceiling: what bracket 3 does not allow. */
  cheap: boolean;
}

type Bracket = NonNullable<DeckReport["bracket"]>;

export function infiniteCombos(
  combos: readonly { cards: string[]; result: string }[] | undefined,
  manaValueOf: (name: string) => number | undefined,
): InfiniteCombo[] {
  return (combos ?? [])
    .filter((c) => isInfiniteCombo(c.result))
    .map((c) => {
      const manaValue = c.cards.reduce((t, n) => t + (manaValueOf(n) ?? 0), 0);
      return { cards: c.cards, result: c.result, manaValue, cheap: c.cards.length <= 2 && manaValue <= CHEAP_COMBO_MV };
    })
    .sort((a, b) => Number(b.cheap) - Number(a.cheap) || a.manaValue - b.manaValue || a.cards.join().localeCompare(b.cards.join()));
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const listNames = (names: string[]) =>
  names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

/** One sentence a player could say at the table: the band, and the cards that put it there. */
export function bracketWhy(bracket: Bracket, combos: InfiniteCombo[]): string {
  const label = bracket.band === "1-2" ? "1–2" : bracket.band === "4-5" ? "4–5" : "3";
  const gc = bracket.gameChangers;
  const infinite = combos.length || bracket.infiniteCombos;
  if (bracket.band === "1-2") {
    return "Bracket 1–2: none of its cards is on Wizards' Game Changers list, and no infinite combo Commander Spellbook knows is complete in this deck.";
  }
  const parts: string[] = [];
  if (gc.length > BRACKET_3_GAME_CHANGERS) parts.push(`${plural(gc.length, "Game Changer")}, more than the ${BRACKET_3_GAME_CHANGERS} bracket 3 allows`);
  else if (gc.length) parts.push(gc.length === 1 ? `${gc[0]} (a Game Changer)` : `${plural(gc.length, "Game Changer")} (${listNames(gc)})`);
  const cheap = combos.filter((c) => c.cheap);
  const cheapCount = cheap.length || bracket.cheapCombos.length;
  const first = cheap[0] ?? bracket.cheapCombos[0];
  if (cheapCount && first) {
    parts.push(cheapCount === 1
      ? `${first.cards.join(" + ")} (a two-card infinite combo for ${first.manaValue} mana, cheap enough to come together early)`
      : `${cheapCount} two-card infinite combos cheap enough to come together early (the cheapest ${first.cards.join(" + ")}, ${first.manaValue} mana)`);
  } else if (infinite) {
    // WIZARDS' RULE IS ABOUT TIMING, NOT MANA (Commander Brackets update, 2026-02-09): bracket 3
    // allows a two-card combo that comes together late in the game, around turn six or after. Two
    // cards costing CHEAP_COMBO_MV or less between them is this site's stand-in for "early", so the
    // sentence says which half of the rule a combo misses and never states the stand-in as the rule.
    const one = combos[0];
    const why = one && one.cards.length > 2 ? `it needs ${one.cards.length} cards` : one ? `at ${one.manaValue} mana it comes together late` : "";
    parts.push(infinite === 1 && one
      ? `${one.cards.join(" + ")} (an infinite combo bracket 3 still allows: ${why})`
      : `${plural(infinite, "infinite combo")}, none of them two cards cheap enough to come together early, which is what bracket 3 rules out`);
  }
  return `Bracket ${label} because of ${listNames(parts)}.`;
}
