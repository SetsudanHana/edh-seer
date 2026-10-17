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
  /** Set ONLY when the route is modelled and finishes no game: the clause `noFinisher` joins. Unmodelled,
   *  timed, alternate-win and combo-that-kills routes never carry it: those are "unknown", not "no". */
  lacks?: string;
}

type Rows = NonNullable<DeckReport["manaAvailability"]>["rows"];

/** The first turn the deck has `mana` available: typical (median), in its fast games (the top
 *  quarter) and in its slow ones (the bottom quarter). Undefined past the simulated turns. */
export function manaTurn(rows: Rows | undefined, mana: number): { turn?: number; early?: number; late?: number } {
  const first = (pick: (r: Rows[number]) => number) => rows?.find((r) => pick(r) >= mana)?.turn;
  return { turn: first((r) => r.mana.median), early: first((r) => r.mana.p75), late: first((r) => r.mana.p25) };
}

/** A SOURCE COUNTED AT ITS FLOOR IS SAID (#1260): a clock counts a source with no ceiling (Krenko's X
 *  goblins, Ghost Vacuum's every exiled creature, Waterbender's Restoration's X blinks) as one a turn
 *  and names it in `unbounded`, so a turn, or a "not by turn 20", is a floor on its speed. What it
 *  grows WITH differs by card (the board, a graveyard, X), so the words say only that a use can
 *  count for more. One suffix for drain, mill and poison, so the three caveats say it alike. */
export function growsCaveat(unbounded: readonly string[] | undefined): string {
  return unbounded?.length ? `; ${unbounded.join(", ")} counted as one a turn, though each use can count for more` : "";
}

/** What the drain turn assumes, in one line: once per thing that sets it off, nobody gains life, and
 *  any uncapped source counted as one (`growsCaveat`). */
export function drainCaveat(d: { turn?: number; cards: string[]; unbounded: string[] }): string {
  const n = d.cards.length;
  const what = `${n} repeating drain${n === 1 ? "" : "s"} at each opponent`;
  const grows = growsCaveat(d.unbounded);
  return d.turn !== undefined
    ? `when its ${what} have taken 40 from every opponent, each firing once per creature, token or spell that sets it off, and nobody gaining life${grows}`
    : `its ${what} ${n === 1 ? "does" : "do"} not take 40 from every opponent by turn 20 at one fire per source${grows}`;
}

/** A phrase that ends one opponent: "loses the game", or damage / lifeloss aimed at a player. Plain
 *  substring tests, no nested quantifiers.
 *  CEILING: a substring heuristic over Commander Spellbook result phrases. It errs toward saying "no",
 *  which withholds the verdict: a wipe ("creature"), a prevention, or damage to "all players" (which
 *  kills you too, as brackets.ts rules) is never a kill. */
function killsAPlayer(phrase: string): boolean {
  const p = phrase.toLowerCase();
  if (p.includes("prevent") || p.includes("all players") || p.includes("creature") || /\byou lose\b/.test(p)) return false;
  return p.includes("loses the game") || (/\b(?:damage|life ?loss)\b/.test(p) && /\b(?:opponents?|players?)\b/.test(p));
}

/** What a loop repeats, from its result phrase ("Infinite creature ETB, Infinite magecraft triggers" ->
 *  "creature ETB and magecraft triggers"): at most three, "a, b and c". An acronym keeps its case. */
