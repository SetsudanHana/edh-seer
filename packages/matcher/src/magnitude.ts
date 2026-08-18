/** THE SUPPLY:DEMAND DISCOUNT — `m = min(1, GLUT / R)^BETA`, applied per TAG and per DIRECTION.
 *
 *  Design and every number below: `specs/2026-08-18-edge-magnitude-design.md`.
 *
 *  DISCOUNT ONLY, never a premium. Ratings are deck-relative (`score / deckMax`), so when glutted
 *  feeders fall the scarce payoff rises by renormalisation without its raw score moving; an
 *  explicit premium would double-pay it, and would fire in all 71 decks because every deck has a
 *  scarcest tag by construction. Attenuating a claimed signal is the correct failure direction.
 *
 *  THE DEADBAND IS NOT DECORATION. At the `rate` and `avail` weightings the MEDIAN row across the
 *  71 decks is parity (1.0:1 and 1.1:1), so a parity-anchored `min(1, other/own)` would discount
 *  about half the population -- normal deckbuilding -- and would cut a 53-caster spellslinger
 *  feeder to 1/53 of its credit, when the panel says that family stands 85 real / 3 false.
 *  GLUT = 3 leaves 987 of 1,456 rows (67.8%) untouched on the supply side. */
import { ratio, type SupplyDemandRow } from "./supply-demand.js";

/** Event families the discount may touch: verbs where supply and demand are genuinely two sides of
 *  one resource.
 *
 *  An ALLOW-LIST, never a reject-list -- the `FRONT_FACE_ONLY` precedent. A verb family printed
 *  after this ships is silently EXCLUDED (unscored, the honest failure) rather than silently
 *  CRUSHED. `static`, `tutor` and `ramp-target` are the measured exclusions: 267 of 1,456 rows
 *  whose medians are 0.1-0.3 because they are one-to-many by construction (one anthem against
 *  every creature it buffs), carrying 156 of the 208 demand-starved rows. `clone` is out for the
 *  same shape at 2 rows. */
export const MAGNITUDE_VERBS: ReadonlySet<string> = new Set([
  "enters", "leaves", "dies", "cast", "sacrifice", "creates", "create-token",
  "graveyard-recursion", "draw", "discard", "mill", "counter-added", "proliferate",
  "combat-damage", "non-combat-damage", "gain-life", "lose-life", "attacks",
  "taps", "untaps", "scales",
]);

export interface MagnitudeOptions {
  /** Ratios at or below this are untouched. Seeded at 3. */
  glut: number;
  /** Curve exponent. 0 disables the whole term, which is why it lives in config. Seeded at 0.5. */
  beta: number;
}

/** Per-tag multipliers for the two directions. A tag absent from a map means 1 — callers should
 *  read them with `?? 1` so an unlisted tag can never be scored as zero. */
export function magnitudeMultipliers(
  rows: readonly SupplyDemandRow[],
  opts: MagnitudeOptions,
): { feeder: Map<string, number>; payoff: Map<string, number> } {
  const feeder = new Map<string, number>();
  const payoff = new Map<string, number>();
  if (opts.beta <= 0) return { feeder, payoff };

  for (const row of rows) {
    if (!MAGNITUDE_VERBS.has(row.key.split(":")[0])) continue;
    const r = ratio(row, "avail");
    if (r === null) continue;
    // Supply glut discounts the FEEDER's credit; demand glut discounts the marginal PAYOFF's.
    if (r > opts.glut) feeder.set(row.key, Math.pow(opts.glut / r, opts.beta));
    else if (r < 1 / opts.glut) payoff.set(row.key, Math.pow(opts.glut * r, opts.beta));
  }
  return { feeder, payoff };
}
