/** The pure half of `commander-ramp.ts` (roadmap L2), split out so it is testable without Mongo —
 *  the same `*-core.ts` split `panel-score.ts` and `eval-pairs.ts` already use. */
import { classifyAccelerant, quantiles, type SimulateResult } from "../goldfish.js";
import type { DeckCard } from "../types.js";

const isLand = (dc: DeckCard): boolean => /\bland\b/i.test(dc.card.typeLine ?? "");

/** Per trial, the first turn the board could tap `mv` mana — or null if it never did.
 *
 *  CENSORING IS RETURNED, NEVER DROPPED. A trial that never gets there is exactly the case the
 *  commander's owner cares about, and averaging only the successes flatters the slow decks hardest. */
export function castTurns(r: SimulateResult, mv: number): (number | null)[] {
  const trials = r.manaAt[0]?.length ?? 0;
  const out: (number | null)[] = [];
  for (let i = 0; i < trials; i++) {
    let hit: number | null = null;
    for (let t = 1; t <= r.turns && hit === null; t++) if ((r.manaAt[t - 1]?.[i] ?? 0) >= mv) hit = t;
    out.push(hit);
  }
  return out;
}

export interface CastTurn { p25: string; median: string; p75: string; censored: number }

/** The median cast turn, reported as `>N` rather than invented when the quantile falls in the
 *  censored tail. Censored trials sort LAST, which is what makes that readable off `quantiles`. */
export function castTurnStats(turns: readonly (number | null)[], horizon: number): CastTurn {
  const n = turns.length;
  const censored = turns.filter((t) => t === null).length;
  // A censored trial is "later than the horizon", so it sorts above every real turn.
  const q = quantiles(turns.map((t) => t ?? horizon + 1));
  const fmt = (v: number): string => (v > horizon ? `>${horizon}` : String(v));
  return { p25: fmt(q.p25), median: fmt(q.median), p75: fmt(q.p75), censored: n === 0 ? 0 : censored / n };
}

/** The counterfactual deck: every `ramp` build-category member the simulator can classify is made
 *  INERT in place. Library size, land count and mana curve all stay fixed, so the two arms differ in
 *  exactly one thing. Lands are never silenced — that would change the land count too. */
export function silenceRamp(library: readonly DeckCard[], rampNames: ReadonlySet<string>): {
  deck: DeckCard[]; silenced: number; blind: number;
} {
  let silenced = 0, blind = 0;
  const deck = library.map((dc) => {
    if (isLand(dc) || !rampNames.has(dc.card.name)) return dc;
    if (!classifyAccelerant(dc)) { blind++; return dc; }
    silenced++;
    return { card: { ...dc.card, producedMana: [], oracleText: "" }, tags: null } as DeckCard;
  });
  return { deck, silenced, blind };
}

