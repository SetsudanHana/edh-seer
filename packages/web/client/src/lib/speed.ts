import type { DeckReport } from "../types.js";
import { comboWinsItself, isInfiniteCombo } from "@edh-seer/matcher/brackets";

/** HOW FAST THE DECK CAN WIN, BY EVERY ROUTE IT HAS (owner, 2026-09-26: "we should be able to assess
 *  deck speed", and "remember that combat is not the only way to win"). The report timed one route:
 *  a combat clock against one opponent with nobody blocking, which the baseline round's bracket and
 *  phone seats could not use as "how fast I win", and which says nothing about a combo deck. r/EDH
 *  treats speed as what separates bracket 3 from 4 ("how fast can you win?").
 *
 *  So each win route the report already found gets its own line, and each says exactly what it
 *  measures:
 *  - combo: the turn the deck has the MANA for its cheapest infinite combo THAT KILLS (it has a payoff
 *    card, or its result wins by itself: `comboWinsItself`), from the goldfish's own mana-by-turn rows,
 *    which is a floor: drawing both pieces is not counted. A loop nothing turns into a win is listed
 *    with no turn and `needsFinisher`, and never leads;
 *  - alternate win: the turn it can cast its cheapest alt-win card, before that card's condition;
 *  - combat (go-wide, big creatures, one big creature): the turn the board has dealt 120, all three
 *    opponents (#1056 R1, `deckMath.speed.combat`) -- not the one-opponent clock;
 *  - damage or drain: the turn its repeating drains at each opponent take the whole table (#1056,
 *    `deckMath.speed.drain`), a rough floor at one fire per source of each trigger;
 *  - milling, and burn that is one-shot or single-target: listed with their cards and untimed until
 *    their own routes land (#1056). Leaving them off would read as "cannot win that way".
 *
 *  A JOIN over the report: `manaAvailability.rows`, `deckMath.clock`, `deckMath.wincons`, the combo
 *  list and each card's mana value. Nothing new is modelled here. */
