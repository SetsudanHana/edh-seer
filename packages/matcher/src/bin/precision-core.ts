/** Pure half of the edge-precision measurement (`docs/superpowers/specs/2026-08-05-edge-precision-
 *  measurement-design.md`): sampling, blinding, scoring. No database, no IO, so the part the whole
 *  measurement's credibility rests on is unit-testable and deterministic.
 *
 *  The compass cannot decide flat vs derived — it is saturated at 55/55 for both, and every gold
 *  pair asserts "these two SHOULD link", so a population that links everything scores perfectly.
 *  This measures the other half: of the edges each population reports, what share are real. */

export type Source = "flat" | "derived";

/** One reason as sampled, before blinding. */
export interface SampledReason {
  source: Source;
  deck: string;
  producer: string;
  consumer: string;
  tag: string;
}

/** One row as judged: the structured claim and nothing that reveals where it came from. */
export interface WorksheetRow {
  id: number;
  /** Index back into the pre-blinding array; the KEY file resolves it, the worksheet never does. */
  sourceIndex: number;
  producer: string;
  consumer: string;
  tag: string;
}

export type Verdict = "real" | "false" | "uncertain";

export interface Judgment {
  id: number;
  verdict: Verdict;
  /** For `false`: false-emit | false-care | subject-mismatch | direction | generic. */
  cause?: string;
  note: string;
}

export interface SourceScore {
  real: number;
  false: number;
  uncertain: number;
  /** `real / (real + false)`, or null when nothing was decided either way. */
  precision: number | null;
  interval: [number, number] | null;
  causes: Record<string, number>;
}

/** mulberry32: small, fast, and — the only property that matters here — reproducible from a seed
 *  recorded in the worksheet. Math.random cannot be seeded, which would let a sample be redrawn
 *  until it agreed with a preferred answer. */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Draw `n` items without replacement. Partial Fisher-Yates over a copy: unbiased, and it degrades
 *  to "everything, shuffled" when the pool is smaller than the request rather than looping forever. */
export function sample<T>(pool: readonly T[], n: number, rng: () => number): T[] {
  const items = [...pool];
  const take = Math.min(n, items.length);
  for (let i = 0; i < take; i++) {
    const j = i + Math.floor(rng() * (items.length - i));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items.slice(0, take);
}

/** Strip everything that identifies the population and shuffle both arms together.
 *
 *  `text` is never carried across: the reason's prose is templated per code path and is the
 *  likeliest leak of which population produced a row. `source` is the answer itself. What remains
 *  is the structured claim, which is what the rubric judges. */
export function blind(reasons: readonly SampledReason[], rng: () => number): WorksheetRow[] {
  const indices = sample(reasons.map((_, i) => i), reasons.length, rng);
  return indices.map((sourceIndex, id) => ({
    id,
    sourceIndex,
    producer: reasons[sourceIndex].producer,
    consumer: reasons[sourceIndex].consumer,
    tag: reasons[sourceIndex].tag,
  }));
}

/** Wilson score interval at 95%. Correct at the tails, where the normal approximation produces
 *  bounds outside [0,1] — which is exactly where a high-precision population sits. */
export function wilson(successes: number, total: number): [number, number] {
  if (total === 0) return [0, 1];
  const z = 1.959964;
  const p = successes / total;
  const denom = 1 + (z * z) / total;
  const centre = p + (z * z) / (2 * total);
  const spread = z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total));
  return [Math.max(0, (centre - spread) / denom), Math.min(1, (centre + spread) / denom)];
}

const emptyScore = (): SourceScore =>
  ({ real: 0, false: 0, uncertain: 0, precision: null, interval: null, causes: {} });

/** Tally judgments per source.
 *
 *  `uncertain` is excluded from the denominator on purpose: it is the judge declining to decide and
 *  escalating to the user, so scoring it either way would invent the verdict that was withheld. It
 *  is reported as a count instead — a large uncertain share is itself a finding about the rubric. */
export function score(
  judgments: readonly Judgment[],
  key: ReadonlyMap<number, Source>,
): Record<Source, SourceScore> {
  const out: Record<Source, SourceScore> = { flat: emptyScore(), derived: emptyScore() };
  for (const j of judgments) {
    const source = key.get(j.id);
    if (!source) continue;
    const s = out[source];
    if (j.verdict === "real") s.real++;
    else if (j.verdict === "false") {
      s.false++;
      const cause = j.cause ?? "unlabelled";
      s.causes[cause] = (s.causes[cause] ?? 0) + 1;
    } else s.uncertain++;
  }
  for (const s of Object.values(out)) {
    const decided = s.real + s.false;
    if (decided === 0) continue;
    s.precision = s.real / decided;
    s.interval = wilson(s.real, decided);
  }
  return out;
}

/** The pre-registered decision rule (spec §2): switch only when derived's interval clears flat's
 *  entirely. Returns null when either side has nothing decided, so "no data" never reads as a win. */
export function beatsBeyondNoise(scores: Record<Source, SourceScore>): boolean | null {
  const f = scores.flat.interval;
  const d = scores.derived.interval;
  if (!f || !d) return null;
  return d[0] > f[1];
}
