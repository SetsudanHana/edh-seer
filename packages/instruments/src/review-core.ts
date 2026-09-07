import type { CompassPair } from "@edh-seer/matcher/eval-pairs-core";

export type Decision = "accept" | "reject";

/** Indices of entries still awaiting human verification. */
export function pendingIndices(pairs: CompassPair[]): number[] {
  return pairs.flatMap((p, i) => (p.verified ? [] : [i]));
}

/** Apply one review decision: accept flips `verified` true; reject drops the entry. Returns a new array. */
export function applyDecision(pairs: CompassPair[], index: number, decision: Decision): CompassPair[] {
  if (decision === "reject") return pairs.filter((_, i) => i !== index);
  return pairs.map((p, i) => (i === index ? { ...p, verified: true } : p));
}
