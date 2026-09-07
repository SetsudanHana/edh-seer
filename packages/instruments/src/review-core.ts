import type { GoldPair } from "@edh-seer/matcher/eval-pairs-core";

export type Decision = "accept" | "reject";

/** Indices of entries still awaiting human verification. */
export function pendingIndices(pairs: GoldPair[]): number[] {
  return pairs.flatMap((p, i) => (p.verified ? [] : [i]));
}

/** Apply one review decision: accept flips `verified` true; reject drops the entry. Returns a new array. */
export function applyDecision(pairs: GoldPair[], index: number, decision: Decision): GoldPair[] {
  if (decision === "reject") return pairs.filter((_, i) => i !== index);
  return pairs.map((p, i) => (i === index ? { ...p, verified: true } : p));
}
