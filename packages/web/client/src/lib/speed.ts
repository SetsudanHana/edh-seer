import type { DeckReport } from "../types.js";
import { infiniteCombos } from "./bracket-why.js";

/** HOW FAST THE DECK CAN WIN, BY EVERY ROUTE IT HAS (owner, 2026-09-26: "we should be able to assess
 *  deck speed", and "remember that combat is not the only way to win"). The report timed one route:
 *  a combat clock against one opponent with nobody blocking, which the baseline round's bracket and
 *  phone seats could not use as "how fast I win", and which says nothing about a combo deck. r/EDH
 *  treats speed as what separates bracket 3 from 4 ("how fast can you win?").
 *
 *  So each win route the report already found gets its own line, and each says exactly what it
 *  measures:
 *  - combo: the turn the deck has the MANA for its cheapest infinite combo (from the goldfish's own
 *    mana-by-turn rows), which is a floor: drawing both pieces is not counted;
 *  - alternate win: the turn it can cast its cheapest alt-win card, before that card's condition;
 *  - combat (go-wide, big creatures, one big creature): the report's clock;
 *  - damage or drain, and milling: listed with their cards, and said to be untimed, because nothing
 *    in the report models how fast they kill. Leaving them off would read as "cannot win that way".
 *
 *  A JOIN over the report: `manaAvailability.rows`, `deckMath.clock`, `deckMath.wincons`, the combo
 *  list and each card's mana value. Nothing new is modelled here. */
export interface SpeedRoute {
  kind: "combo" | "alt-win" | "combat" | "burn" | "mill";
  /** What the route is, in a player's words. */
  label: string;
  /** Typical turn (half of games), and the spread: fast games and slow games. */
  turn?: number;
  early?: number;
  late?: number;
  /** The mana the route needs, when that is what is timed. */
  mana?: number;
  cards: string[];
  /** What the number does and does not count. */
  caveat: string;
}

type Rows = NonNullable<DeckReport["manaAvailability"]>["rows"];

/** The first turn the deck has `mana` available: typical (median), in its fast games (the top
 *  quarter) and in its slow ones (the bottom quarter). Undefined past the simulated turns. */
export function manaTurn(rows: Rows | undefined, mana: number): { turn?: number; early?: number; late?: number } {
  const first = (pick: (r: Rows[number]) => number) => rows?.find((r) => pick(r) >= mana)?.turn;
  return { turn: first((r) => r.mana.median), early: first((r) => r.mana.p75), late: first((r) => r.mana.p25) };
}

const COMBAT: Record<string, string> = { "go-wide": "attacking with a wide board", stompy: "attacking with big creatures", voltron: "one big creature" };

export function speedRoutes(report: DeckReport, manaValueOf: (name: string) => number | undefined): SpeedRoute[] {
  const rows = report.manaAvailability?.rows;
  const classes = report.deckMath?.wincons.classes ?? [];
  const cardsOf = (cls: string) => classes.find((c) => c.class === cls)?.cards ?? [];
  const has = (cls: string) => classes.some((c) => c.class === cls);
  const routes: SpeedRoute[] = [];

  const combos = infiniteCombos(report.combos, manaValueOf);
  const cheapest = [...combos].sort((a, b) => a.manaValue - b.manaValue)[0];
  if (cheapest) {
    routes.push({
      kind: "combo", label: `a combo: ${cheapest.cards.join(" + ")}`, mana: cheapest.manaValue,
      ...manaTurn(rows, cheapest.manaValue), cards: cheapest.cards,
      caveat: "when the deck has the mana for both pieces; drawing or finding them is not counted, so this is the earliest it can happen, not a typical kill",
    });
  }

  const alt = cardsOf("alt-win")
    .map((name) => ({ name, mv: manaValueOf(name) }))
    .filter((c): c is { name: string; mv: number } => c.mv !== undefined)
    .sort((a, b) => a.mv - b.mv)[0];
  if (alt) {
    routes.push({
      kind: "alt-win", label: `an alternate win: ${alt.name}`, mana: alt.mv, ...manaTurn(rows, alt.mv), cards: cardsOf("alt-win"),
      caveat: "when it can be cast; its own win condition still has to be met after that",
    });
  }

  const combat = classes.filter((c) => COMBAT[c.class]);
  const clock = report.deckMath?.clock.turn;
  if (combat.length) {
    routes.push({
      kind: "combat", label: combat.map((c) => COMBAT[c.class]!).join(" or "), turn: clock, cards: combat.flatMap((c) => c.cards ?? []),
      caveat: clock
        ? "enough attacking power to kill one opponent, if nobody blocks and nothing is removed"
        : "not timed: in our test games the deck never puts enough power on the board",
    });
  }

  for (const [kind, label] of [["burn", "damage or drain"], ["mill", "milling them out"]] as const) {
    // By the win plan itself, not its card list: until 2026-09-26 the report named only combo and
    // alt-win cards, and Chandra, "mostly burn, 21 cards", had no burn line when this keyed on the list.
    if (has(kind)) routes.push({ kind, label, cards: cardsOf(kind), caveat: "nothing in the report models how fast this route kills, so it has no turn" });
  }
  return routes;
}

/** The fastest timed route, for the one-line answer. An alternate win is timed only to when its
 *  card can be cast, which is not when it wins (Simic Ascendancy at turn 2 still needs twenty growth
 *  counters), so it never leads. */
export function fastestRoute(routes: SpeedRoute[]): SpeedRoute | undefined {
  return routes.filter((r) => r.turn !== undefined && r.kind !== "alt-win").sort((a, b) => a.turn! - b.turn!)[0];
}
