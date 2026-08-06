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

/** A pair the DERIVED engine says nothing about, in either direction. */
export interface SilentPair {
  deck: string;
  a: string;
  b: string;
  /** Does the FLAT engine claim this pair? Flat is ~4x the volume of derived, so this marks the
   *  region today's gates emptied — where a real loss would hide. */
  flatClaims: boolean;
  /** Theme tags both cards carry (`cardThemeTags`). Cards in one theme are where a missed synergy is
   *  likely, which is what makes this stratum worth over-sampling. */
  sharedThemes: string[];
}

export type Stratum = "lost" | "plausible" | "base";

/** Which stratum a silent pair belongs to. LOST outranks PLAUSIBLE: a pair can be both, and
 *  "did the gates cut real signal" is the question this measurement exists to answer. */
export function stratumOf(p: SilentPair): Stratum {
  if (p.flatClaims) return "lost";
  return p.sharedThemes.length > 0 ? "plausible" : "base";
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