export function repeats(result: string): string {
  const parts = result.split(",").map((x) => x.trim().replace(/^(?:near-)?infinite\s+/i, "")).filter(Boolean)
    .map((x) => (/^[A-Z]{2,}\b/.test(x) ? x : x.charAt(0).toLowerCase() + x.slice(1)));
  const xs = [...new Set(parts)].slice(0, 3);
  return xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;
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
      // A result that kills one player (Target opponent loses the game) is not `comboWinsItself`, but it is not "no finisher" either.
      ...(byCost[0].result.split(",").some(killsAPlayer) ? {} : { lacks: `the ${byCost[0].cards.join(" + ")} loop repeats ${repeats(byCost[0].result)}, and no card here turns that into a win` }),
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
  // With mill data beside a preventer the commander turns the board into mill, which is unmodelled
  // here: naming the preventer would read its own engine as the defect.
  const preventedLacks = prevented && !report.deckMath?.speed?.mill ? `${prevented} prevents your damage to opponents` : undefined;
  if (combat.length) {
    routes.push({
      kind: "combat", label: combat.map((c) => COMBAT[c.class]!).join(" or "), turn: table, cards: combat.flatMap((c) => c.cards ?? []),
      ...(!preventedWhy && combatSpeed?.early !== undefined ? { early: combatSpeed.early } : {}),
      ...(!preventedWhy && combatSpeed?.late !== undefined ? { late: combatSpeed.late } : {}),
      // `early` is the p25: absent means under a quarter of games deal 120, not none. And with no
      // simulation (`manaAvailability` absent) `combat` is {} for want of data, which says nothing.
      ...(table === undefined && (prevented ? preventedLacks : combatSpeed?.early === undefined && rows)
        ? { lacks: preventedLacks ?? "its creatures deal the table's 120 in fewer than a quarter of our test games by turn 20" } : {}),
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
      ...(cmd.turn === undefined && (!prevented || preventedLacks) ? { lacks: preventedLacks ?? `${cmd.commander} does not deal 21 to each opponent by turn 20` } : {}),
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
      ...(poison.turn === undefined && !poison.unbounded?.length && (!prevented || preventedLacks) ? { lacks: preventedLacks ?? "it does not put ten poison counters on every opponent by turn 20" } : {}),
      caveat: poison.turn !== undefined
        ? `when every opponent has ten poison counters: infect and toxic attacks unblocked, each proliferate adding one to everyone already poisoned${growsCaveat(poison.unbounded)}`
        : prevented ? `not timed: ${prevented} prevents your damage to opponents, and no counters are placed fast enough`
        : `not timed: it does not put ten poison counters on every opponent by turn 20${growsCaveat(poison.unbounded)}`,
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
      routes.push({ kind, label, cards: cardsOf(kind).length ? cardsOf(kind) : mill.cards, ...(mill.turn !== undefined ? { turn: mill.turn } : {}),
        ...(mill.turn === undefined && !mill.unbounded?.length ? { lacks: "its mill cards do not empty every opponent's library by turn 20" } : {}), caveat: mill.turn !== undefined
        ? `when ${n} mill card${n === 1 ? " has" : "s have"} emptied every opponent's library, each firing once per thing that sets it off; their own extra draws would make it sooner${growsCaveat(mill.unbounded)}`
        : `its ${n} mill card${n === 1 ? " does" : "s do"} not empty every opponent's library by turn 20${growsCaveat(mill.unbounded)}` });
      continue;
    }
    routes.push({ kind, label, cards: cardsOf(kind), ...(drain?.turn !== undefined ? { turn: drain.turn } : {}),
      ...(kind === "burn" && preventedLacks ? { lacks: preventedLacks }
        : drain && drain.turn === undefined && !drain.unbounded.length ? { lacks: `its drains take about ${Math.round(drain.perTurn.reduce((t, x) => t + x, 0))} of each opponent's 40 by turn 20` } : {}),
      caveat: kind === "burn" && preventedWhy ? preventedWhy : drain
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

/** The route kinds that answer for a win-plan class, as WinPlans' ROUTE_OF reads them (voltron: the
 *  commander's or the board's). A class not listed here is not known to have a route. */
const CLASS_ROUTES: Record<string, SpeedRoute["kind"][]> = {
  combo: ["combo"], "alt-win": ["alt-win"], "go-wide": ["combat"], stompy: ["combat"], voltron: ["commander", "combat"],
  burn: ["burn"], mill: ["mill"], poison: ["poison"],
};

/** THE VERDICT WHEN NO ROUTE FINISHES (#1223), as a lowercase clause: "nothing here was found that
 *  finishes a game: a; b." "How you win" listed plans whose routes each said they do not finish, and
 *  nothing said so in one sentence ("Spread about evenly across 2 plans" read as "it wins two ways").
 *  When there are routes, EVERY route carries `lacks` and EVERY plan class has a route of its own, this
 *  joins the distinct clauses with "; " (each holds its own commas and "and"). The headline and the
 *  Say-this line both read it, so the line and the chapters cannot disagree.
 *
 *  CEILING: a deck with an unmodelled finish (one-shot burn, an alternate win, a combo that kills but
 *  is untimed), an undercounted source (`unbounded`), or a plan class with no route gets no verdict and
 *  keeps today's text. */
export function noFinisherClause(routes: SpeedRoute[], classes: { class: string }[]): string | undefined {
  if (!routes.length || !routes.every((r) => r.lacks)) return undefined;
  if (!classes.every((c) => CLASS_ROUTES[c.class]?.some((k) => routes.some((r) => r.kind === k)))) return undefined;
  return `nothing here was found that finishes a game: ${[...new Set(routes.map((r) => r.lacks))].join("; ")}.`;
}

/** `noFinisherClause`, capitalised to stand as a sentence. */
export function noFinisher(routes: SpeedRoute[], classes: { class: string }[]): string | undefined {
  const c = noFinisherClause(routes, classes);
  return c && c.charAt(0).toUpperCase() + c.slice(1);
}
