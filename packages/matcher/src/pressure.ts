import { seen } from "@edh-seer/engine";
import type { DeckCard } from "./types.js";
import { countsAsLand } from "./typeline.js";

/** A Commander player's starting life. The CLOCK is measured against ONE opponent, and it is the
 *  horizon every availability figure is priced at, so it stays one opponent. The whole table is a
 *  separate SPEED (#1056, owner 2026-10-06): `deck-math.ts` reads the turn this curve reaches three
 *  opponents' 40, beside the clock, never instead of it. */
export const STARTING_LIFE = 40;

/** How far the curve is computed before giving up on a deck ever getting there. Twenty turns is
 *  well past any real EDH game, so a deck with no clock inside it has no clock at all. */
export const HORIZON = 20;

const isLand = (dc: DeckCard): boolean => countsAsLand(dc.card);
const isCreature = (dc: DeckCard): boolean => dc.card.typeLine.toLowerCase().includes("creature");

/** Expected attacking power on the board at `turn`.
 *
 *  Each creature contributes `power x P(drawn by turn) x [castable by turn]`, where P(drawn) is the
 *  hypergeometric mean -- `seen(turn) / library` -- and castable means its own mana value has
 *  arrived, the same deadline rule the mana audit uses.
 *
 *  WHAT THIS IS NOT. It is expected POWER, not expected damage: nobody blocks, nothing is removed,
 *  no creature has summoning sickness, and every body attacks every turn. Those all push the same
 *  way, so the absolute number is optimistic and should be read as a RATE for comparing decks
 *  rather than as damage a real game will produce. The one bias pushing the other way is ramp,
 *  which nothing here models.
 *
 *  THE MANA BUDGET, and it is OPTIONAL because the mana it needs is a SIMULATION. Without
 *  `manaBudget` this is the 2026-08-19 behaviour byte for byte: `manaValue <= turn` gates each
 *  creature INDEPENDENTLY, nothing sums what the board deployed against what it could pay, and turn
 *  6 fields every drawn creature costing 6 or less at once. That refusal was correct when it was
 *  written and its stated blocker -- "the honest version is a goldfish simulator with a stated play
 *  policy, and that is a project rather than a coefficient" -- was BUILT in the meantime
 *  (`goldfish.ts`), so the budget is a read off a model that already runs rather than a coefficient.
 *
 *  GIVEN A BUDGET: creatures are deployed CHEAPEST FIRST against the mana the board could have made
 *  by `turn`, cumulatively -- a board is built over several turns, so the 3-drop cast on turn three
 *  and the 4-drop on turn four together cost seven of the ten mana turns one to four produced. The
 *  per-creature `manaValue <= turn` gate stays on top of it: mana empties each step (CR 500.5), so
 *  banking three turns of it does not cast a nine-drop on turn three.
 *
 *  CHEAPEST FIRST because that is rule 3's own policy one module over, not because it is optimal --
 *  it maximises BODIES rather than power, and a player holding a bomb plays differently. Same
 *  ceiling direction as everything else here.
 *
 *  IT IS STILL A CEILING, and the reason is worth stating: the budget is every point of mana the
 *  board produced, and a real deck spends some of it on removal, on draw, and on the accelerants
 *  that produced the rest. Nothing here deducts that, so the budget over-credits -- it is merely
 *  FINITE, where the incumbent was infinite.
 *  `specs/2026-08-19-clock-and-mana-model-review.md` §3, roadmap L4. */
