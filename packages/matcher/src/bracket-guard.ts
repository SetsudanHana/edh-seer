/** THE BRACKET GUARD (#767, task 2): whether a deck with some swaps made still fits a bracket
 *  target, and, when a precon starts above a target, which cards to cut to bring it down (owner,
 *  2026-09-30: "cuts to get there").
 *
 *  THE BAND IS `deckBracket`'s, NEVER A SECOND READING OF IT. The guard only builds the deck the swaps
 *  leave and asks the same function the report asks, so the package and the bracket tile cannot
 *  disagree about one list. */
import { ComboIndex, type Card, type Combo } from "@edh-seer/engine";
import { BRACKET_3_GAME_CHANGERS, CHEAP_COMBO_MV, comboPieces, deckBracket, isInfiniteCombo, type DeckBracket } from "./brackets.js";
import { bandFits, type BracketTarget } from "./upgrade-package.js";

/** The deck the swaps leave: each cut removes that card, each add joins. Combos are every combo the
 *  resulting names contain, out of `combos` (the union anchored on the deck's and the adds' cards). */
export function bandAfter(deck: readonly Card[], combos: readonly Combo[], cuts: readonly string[], adds: readonly Card[]): DeckBracket {
  const out = new Set(cuts);
  const cards = [...deck.filter((c) => !out.has(c.name)), ...adds];
  const names = new Set(cards.map((c) => c.name));
  return deckBracket(cards, new ComboIndex([...combos]).combosContainedIn(names));
}

export function fitsTarget(deck: readonly Card[], combos: readonly Combo[], cuts: readonly string[], adds: readonly Card[], target: BracketTarget): boolean {
  return bandFits(bandAfter(deck, combos, cuts, adds).band, target);
}

/** The Game Changers a target allows. */
export const gameChangerLimit = (target: BracketTarget): number => (target === 2 ? 0 : target === 3 ? BRACKET_3_GAME_CHANGERS : Infinity);

/** WHAT A TARGET FORBIDS OF A COMBO, as `deckBracket` reads it: bracket 2 forbids every infinite combo,
 *  bracket 3 only the two-piece infinite ones costing `CHEAP_COMBO_MV` or less in all. */
function forbidden(c: Combo, target: BracketTarget, manaValue: ReadonlyMap<string, number>): boolean {
  if (target === 4 || !isInfiniteCombo(c.result)) return false;
  if (target === 2) return true;
  return comboPieces(c) <= 2 && c.cards.reduce((t, n) => t + (manaValue.get(n) ?? 0), 0) <= CHEAP_COMBO_MV;
}

export interface BringDownCut {
  name: string;
  /** Why it goes: a Game Changer over the target's limit, or a piece of a combo the target forbids. */
  why: { kind: "game-changer"; limit: number; count: number } | { kind: "combo"; with: string[]; result: string };
}

export interface BringDown {
  cuts: BringDownCut[];
  /** False when no cut can get there: a commander is itself a Game Changer over the limit, or a
   *  forbidden combo is made of commanders alone. */
  reachable: boolean;
}

/** THE CUTS THAT PUT A DECK UNDER A TARGET, fewest first.
 *
 *  COMBOS BEFORE GAME CHANGERS, AND ONE CUT FOR AS MANY COMBOS AS IT BREAKS: a card in several
 *  forbidden combos goes before a card in one, then the card with fewer links to the deck (`links`),
 *  then the name. The commander is never cut. A Game Changer cut to break a combo counts toward the
 *  Game Changer limit, so the second pass cuts only what is still over it, fewest links first. */
export function bringDown(deck: readonly Card[], combos: readonly Combo[], target: BracketTarget, commanders: readonly string[], links: ReadonlyMap<string, number>): BringDown {
  const names = new Set(deck.map((c) => c.name));
  const manaValue = new Map(deck.map((c) => [c.name, c.manaValue ?? 0]));
  const isCommander = new Set(commanders);
  const byLinks = (a: string, b: string) => (links.get(a) ?? 0) - (links.get(b) ?? 0) || a.localeCompare(b);
  const cuts: BringDownCut[] = [];
  const cut = new Set<string>();
  let reachable = true;

  let open = new ComboIndex([...combos]).combosContainedIn(names).filter((c) => forbidden(c, target, manaValue));
  while (open.length > 0) {
    const counts = new Map<string, number>();
    for (const c of open) for (const n of c.cards) if (!isCommander.has(n)) counts.set(n, (counts.get(n) ?? 0) + 1);
    if (counts.size === 0) { reachable = false; break; }
    const pick = [...counts.keys()].sort((a, b) => counts.get(b)! - counts.get(a)! || byLinks(a, b))[0]!;
    const first = open.find((c) => c.cards.includes(pick))!;
    cuts.push({ name: pick, why: { kind: "combo", with: first.cards.filter((n) => n !== pick), result: first.result } });
    cut.add(pick);
    open = open.filter((c) => !c.cards.includes(pick));
  }

  const limit = gameChangerLimit(target);
  const left = deck.filter((c) => c.gameChanger === true && !cut.has(c.name));
  const count = new Set(left.map((c) => c.name)).size;
  if (count > limit) {
    const cuttable = [...new Set(left.filter((c) => !isCommander.has(c.name)).map((c) => c.name))].sort(byLinks);
    const need = count - limit;
    if (cuttable.length < need) reachable = false;
    for (const name of cuttable.slice(0, need)) cuts.push({ name, why: { kind: "game-changer", limit, count } });
  }
  // THE SAME QUESTION THE PACKAGE WILL BE ASKED: whatever the passes above concluded, the cuts only
  // count as reaching the target when `deckBracket` on what is left says so.
  if (reachable) reachable = fitsTarget(deck, combos, cuts.map((c) => c.name), [], target);
  return { cuts, reachable };
}
