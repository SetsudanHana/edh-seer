import type { ImpactWeights } from "@mtg/engine";

export interface SaltPayload {
  /** Full commander card name(s), e.g. ["Inalla, Archmage Ritualist"]. */
  commanders?: string[];
  details: { synergy: { list: Record<string, unknown> } };
}

/** Recursively sum every `conditionScoring.total` found anywhere under a node. CommanderSalt nests
 *  scored conditions under per-card groups (replacements/triggers/statics/…), each with a single
 *  `conditionScoring` object; `total` is the per-condition score. */
function sumConditionScoring(node: unknown): number {
  if (node === null || typeof node !== "object") return 0;
  const obj = node as Record<string, unknown>;
  let sum = 0;
  const cs = obj.conditionScoring as { total?: unknown } | undefined;
  if (cs && typeof cs.total === "number") sum += cs.total;
  for (const v of Object.values(obj)) sum += sumConditionScoring(v);
  return sum;
}

/** Per-slug reference score: Σ of all conditionScoring.total in that card's synergy list entry. */
export function saltCardScores(payload: SaltPayload): Map<string, number> {
  const out = new Map<string, number>();
  for (const [slug, entry] of Object.entries(payload.details.synergy.list)) {
    out.set(slug, sumConditionScoring(entry));
  }
  return out;
}

/** Fractional ranks (1-based), ties share their average rank. */
function ranks(xs: number[]): number[] {
  const order = xs.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const r = new Array<number>(xs.length);
  let k = 0;
  while (k < order.length) {
    let j = k;
    while (j + 1 < order.length && order[j + 1].v === order[k].v) j++;
    const avg = (k + j) / 2 + 1; // average of 1-based positions k..j
    for (let m = k; m <= j; m++) r[order[m].i] = avg;
    k = j + 1;
  }
  return r;
}

/** Spearman rank correlation of two equal-length vectors. Returns 0 for degenerate (constant) input. */
export function spearman(a: number[], b: number[]): number {
  const n = a.length;
  if (n < 2) return 0;
  const ra = ranks(a);
  const rb = ranks(b);
  const mean = (n + 1) / 2;
  let cov = 0, va = 0, vb = 0;
  for (let i = 0; i < n; i++) {
    const da = ra[i] - mean, db = rb[i] - mean;
    cov += da * db; va += da * da; vb += db * db;
  }
  if (va === 0 || vb === 0) return 0;
  return cov / Math.sqrt(va * vb);
}

export interface DeckScores { salt: number[]; ours: number[] }

export type ScoreDeck = (w: ImpactWeights) => number[];

export function meanSpearman(decks: ScoreDeck[], salts: number[][], w: ImpactWeights): number {
  let sum = 0;
  for (let i = 0; i < decks.length; i++) sum += spearman(decks[i](w), salts[i]);
  return decks.length ? sum / decks.length : 0;
}

/** Σ (w − prior)² across all kind + repeatability + scaling + damping params. */
function l2FromPrior(w: ImpactWeights, prior: ImpactWeights): number {
  let s = 0;
  for (const k of Object.keys(prior.kinds)) s += (w.kinds[k] - prior.kinds[k]) ** 2;
  for (const k of Object.keys(prior.repeatability)) s += (w.repeatability[k] - prior.repeatability[k]) ** 2;
  for (const k of Object.keys(prior.scaling)) s += (w.scaling[k] - prior.scaling[k]) ** 2;
  s += (w.damping - prior.damping) ** 2;
  return s;
}

export function objective(
  decks: ScoreDeck[], salts: number[][], w: ImpactWeights, prior: ImpactWeights, lambda: number,
): number {
  return meanSpearman(decks, salts, w) - lambda * l2FromPrior(w, prior);
}

/** Mulberry32 — small deterministic PRNG so a fixed seed reproduces the fit. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clone(w: ImpactWeights): ImpactWeights {
  return { kinds: { ...w.kinds }, repeatability: { ...w.repeatability }, scaling: { ...w.scaling }, damping: w.damping };
}

/** Flat list of tunable param handles (get/set) over kinds, repeatability, scaling, and damping.
 *  `damping` must stay LAST — the fitter clamps the final param to [0,1] and all others to [0,3]. */