export function expectedPower(
  deck: readonly DeckCard[],
  turn: number,
  opts: PressureOpts = {},
): number {
  const commanders = new Set(opts.commanderNames ?? []);
  const library = deck.filter((dc) => !commanders.has(dc.card.name));
  if (library.length === 0) return 0;

  // THE DEADLINE IS THE MANA, NOT THE TURN, WHEN THERE IS A MANA CURVE TO ASK. `manaValue <= turn`
  // is a proxy for a board nothing modelled, and it is the RAMP half of the cascade: a deck that
  // accelerates had its fatties dated by the calendar, so its clock read late, and a late clock
  // OVERSTATES availability downstream. With a curve, an eight-drop is castable the turn the board
  // makes eight. Both halves move and they move in opposite directions -- a ramp deck deploys its
  // top end EARLIER, a creature-dense deck deploys FEWER of them -- which is why this is a
  // correction rather than a discount.
  const affordableThisTurn = affordableAt(opts.manaBudget, turn);
  const deployable: { manaValue: number; power: number; available: number }[] = [];
  for (const dc of deck) {
    if (isLand(dc) || !isCreature(dc)) continue;
    if (opts.include && !opts.include(dc)) continue;
    const power = opts.weight ? opts.weight(dc) : Number(dc.card.power);
    // `*`, `1+*` and a missing power are NaN. A creature whose size is a board state contributes
    // nothing rather than poisoning the whole curve -- and every clock derived from it -- with NaN.
    if (!Number.isFinite(power) || power <= 0) continue;
    if (dc.card.manaValue > affordableThisTurn) continue;
    // The commander is in the command zone every game: available with probability 1, not drawn.
    deployable.push({
      manaValue: dc.card.manaValue,
      power,
      available: commanders.has(dc.card.name) ? 1 : drawnBy(dc, turn, library.length, opts.seen),
    });
  }

  if (opts.manaBudget === undefined) {
    return deployable.reduce((n, c) => n + c.power * c.available, 0);
  }

  // A creature is EXPECTED, not present, so it costs its mana value times the odds you have it --
  // the same fractional frame the power side already uses, and the only one that keeps a budget
  // commensurable with a hypergeometric board.
  let budget = manaBy(opts.manaBudget, turn);
  let total = 0;
  for (const c of [...deployable].sort((a, b) => a.manaValue - b.manaValue)) {
    const cost = c.manaValue * c.available;
    if (cost <= budget) {
      budget -= cost;
      total += c.power * c.available;
      continue;
    }
    // The last creature the budget can only part-pay for lands part of the time. Truncating it
    // instead would make the curve step, and a step in the curve is a step in the clock.
    total += c.power * c.available * (budget / cost);
    break;
  }
  return total;
}

/** The biggest mana value castable on `turn`: the turn itself with no simulation, else the simulated
 *  median mana that turn, growing by one a turn past the simulated rows (see `manaBy`). */
export function affordableAt(manaBudget: readonly number[] | undefined, turn: number): number {
  return manaBudget === undefined
    ? turn
    : (manaBudget[turn - 1] ?? (manaBudget[manaBudget.length - 1] ?? 0) + (turn - manaBudget.length));
}

/** THE ODDS A CARD IS ON THE BOARD BY `turn`, one card at a time: zero until its mana value is
 *  affordable, then drawn-by-then (the commander: always). `expectedPower`'s availability without its
 *  shared budget, for routes that count ARRIVALS rather than summing a board (the drain route). */
export function arrival(
  deck: readonly DeckCard[],
  opts: SimOpts = {},
): (dc: DeckCard, turn: number) => number {
  const commanders = new Set(opts.commanderNames ?? []);
  const library = deck.filter((dc) => !commanders.has(dc.card.name)).length;
  return (dc, turn) => {
    if (turn < 1 || dc.card.manaValue > affordableAt(opts.manaBudget, turn)) return 0;
    if (commanders.has(dc.card.name)) return 1;
    return drawnBy(dc, turn, library, opts.seen);
  };
}

/** WHAT THE SIMULATED GAMES SAY, passed to every curve: the commanders, the median mana by turn, and
 *  the share of each kind of card seen by turn (`SimulateResult.seenShare`, after mulligans). Each is
 *  optional; without `seen` a card is drawn by `seen(turn) / library`, the no-mulligan odds. */
