/** "REPEAT THIS PROCESS" IS A LOOP (#1335, owner ruling 2026-11-26): the clause's own sentence (reminder text stripped: Jadelight Ranger's explore reminder says "then repeat this process" and the card does not loop) names a repetition of the effect before it.
 *  The store files the sentence as a `trigger-again` action, which the printed-verb guard (#1321) correctly drops (nothing triggers again), so the loop was lost with it. Read off the printed words:
 *  - `unbounded`: the player chooses the count ("any number of times", "as many times as they choose": Ad Nauseam, Kindle the Carnage, Trade Secrets);
 *  - `fixed`: a stated count ("repeat this process once", "two more times", "X more times", "for an enchantment and a planeswalker": Claim Jumper, Research // Development);
 *  - `conditional`: anything else ("If you do, repeat this process", "repeat this process until ..."). Unlabelled beats mislabelled, so a repetition with a stated end is the conditional one only when no count is stated.
 *  CEILING: the first "repeat this process" of the clause names its shape; a clause with two (Kathril's "repeat this process for ..." beside another) reads as its first. */
export type Loop = "conditional" | "unbounded" | "fixed";

const REPEAT = /\brepeat (?:this|the) process\b([^.]{0,80})/i;
const UNBOUNDED = /^\s+(?:any number of times|as many times as)/i;
const FIXED = /^\s+(?:once\b|twice\b|(?:\w+|x) more times?\b|for\b)/i;

export function loopOf(clauseText: string | undefined): Loop | undefined {
  if (!clauseText) return undefined;
  // Linear: the parenthesis is stripped by a bounded, non-nested pattern (CodeQL js/polynomial-redos).
  const printed = clauseText.replace(/\([^()]{0,400}\)/g, " ");
  const m = REPEAT.exec(printed);
  if (!m) return undefined;
  const tail = m[1] ?? "";
  return UNBOUNDED.test(tail) ? "unbounded" : FIXED.test(tail) ? "fixed" : "conditional";
}