function params(w: ImpactWeights): { get: () => number; set: (v: number) => void }[] {
  const out: { get: () => number; set: (v: number) => void }[] = [];
  for (const k of Object.keys(w.kinds)) out.push({ get: () => w.kinds[k], set: (v) => (w.kinds[k] = v) });
  for (const k of Object.keys(w.repeatability)) out.push({ get: () => w.repeatability[k], set: (v) => (w.repeatability[k] = v) });
  for (const k of Object.keys(w.scaling)) out.push({ get: () => w.scaling[k], set: (v) => (w.scaling[k] = v) });
  out.push({ get: () => w.damping, set: (v) => (w.damping = v) });
  return out;
}

function clamp(v: number, hi: number): number { return Math.max(0, Math.min(hi, v)); }

/** Upper bound for tunable weight params (damping is separately bounded to 1). Above the highest
 *  seed prior (unbounded scaling = 2.5) so that prior is reachable, not floored by the clamp. */
const PARAM_MAX = 3;

// Helper: objective with param p temporarily set to `cur` (for baseline comparison).
function objAt(
  w: ImpactWeights, decks: ScoreDeck[], salts: number[][], prior: ImpactWeights, lambda: number,
  cur: number, p: { get: () => number; set: (v: number) => void },
): number {
  const now = p.get();
  p.set(cur);
  const o = objective(decks, salts, w, prior, lambda);
  p.set(now);
  return o;
}

export interface FitOpts {
  restarts: number;
  iterations: number;
  lambda: number;
  seed: number;
  /** Called once after each completed restart (for progress reporting). */
  onRestart?: () => void;
}

/**
 * Random-restart coordinate ascent. Each restart jitters the prior, then repeatedly tries ±step on
 * each param, keeping any change that raises the (regularized) objective, shrinking step over
 * iterations. Params are clamped to [0, 3] (damping to [0, 1]). Best-of-restarts wins.
 */
export function fitWeights(
  decks: ScoreDeck[], salts: number[][], prior: ImpactWeights, opts: FitOpts,
): ImpactWeights {
  const rand = rng(opts.seed);
  let best = clone(prior);
  let bestObj = objective(decks, salts, best, prior, opts.lambda);
  for (let r = 0; r < opts.restarts; r++) {
    const w = clone(prior);
    const ps = params(w);
    for (const p of ps) p.set(clamp(p.get() + (rand() - 0.5) * 0.4, p === ps[ps.length - 1] ? 1 : PARAM_MAX));
    let step = 0.25;
    for (let it = 0; it < opts.iterations; it++) {
      for (let pi = 0; pi < ps.length; pi++) {
        const p = ps[pi];
        const hi = pi === ps.length - 1 ? 1 : PARAM_MAX;
        const cur = p.get();
        const baseObj = objAt(w, decks, salts, prior, opts.lambda, cur, p);
        let accepted = false;
        for (const delta of [step, -step]) {
          p.set(clamp(cur + delta, hi));
          if (objective(decks, salts, w, prior, opts.lambda) > baseObj) { accepted = true; break; }
        }
        if (!accepted) p.set(cur);
      }
      step *= 0.8;
    }
    const o = objective(decks, salts, w, prior, opts.lambda);
    if (o > bestObj) { bestObj = o; best = clone(w); }
    opts.onRestart?.();
  }
  return best;
}

export interface LooResult { inSample: number; loo: number; fitted: ImpactWeights }

/** Leave-one-deck-out CV: fit on N−1 decks, score the held-out; report mean held-out Spearman
 *  (loo) and the all-decks fit's in-sample mean Spearman + fitted weights.
 *  `onProgress(done, total)` fires per completed restart across all (N+1) fits, for a progress bar. */
export function looCV(
  decks: ScoreDeck[], salts: number[][], prior: ImpactWeights, opts: FitOpts,
  onProgress?: (done: number, total: number) => void,
): LooResult {
  const total = (decks.length + 1) * opts.restarts;
  let done = 0;
  const fitOpts: FitOpts = { ...opts, onRestart: () => { done += 1; onProgress?.(done, total); } };
  const fitted = fitWeights(decks, salts, prior, fitOpts);
  const inSample = meanSpearman(decks, salts, fitted);
  let looSum = 0;
  for (let h = 0; h < decks.length; h++) {
    const trD = decks.filter((_, i) => i !== h);
    const trS = salts.filter((_, i) => i !== h);
    const w = fitWeights(trD, trS, prior, fitOpts);
    looSum += spearman(decks[h](w), salts[h]);
  }
  return { inSample, loo: decks.length ? looSum / decks.length : 0, fitted };
}
