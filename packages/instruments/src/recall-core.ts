/** The recall instrument: does the engine FIND the synergies that are there?
 *
 *  Spec: `docs/superpowers/specs/2026-08-05-edge-precision-measurement-design.md` §25, registered
 *  before any sample was drawn.
 *
 *  Everything else in this directory measures precision — when the engine speaks, is it right. This
 *  measures its silence. The two are not interchangeable: precision moved 62.1% → 79.7% on
 *  2026-08-06 while the derived population fell 19%, and every one of those fixes was measured on a
 *  frozen panel that §5.10 proved is blind outside its own 895 pairs. "Zero real claims lost" was
 *  true where it was measured and unverified everywhere else.
 *
 *  Pure, so the sampling frame and the arithmetic can be tested without a database. */

/** A pair the DERIVED engine says nothing about, in either direction.
 *
 *  The first frame (§25) carried `flatClaims` and `sharedThemes` and stratified on them. Both
 *  failed (§26.1): `cardThemeTags` keys on a card's OWN verbs and subjects, so a producer and its
 *  consumer routinely carry different tags — which is exactly what an edge IS — and flat's extra
 *  claims are mostly mesh. They are gone rather than kept alongside, because a stratifier that does
 *  not separate is not neutral: it splits the budget and buys nothing. */
export interface SilentPair {
  deck: string;
  a: string;
  b: string;
  /** Derived EMIT verbs per card name. */
  emits: Record<string, readonly string[]>;
  /** Derived TRIGGER verbs per card name. */
  triggers: Record<string, readonly string[]>;
  /** Did the card derive any ability at all? */
  hasAbilities: Record<string, boolean>;
  /** Does the card have real oracle text? Separates a cost-reducer that derives nothing from a basic
   *  land that has nothing to derive. */
  hasText: Record<string, boolean>;
}

export type Stratum = "verb-match" | "derive-empty" | "base";

/** Which stratum a silent pair belongs to.
 *
 *  Spec: `2026-08-06-recall-frame-rebuild-design.md` §3. Assignment is ordered, so the strata are
 *  disjoint and their measured populations (11,715 / 34,002 / 204,058) sum to the silent population.
 *
 *  VERB-MATCH first: one card emits verb V and the other triggers on V, which is the relation an
 *  edge is MADE of. Silence there means something else killed it — a subject filter, a control
 *  mismatch, a gate — so every miss arrives with its mechanism attached.
 *
 *  DERIVE-EMPTY second: a card with real text and no derived abilities cannot form an edge at all.
 *  Its silence has a known mechanical cause, which makes the stratum a quantification of how much
 *  the derivation layer drops wholesale rather than a test.
 *
 *  A card with no abilities AND no real text — a basic land — is BASE. Counting it as derive-empty
 *  would flood that stratum with pairs whose silence is correct by construction, which is how 143k
 *  trivially silent pairs ended up diluting the old BASE. */
export function stratumOf(p: SilentPair): Stratum {
  const matches = (x: string, y: string): boolean =>
    (p.emits[x] ?? []).some((v) => (p.triggers[y] ?? []).includes(v));
  if (matches(p.a, p.b) || matches(p.b, p.a)) return "verb-match";
  const empty = (x: string): boolean => p.hasAbilities[x] === false && p.hasText[x] === true;
  return empty(p.a) || empty(p.b) ? "derive-empty" : "base";
}

/** A worksheet row. Carries no stratum, no flat claim, no shared themes — see `blindRecall`. */
export interface RecallRow {
  id: number;
  a: string;
  b: string;
  aTypeLine?: string;
  bTypeLine?: string;
  aOracle?: string;
  bOracle?: string;
}

export type RecallVerdict =
  | "miss-expressible"
  | "miss-inexpressible"
  | "correct-silence"
  | "uncertain";

export interface RecallJudgment {
  id: number;
  verdict: RecallVerdict;
  note: string;
}

/** Strip every trace of the stratum and shuffle, so the judge sees only two cards and their text.
 *  Knowing a row came from the LOST stratum is a standing invitation to find a synergy in it, which
 *  is exactly the bias this measurement cannot afford. */
export function blindRecall(pairs: readonly SilentPair[], rng: () => number): RecallRow[] {
  const order = pairs.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order.map((idx, id) => ({ id, a: pairs[idx].a, b: pairs[idx].b }));
}

export interface RecallScore {
  missExpressible: number;
  missInexpressible: number;
  correctSilence: number;
  uncertain: number;
  /** Verdicts that count toward the rate: everything but `uncertain`. */
  decided: number;
  /** 1 − missExpressible/decided. Null when nothing was decided — a stratum with no evidence gets no
   *  number rather than a flattering 100%. */
  recall: number | null;
}

/** An INEXPRESSIBLE miss is a ceiling, not a defect — no `SubjectFilter` or verb in the vocabulary
 *  can carry "your second spell each turn" or an odd/even mana value. Counting it against the engine
 *  would make the number unreachable and stop it guiding anything, so it is reported beside the rate
 *  rather than inside it. */
export function scoreRecall(judgments: readonly RecallJudgment[]): RecallScore {
  const out: RecallScore = {
    missExpressible: 0, missInexpressible: 0, correctSilence: 0, uncertain: 0,
    decided: 0, recall: null,
  };
  for (const j of judgments) {
    if (j.verdict === "miss-expressible") out.missExpressible++;
    else if (j.verdict === "miss-inexpressible") out.missInexpressible++;
    else if (j.verdict === "correct-silence") out.correctSilence++;
    else out.uncertain++;
  }
  out.decided = out.missExpressible + out.missInexpressible + out.correctSilence;
  if (out.decided > 0) out.recall = 1 - out.missExpressible / out.decided;
  return out;
}

/** Recall pooled across strata, REWEIGHTED to the populations they were drawn from.
 *
 *  §26.2 reported 92.5% by pooling 120 judgments drawn at equal n from populations of 62,795 /
 *  15,591 / 172,570. That number is a property of the sampling weights, not of a deck: tripling the
 *  draw from the smallest stratum would have moved it without anything about the engine changing.
 *  Equal allocation is deliberate (it buys per-stratum resolution), so the reweighting has to happen
 *  here instead.
 *
 *  A stratum that decided nothing contributes no weight rather than a flattering 100% — the same
 *  reason `scoreRecall` returns null instead of 1. */
export function pooledRecall(
  strata: readonly { population: number; judgments: readonly RecallJudgment[] }[],
): number | null {
  let weight = 0;
  let acc = 0;
  for (const s of strata) {
    const score = scoreRecall(s.judgments);
    if (score.recall === null) continue;
    weight += s.population;
    acc += s.population * score.recall;
  }
  return weight === 0 ? null : acc / weight;
}