export interface SpeedRoute {
  kind: "combo" | "alt-win" | "combat" | "commander" | "poison" | "burn" | "mill";
  /** What the route is, in a player's words. */
  label: string;
  /** Typical turn (half of games), and the spread: fast games and slow games. */
  turn?: number;
  early?: number;
  late?: number;
  /** The mana the route needs, when that is what is timed. */
  mana?: number;
  cards: string[];
  /** The card an alternate win is timed by: its cheapest, which is not the one that wins soonest
   *  (Mari's is Vorpal Sword, one mana to cast and eight to turn on). */
  card?: string;
  /** A combo's payoffs: the deck's cards that turn what the loop repeats into a win. */
  payoffs?: string[];
  /** A combo route whose loop nothing in the deck turns into a win: listed, never timed. */
  needsFinisher?: boolean;
  /** False when the combo's result is not a loop ("Win the game" alone): it wins, it does not go infinite. */
  infinite?: boolean;
  /** A combo that wins by itself with no payoff card: the Commander Spellbook result phrase that says so. */
  winsBy?: string;
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

/** What the drain turn assumes, in one line: once per thing that sets it off, nobody gains life, and
 *  any source that grows with the board counted as one. */
export function drainCaveat(d: { turn?: number; cards: string[]; unbounded: string[] }): string {
  const n = d.cards.length;
  const what = `${n} repeating drain${n === 1 ? "" : "s"} at each opponent`;
  const grows = d.unbounded.length ? `; ${d.unbounded.join(", ")} counted as one a turn, though ${d.unbounded.length === 1 ? "it grows" : "they grow"} with your board` : "";
  return d.turn !== undefined
    ? `when its ${what} have taken 40 from every opponent, each firing once per creature, token or spell that sets it off, and nobody gaining life${grows}`
    : `its ${what} ${n === 1 ? "does" : "do"} not take 40 from every opponent by turn 20 at one fire per source${grows}`;
}

const COMBAT: Record<string, string> = { "go-wide": "attacking with a wide board", stompy: "attacking with big creatures", voltron: "one big creature" };

export function speedRoutes(report: DeckReport, manaValueOf: (name: string) => number | undefined): SpeedRoute[] {
  const rows = report.manaAvailability?.rows;
  const classes = report.deckMath?.wincons.classes ?? [];
  const cardsOf = (cls: string) => classes.find((c) => c.class === cls)?.cards ?? [];
  const has = (cls: string) => classes.some((c) => c.class === cls);
  const routes: SpeedRoute[] = [];

  // CANDIDATES ARE WIDER THAN `infiniteCombos` (which the bracket reads): "Exile your library, Win the
  // game" (Demonic Consultation + Thassa's Oracle) says nothing infinite and is the surest kill there is.
  const byCost = (report.combos ?? [])
    .filter((c) => isInfiniteCombo(c.result) || comboWinsItself(c.result))
    .map((c) => ({ ...c, manaValue: c.cards.reduce((t, n) => t + (manaValueOf(n) ?? 0), 0) }))
    .sort((a, b) => a.manaValue - b.manaValue || a.cards.join().localeCompare(b.cards.join()));
  // A combo KILLS when a card here turns its loop into a win, or its result wins by itself.
  const cheapest = byCost.find((c) => c.payoffs?.length || comboWinsItself(c.result));
  if (cheapest) {
    const timing = manaTurn(rows, cheapest.manaValue);
    const lastTurn = rows?.at(-1)?.turn;
    const phrase = cheapest.payoffs?.length ? undefined : cheapest.result.split(",").map((x) => x.trim()).find((x) => comboWinsItself(x));
    routes.push({
      kind: "combo", label: `a combo: ${cheapest.cards.join(" + ")}`, mana: cheapest.manaValue,
      ...timing, cards: cheapest.cards,
      ...(cheapest.payoffs?.length ? { payoffs: cheapest.payoffs.map((p) => p.name) } : {}),
      ...(phrase ? { winsBy: phrase } : {}),
      infinite: isInfiniteCombo(cheapest.result),
      caveat: timing.turn !== undefined
        ? "when the deck has the mana for both pieces; drawing or finding them is not counted, so this is the earliest it can happen, not a typical kill"
        : `not timed: its pieces cost ${cheapest.manaValue} mana together, which half our test games have not reached${lastTurn !== undefined ? ` by turn ${lastTurn}` : ""}`,
    });
  } else if (byCost[0]) {
    routes.push({
      kind: "combo", label: `a combo: ${byCost[0].cards.join(" + ")}`, cards: byCost[0].cards, needsFinisher: true,
      caveat: "the loop needs a finisher: no card here was found to turn what it repeats into a win",
    });
  }

  const alt = cardsOf("alt-win")
    .map((name) => ({ name, mv: manaValueOf(name) }))
    .filter((c): c is { name: string; mv: number } => c.mv !== undefined)
    .sort((a, b) => a.mv - b.mv)[0];
  if (alt) {
    routes.push({
      kind: "alt-win", label: `an alternate win: ${alt.name}`, mana: alt.mv, ...manaTurn(rows, alt.mv), cards: cardsOf("alt-win"), card: alt.name,
      caveat: "when it can be cast; its own win condition still has to be met after that",
    });
  }

  const combat = classes.filter((c) => COMBAT[c.class]);
  // THE WHOLE TABLE (#1056 R1): 120 damage, not the one-opponent clock -- which stays the horizon.
  // THE MEDIAN SIMULATED GAME and its fast/slow quarters (owner 2026-10-07): each game spends only its
  // own turn's mana. The expected curve banked mana across turns and read ~3 turns early.
  const combatSpeed = report.deckMath?.speed?.combat;
  const table = combatSpeed?.turn;
  // A commander that prevents your damage to opponents (The Mindskinner) times no damage route.
  const prevented = report.deckMath?.speed?.prevented;
  const preventedWhy = prevented ? `not timed: ${prevented} prevents your damage to opponents` : undefined;
  if (combat.length) {
    routes.push({
      kind: "combat", label: combat.map((c) => COMBAT[c.class]!).join(" or "), turn: table, cards: combat.flatMap((c) => c.cards ?? []),
      ...(!preventedWhy && combatSpeed?.early !== undefined ? { early: combatSpeed.early } : {}),
      ...(!preventedWhy && combatSpeed?.late !== undefined ? { late: combatSpeed.late } : {}),
      caveat: preventedWhy ?? (table
        ? "half our test games have dealt 120 by then, enough for all three opponents, if nobody blocks and nothing is removed"
        : combatSpeed?.early !== undefined
          ? `not timed: most of our test games never deal 120 by turn 20, though the fastest quarter do by turn ${combatSpeed.early}`
          : "not timed: in our test games the board never deals 120, enough for all three opponents"),
    });
  }

  // COMMANDER DAMAGE (#1056 R2): voltron decks, 21 to each opponent from one creature.
  const cmd = report.deckMath?.speed?.commander;
  if (cmd) {
    routes.push({
      kind: "commander", label: `commander damage: ${cmd.commander}`, ...(cmd.turn !== undefined ? { turn: cmd.turn } : {}), cards: [cmd.commander],
      caveat: preventedWhy ?? (cmd.turn !== undefined
        ? "when it has dealt 21 to each opponent: cast with haste, carrying the Equipment and Auras out by then, nobody blocking"
        : "not timed: it does not deal 21 to all three opponents by turn 20"),
    });
  }

  // POISON (#1056 R3): ten counters on each opponent, attacks a third each, proliferate on every one.
  const poison = report.deckMath?.speed?.poison;
  if (poison) {
    routes.push({
      kind: "poison", label: "poison counters", cards: poison.cards, ...(poison.turn !== undefined ? { turn: poison.turn } : {}),
      caveat: poison.turn !== undefined
        ? "when every opponent has ten poison counters: infect and toxic attacks unblocked, each proliferate adding one to everyone already poisoned"
        : prevented ? `not timed: ${prevented} prevents your damage to opponents, and no counters are placed fast enough`
        : "not timed: it does not put ten poison counters on every opponent by turn 20",
    });
  }

  for (const [kind, label] of [["burn", "damage or drain"], ["mill", "milling them out"]] as const) {
    // By the win plan itself, not its card list: until 2026-09-26 the report named only combo and
    // alt-win cards, and Chandra, "mostly burn, 21 cards", had no burn line when this keyed on the list.
    // A TIMED mill shows even when no mill plan class fired: The Mindskinner turns the board into mill,
    // which no mill card in the list announces (review of #1056 R4).
    if (!has(kind) && !(kind === "mill" && report.deckMath?.speed?.mill?.turn !== undefined)) continue;
    // THE DRAIN IS TIMED (#1056, owner 2026-10-06): the turn its repeating drains have taken 40 from
    // each opponent -- the whole table, since each drain hits all three -- firing once per source of
    // its trigger (`drainClock`). Replaces #984's refusal.
    const drain = kind === "burn" ? report.deckMath?.speed?.drain : undefined;
    // MILL IS TIMED (#1056 R4): cards milled from each opponent against the library they have left.
    const mill = kind === "mill" ? report.deckMath?.speed?.mill : undefined;
    if (mill) {
      const n = mill.cards.length;
      routes.push({ kind, label, cards: cardsOf(kind).length ? cardsOf(kind) : mill.cards, ...(mill.turn !== undefined ? { turn: mill.turn } : {}), caveat: mill.turn !== undefined
        ? `when ${n} mill card${n === 1 ? " has" : "s have"} emptied every opponent's library, each firing once per thing that sets it off; their own extra draws would make it sooner`
        : `its ${n} mill card${n === 1 ? " does" : "s do"} not empty every opponent's library by turn 20` });
      continue;
    }
    routes.push({ kind, label, cards: cardsOf(kind), ...(drain?.turn !== undefined ? { turn: drain.turn } : {}), caveat: kind === "burn" && preventedWhy ? preventedWhy : drain
      ? drainCaveat(drain)
      : kind === "burn"
        ? "its burn is one-shot or aimed at one player, which is not timed yet"
        : "nothing in the report models how fast this route kills, so it has no turn" });
  }
  return routes;
}

/** The fastest timed route, for the one-line answer. An alternate win is timed only to when its
 *  card can be cast, which is not when it wins (Simic Ascendancy at turn 2 still needs twenty growth
 *  counters), so it never leads. */
export function fastestRoute(routes: SpeedRoute[]): SpeedRoute | undefined {
  return routes.filter((r) => r.turn !== undefined && r.kind !== "alt-win").sort((a, b) => a.turn! - b.turn!)[0];
}
