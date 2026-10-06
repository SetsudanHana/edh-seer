/** THE QUALITY FIT (spec docs/superpowers/specs/2026-09-27-card-quality-per-role-design.md, §Fitting).
 *
 *  Per role, a logistic model on ingredient DIFFERENCES (add − cut) over the swaps players make in
 *  precons: the card they cut against the same-role card they add instead. No intercept, and each
 *  weight is projected onto the sign the rules allow (`SIGN`): cheaper, broader, exile, better timing
 *  can never count against a card. Pure and deterministic -- the generator is the only caller that
 *  touches disk. */
import { ROLES, type Ingredient, type Ingredients, type Role } from "./quality.js";

export interface RoleWeights {
  weights: Partial<Record<Ingredient, number>>;
  pairs: number;
  heldOutAccuracy: number;
  baselineAccuracy: number;
  /** The fallback's held-out accuracy, so the choice between fit and fallback
   *  is visible, not only the fit's comparison with mana value alone. */
  fallbackAccuracy: number;
  fallback: boolean;
}
export interface QualityWeights { deriveVersion: number; rulesVersion: number; roles: Record<Role, RoleWeights> }
export interface Pair { role: Role; set: string; cut: Ingredients; add: Ingredients; weight: number }

/** +1: more is better. −1: more is worse. */
export const SIGN: Record<Ingredient, 1 | -1> = {
  manaValue: -1, rateFloor: 1, rateCeiling: 1, frequency: 1, timing: 1, breadth: 1,
  permanence: 1, oneSided: 1, drawback: -1, extraValue: 1, restriction: -1, amount: 1,
};
/** Below this many pairs a role's fit is noise: it ships on the fallback (spec). */
const MIN_PAIRS = 150;
/** THE FALLBACK, per role (#691). An EFFECT ranks by the owner's 2026-09-23 ladder -- frequency class,
 *  then amount per mana (the rate percentile, where the role has one), then mana value, then timing --
 *  written as weights so steep that each rung only breaks ties in the one above: frequency 0-4 x 1e6,
 *  rateFloor 0-100 (whole percentiles) x 1e3, manaValue x -2 (holds under 500 mana; the corpus tops out
 *  at 16), timing 0-2 x 0.5. An ANSWER ranks on mana value
 *  and timing, as before: moving protection, wipes and counters onto the ladder lost agreement on each
 *  (protection 24 -> 18 of 32 cuts), and the fitted removal weights put timing far above frequency too.
 *  CEILING: a yield card whose rate cannot be read (1,253 of 3,283 scored draw cards, 660 of 1,576 ramp,
 *  2026-09-28) adds no rate term, so it sorts below every card with one in its frequency class. Upgrade
 *  path: read those rates (a conditional draw, an extra-cost activation) rather than impute one. */
const ANSWER_ROLES: ReadonlySet<Role> = new Set(["targetedRemoval", "stackInteraction", "boardWipe", "protection"]);
export const fallbackWeights = (role: Role): Partial<Record<Ingredient, number>> =>
  ANSWER_ROLES.has(role) ? { manaValue: -1, timing: 0.5 } : { frequency: 1e6, rateFloor: 1e3, manaValue: -2, timing: 0.5 };
const SEED = 20260927;

/** Ingredients present on BOTH sides only: a missing one carries no signal, never a 0. */
function diff(p: Pair): Partial<Record<Ingredient, number>> {
  const out: Partial<Record<Ingredient, number>> = {};
  for (const k of Object.keys(SIGN) as Ingredient[]) {
    const a = p.add[k], c = p.cut[k];
    if (a !== undefined && c !== undefined) out[k] = a - c;
  }
  return out;
}

const dot = (w: Partial<Record<Ingredient, number>>, x: Partial<Record<Ingredient, number>>): number =>
  (Object.entries(x) as [Ingredient, number][]).reduce((s, [k, v]) => s + (w[k] ?? 0) * v, 0);

export function fitRole(train: Pair[], opts: { epochs?: number; lr?: number } = {}): Partial<Record<Ingredient, number>> {
  const epochs = opts.epochs ?? 400, lr = opts.lr ?? 0.05;
  const w: Partial<Record<Ingredient, number>> = {};
  const rows = train.map((p) => ({ x: diff(p), weight: p.weight }));
  for (let e = 0; e < epochs; e++) {
    for (const { x, weight } of rows) {
      const g = (1 - 1 / (1 + Math.exp(-dot(w, x)))) * weight; // gradient of log σ(w·x)
      for (const [k, v] of Object.entries(x) as [Ingredient, number][]) {
        const next = (w[k] ?? 0) + lr * g * v;
        w[k] = SIGN[k] === 1 ? Math.max(0, next) : Math.min(0, next);
      }
    }
  }
  for (const k of Object.keys(w) as Ingredient[]) if (w[k] === 0) delete w[k];
  return w;
}

/** Weighted share of pairs the weights order correctly (the add above the cut). A TIE COUNTS HALF:
 *  a pair the weights cannot separate -- same mana value, or no shared ingredient -- is a coin flip,
 *  and counting it a miss put every role below 50% before the fit had said anything. */
export function pairAccuracy(pairs: Pair[], weights: Partial<Record<Ingredient, number>>): number {
  let right = 0, total = 0;
  for (const p of pairs) {
    total += p.weight;
    const z = dot(weights, diff(p));
    if (z > 0) right += p.weight;
    else if (z === 0) right += p.weight / 2;
  }
  return total > 0 ? right / total : 0;
}

function hash(s: string, seed: number): number {
  let h = seed >>> 0;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 2654435761) >>> 0;
  return h / 2 ** 32;
}

/** A whole SET is held out or trained on, never split: an unseen product is the honest test. */
export function splitBySet(pairs: Pair[], seed: number, heldOutShare: number): { train: Pair[]; test: Pair[] } {
  const held = (set: string) => hash(set, seed) < heldOutShare;
  return { train: pairs.filter((p) => !held(p.set)), test: pairs.filter((p) => held(p.set)) };
}

/** A PAIR IS USABLE only when both sides carry the two ingredients every role reads: a side the locator
 *  found nothing on is no comparison, and counting it inflated the pair counts (ramp read 526 of which
 *  219 had an empty side, final review). */
export const usablePair = (p: Pair): boolean =>
  p.cut.manaValue !== undefined && p.cut.timing !== undefined && p.add.manaValue !== undefined && p.add.timing !== undefined;

export function fitAll(pairs: Pair[], versions: { deriveVersion: number; rulesVersion: number }): QualityWeights {
  const roles = {} as Record<Role, RoleWeights>;
  for (const role of ROLES) {
    const mine = pairs.filter((p) => p.role === role && usablePair(p));
    const { train, test } = splitBySet(mine, SEED, 0.2);
    const weights = fitRole(train);
    const heldOutAccuracy = pairAccuracy(test, weights);
    const baselineAccuracy = pairAccuracy(test, { manaValue: -1 });
    const fallbackAccuracy = pairAccuracy(test, fallbackWeights(role));
    const fallback = mine.length < MIN_PAIRS || heldOutAccuracy <= baselineAccuracy;
    roles[role] = { weights: fallback ? fallbackWeights(role) : weights, pairs: mine.length, heldOutAccuracy, baselineAccuracy, fallbackAccuracy, fallback };
  }
  return { ...versions, roles };
}
