import { seen } from "@mtg/engine";
import type { DeckCard } from "./types.js";

/** A Commander player's starting life. The clock is measured against ONE opponent: a deck that can
 *  kill the table three times over is not three times as fast, it is a deck that has to attack
 *  three different players. */
export const STARTING_LIFE = 40;

/** How far the curve is computed before giving up on a deck ever getting there. Twenty turns is
 *  well past any real EDH game, so a deck with no clock inside it has no clock at all. */
const HORIZON = 20;

const isLand = (dc: DeckCard): boolean => dc.card.typeLine.toLowerCase().includes("land");
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
 *  per-creature `manaValue <= turn` gate stays on top of it: mana empties each step (CR 500.4), so
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
  opts: { commanderNames?: readonly string[]; manaBudget?: readonly number[] } = {},
): number {
  const commanders = new Set(opts.commanderNames ?? []);
  const library = deck.filter((dc) => !commanders.has(dc.card.name));
  if (library.length === 0) return 0;
  const drawnFraction = Math.min(1, seen(turn) / library.length);

  // THE DEADLINE IS THE MANA, NOT THE TURN, WHEN THERE IS A MANA CURVE TO ASK. `manaValue <= turn`
  // is a proxy for a board nothing modelled, and it is the RAMP half of the cascade: a deck that
  // accelerates had its fatties dated by the calendar, so its clock read late, and a late clock
  // OVERSTATES availability downstream. With a curve, an eight-drop is castable the turn the board
  // makes eight. Both halves move and they move in opposite directions -- a ramp deck deploys its
  // top end EARLIER, a creature-dense deck deploys FEWER of them -- which is why this is a
  // correction rather than a discount.
  const affordableThisTurn = opts.manaBudget === undefined
    ? turn
    : (opts.manaBudget[turn - 1] ?? (opts.manaBudget[opts.manaBudget.length - 1] ?? 0) + (turn - opts.manaBudget.length));
  const deployable: { manaValue: number; power: number; available: number }[] = [];
  for (const dc of deck) {
    if (isLand(dc) || !isCreature(dc)) continue;
    const power = Number(dc.card.power);
    // `*`, `1+*` and a missing power are NaN. A creature whose size is a board state contributes
    // nothing rather than poisoning the whole curve -- and every clock derived from it -- with NaN.
    if (!Number.isFinite(power) || power <= 0) continue;
    if (dc.card.manaValue > affordableThisTurn) continue;
    // The commander is in the command zone every game: available with probability 1, not drawn.
    deployable.push({
      manaValue: dc.card.manaValue,
      power,
      available: commanders.has(dc.card.name) ? 1 : drawnFraction,
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
  opts: { commanderNames?: readonly string[]; manaBudget?: readonly number[] } = {},
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
  opts: { commanderNames?: readonly string[]; manaBudget?: readonly number[] } = {},
): number | undefined {
  return pressureCurve(deck, opts).find((p) => p.cumulative >= STARTING_LIFE)?.turn;
}
