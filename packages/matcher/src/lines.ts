/** Threshold lines: what a deck must hold to reach a printed number.
 *
 *  Reads the resource ledger's three fields (`trigger.threshold`, `Ability.amount`, `Ability.cost`)
 *  and emits one record per threshold anchor. Pure -- no store, no I/O.
 *  Design: docs/superpowers/specs/2026-08-14-threshold-lines-design.md */

export type Growth =
  | { kind: "multiplicative"; factor: number }
  | { kind: "additive"; step: number }
  | { kind: "unknown" };

/** Word numerals the corpus actually uses. "two" is 6 instances; the rest are here so a single
 *  printing does not open a hole. */
const WORD_NUMERALS: Readonly<Record<string, number>> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

/** MULTIPLIERS ARE AN ENUMERATED LEXICON, NEVER A SUBSTRING TEST.
 *
 *  Measured over the derived corpus: 2,169 abilities carry an `amount`, 310 distinct values, and
 *  the entire multiplicative family is "double" x7, "triple" x2, "twice" x1, "double the number
 *  of" x1, "twice that many" x1.
 *
 *  `double strike` also appears as an amount and is a KEYWORD. A /double/ substring test classifies
 *  it as a x2 multiplier and hands a growth model to an ability that grows nothing -- the same shape
 *  as `\b\d+\b` reading "1,000" as 0 in the resource ledger. Both were found by printing the values
 *  rather than reasoning about them. */
const MULTIPLIERS: readonly [RegExp, number][] = [
  [/^doubles?\b/, 2],
  [/^twice\b/, 2],
  [/^triples?\b/, 3],
];

/** "half their life, rounded up", "half x, rounded down" -- 5 corpus instances. A shrinking
 *  multiplier never carries a resource toward a threshold, so it is not growth. Tested BEFORE the
 *  multiplier lexicon so nothing can read "half" as a factor. */
const SHRINKING = /^half\b/;

export function classifyGrowth(amount: string | undefined): Growth {
  if (amount === undefined) return { kind: "unknown" };
  const t = amount.trim().toLowerCase();
  if (t === "") return { kind: "unknown" };
  // A keyword that happens to start with a multiplier word. Checked first and by name.
  if (/^double strike\b/.test(t)) return { kind: "unknown" };
  if (SHRINKING.test(t)) return { kind: "unknown" };
  for (const [re, factor] of MULTIPLIERS) if (re.test(t)) return { kind: "multiplicative", factor };
  // A P/T amount ("+1/+1", "-1/-1") is a stat change, not a count. The slash is the whole tell.
  if (t.includes("/")) return { kind: "unknown" };
  // The thousands separator is stripped before parsing -- "1,000" is 1000, not 1. Same fix as the
  // resource ledger's threshold regex.
  const numeric = /^-?\d+(?:,\d{3})*$/.exec(t);
  if (numeric) {
    const n = parseInt(t.replace(/,/g, ""), 10);
    return n > 0 ? { kind: "additive", step: n } : { kind: "unknown" };
  }
  const word = WORD_NUMERALS[t];
  if (word !== undefined) return { kind: "additive", step: word };
  // "x" (106), "that many" (23), "that much" (22) and everything else: refused, never defaulted.
  return { kind: "unknown" };
}

/** How many times the amplifier must fire to carry `base` to `threshold`.
 *
 *  Multiplicative: ceil(log_f(N / b)). Additive: ceil((N - b) / k). The two answers differ by two
 *  orders of magnitude on the witnesses -- Calendar's 1,000 at x2 is 10, Simic Ascendancy's 20 at
 *  +1 is 20 -- which is the entire reason the classifier exists.
 *
 *  `undefined` for an unknown growth model, and for a multiplicative model with nothing to multiply.
 *  A refused answer is the point: a missing number beats a wrong one. */
export function iterationsNeeded(threshold: number, growth: Growth, base: number): number | undefined {
  if (base >= threshold) return 0;
  if (growth.kind === "additive") return Math.ceil((threshold - base) / growth.step);
  if (growth.kind === "multiplicative") {
    if (base <= 0) return undefined;
    return Math.ceil(Math.log(threshold / base) / Math.log(growth.factor));
  }
  return undefined;
}
