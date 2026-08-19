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
 *  THERE IS NO MANA BUDGET AT ALL, which is a deeper optimism than any of those and was unstated
 *  until 2026-08-19. `manaValue <= turn` gates each creature INDEPENDENTLY: nothing sums the mana
 *  values of the creatures deployed against the mana a deck could actually have, so turn 6 fields
 *  every drawn creature costing 6 or less at once. Adding ramp here would correct a constraint that
 *  does not exist -- the honest version is a goldfish simulator with a stated play policy, and that
 *  is a project rather than a coefficient. REFUSED deliberately;
 *  `specs/2026-08-19-clock-and-mana-model-review.md` §3. */
export function expectedPower(
  deck: readonly DeckCard[],
  turn: number,
  opts: { commanderNames?: readonly string[] } = {},
): number {
  const commanders = new Set(opts.commanderNames ?? []);
  const library = deck.filter((dc) => !commanders.has(dc.card.name));
  if (library.length === 0) return 0;
  const drawnFraction = Math.min(1, seen(turn) / library.length);

  let total = 0;
  for (const dc of deck) {
    if (isLand(dc) || !isCreature(dc)) continue;
    const power = Number(dc.card.power);
    // `*`, `1+*` and a missing power are NaN. A creature whose size is a board state contributes
    // nothing rather than poisoning the whole curve -- and every clock derived from it -- with NaN.
    if (!Number.isFinite(power) || power <= 0) continue;
    if (dc.card.manaValue > turn) continue;
    // The commander is in the command zone every game: available with probability 1, not drawn.
    total += power * (commanders.has(dc.card.name) ? 1 : drawnFraction);
  }
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
  opts: { commanderNames?: readonly string[] } = {},
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
  opts: { commanderNames?: readonly string[] } = {},
): number | undefined {
  return pressureCurve(deck, opts).find((p) => p.cumulative >= STARTING_LIFE)?.turn;
}
