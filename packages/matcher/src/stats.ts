import type { StatPredicate } from "@mtg/tagger";

/** Printed power/toughness may be "*", "1+*", "X", or null. A pure-integer string uses its value;
 *  anything else reads as 0 (matches printed base; deterministic). */
export function parseStat(s: string | null | undefined): number {
  if (typeof s !== "string") return 0;
  return /^-?\d+$/.test(s.trim()) ? Number(s.trim()) : 0;
}

/** Evaluate one predicate against a subject's concrete stats. `value` = constant rhs; `vs` = the
 *  subject's other metric. */
export function evalStatPredicate(
  pred: StatPredicate,
  s: { power: number; toughness: number; manaValue: number },
): boolean {
  const lhs = pred.metric === "power" ? s.power : pred.metric === "toughness" ? s.toughness : s.manaValue;
  const rhs = pred.value !== undefined ? pred.value : pred.vs === "power" ? s.power : s.toughness;
  switch (pred.op) {
    case "lte": return lhs <= rhs;
    case "gte": return lhs >= rhs;
    case "lt": return lhs < rhs;
    case "gt": return lhs > rhs;
    case "eq": return lhs === rhs;
  }
}