export interface SimOpts {
  commanderNames?: readonly string[];
  manaBudget?: readonly number[];
  seen?: Readonly<Record<"land" | "cheap" | "dear", readonly number[]>>;
}

/** THE ODDS A LIBRARY CARD IS IN HAND BY `turn`: the simulated share for its kind when there is one
 *  (mulligans tilt kept hands toward lands and cheap plays), else `seen(turn) / library`. Past the
 *  simulated turns the share grows by one draw a turn. */
export function drawnBy(dc: DeckCard, turn: number, library: number, seenShare?: SimOpts["seen"]): number {
  if (library === 0) return 0;
  // THE SIMULATION'S OWN KIND TEST: a land by its FRONT face, as `simulate` reads it -- a spell with a
  // land back face is a spell there, and reading every face here gave it the land share (review).
  const land = isLand(dc);
  const col = seenShare?.[land ? "land" : dc.card.manaValue <= 3 ? "cheap" : "dear"];
  if (!col || col.length === 0) return Math.min(1, seen(turn) / library);
  if (turn <= col.length) return col[turn - 1]!;
  return Math.min(1, col[col.length - 1]! + (seen(turn) - seen(col.length)) / library);
}

/** `include`: which creatures count, all when absent; `weight`: what each delivers, its power when
 *  absent. The clock passes neither, so it cannot move; the whole-table combat speed leaves infect out
 *  (its damage to a player is poison, CR 702.90b), and the poison route weighs it. */
export interface PressureOpts extends SimOpts {
  include?: (dc: DeckCard) => boolean;
  /** What each creature delivers in place of its power (the poison route: infect power, toxic N). */
  weight?: (dc: DeckCard) => number;
}

/** Mana the board could have spent by `turn`, summed over every turn up to it.
 *
 *  PAST THE SIMULATED TURNS IT GROWS BY ONE A TURN, which is the land drop and nothing else. The
 *  simulation stops at twelve (`MAX_PRICED_TURN`) and this curve runs to twenty; holding the last
 *  simulated value flat instead would date a slow deck LATE, and a late clock is the one bias in
 *  this layer that FLATTERS the deck -- the exact cascade the budget exists to close. */
function manaBy(budget: readonly number[], turn: number): number {
  const last = budget[budget.length - 1] ?? 0;
  let total = 0;
  for (let t = 1; t <= turn; t++) total += t <= budget.length ? budget[t - 1] : last + (t - budget.length);
  return total;
}

export interface PressurePoint {
  turn: number;
  /** Expected attacking power on the board this turn. */
  power: number;
  /** Damage dealt by the end of this turn, if every point of it connected every turn. */
  cumulative: number;
}

/** The deck's pressure curve to the horizon: power per turn, and the running total. */
export function pressureCurve(
  deck: readonly DeckCard[],
  opts: PressureOpts = {},
): PressurePoint[] {
  const out: PressurePoint[] = [];
  let cumulative = 0;
  for (let turn = 1; turn <= HORIZON; turn++) {
    const power = expectedPower(deck, turn, opts);
    cumulative += power;
    out.push({ turn, power, cumulative });
  }
  return out;
}

/** The first turn the accumulated pressure reaches one opponent's starting life.
 *
 *  UNDEFINED, not a number, when the deck cannot get there inside the horizon. A deck that wins by
 *  mill or by an alt-win card has no combat clock, and naming turn 20 would invent one -- the same
 *  refusal `available: null` makes for a trigger the game supplies.
 *
 *  This is what §10.8 asks for: every target turn in this layer is a Tier C guess because nothing
 *  anchors it, and a clock derived from the deck's own board is an anchor. It is optimistic by
 *  construction (see `expectedPower`), so it ranks decks honestly and dates them generously. */
export function measuredClock(
  deck: readonly DeckCard[],
  opts: SimOpts = {},
): number | undefined {
  return pressureCurve(deck, opts).find((p) => p.cumulative >= STARTING_LIFE)?.turn;
}
