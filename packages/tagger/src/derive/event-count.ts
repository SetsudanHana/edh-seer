import type { EventCount, SubjectFilter } from "../schema.js";
import { parseSubject } from "./subject.js";

/** EDGE MAGNITUDE'S PRODUCER HALF (spec 2026-09-29 §4): how many events one use of an ability
 *  supplies, read from its recorded `amount` and its emit. First match wins; anything unread
 *  returns undefined, which the matcher shows as 1 and FLAGS -- a guessed number is worse. */
const WORD: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};
// No overlap between the space and the capture (review: CodeQL's polynomial-ReDoS check).
const SCALES = /\b(?:for each|the number of) ([^\s,.;][^,.;]*)/i;
// CEILING: read on the replacement's whole clause, which is the replacement sentence in every
// corpus template (replacement.ts); a clause holding a second, unrelated doubling would be misread.
const TWICE = /\btwice that many\b|\bdouble (?:that|the)\b/i;
const PLUS_ONE = /\bthat many plus one\b|^n\s*\+\s*1$/i;

export function countOf(
  amount: string | undefined,
  emit: { subject: SubjectFilter } | undefined,
  clauseText: string,
  replacement: boolean,
): EventCount | undefined {
  const a = (amount ?? "").trim().toLowerCase();
  // A CR 614 MULTIPLIER performs nothing of its own: its count is what it ADDS to the event it improves.
  if (replacement) {
    if (TWICE.test(clauseText) || /\btwice\b/.test(a)) return { floor: 1, ceiling: 1, sameAsImproved: true };
    if (PLUS_ONE.test(a) || PLUS_ONE.test(clauseText)) return { floor: 1, ceiling: 1 };
    return undefined;
  }
  if (/^\d+$/.test(a)) return { floor: Number(a), ceiling: Number(a) };
  if (WORD[a] !== undefined) return { floor: WORD[a]!, ceiling: WORD[a]! };
  const upTo = /^up to (\w+)$/.exec(a);
  if (upTo) {
    const n = /^\d+$/.test(upTo[1]!) ? Number(upTo[1]) : WORD[upTo[1]!];
    if (n !== undefined) return { floor: 0, ceiling: n };
  }
  const scaled = SCALES.exec(a);
  if (scaled) return { floor: 0, ceiling: null, scalesWith: parseSubject(scaled[1]!.trim()) };
  if (/\bx\b/.test(a)) return { floor: 0, ceiling: null, scalesWith: "mana" };
  // A BOARD-WIDE EMIT WITH NO AMOUNT ("destroy all creatures"): as many as the class holds.
  if (a === "" && emit && (emit.subject.scope === "all" || emit.subject.scope === "each")) {
    return { floor: 0, ceiling: null, scalesWith: emit.subject };
  }
  return undefined;
}
