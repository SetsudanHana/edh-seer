import type { Reason } from "@mtg/engine";
import type { DeckCard } from "../types.js";
import { cardThemeTags } from "../edges.js";
import { categoryMatches, type MechanismCategory } from "../mechanisms.js";

/** One curated gold synergy pair. `verified` gates whether eval counts it. */
export interface GoldPair {
  a: string;
  b: string;
  category: MechanismCategory;
  note: string;
  source: string;
  verified: boolean;
}

export type Status = "PASS" | "WRONG-REASON" | "NO-EDGE";
export type NoEdgeCause = "MISSING-TAG-A" | "MISSING-TAG-B" | "NO-LINKING-RULE";

export interface Outcome {
  status: Status;
  /** The reason that matched the category (set only on PASS). */
  matchedReason?: Reason;
  /** All reasons emitted for the pair (for the WRONG-REASON dump). */
  reasons: Reason[];
  /** Sub-cause (set only on NO-EDGE). */
  noEdgeCause?: NoEdgeCause;
}

/** Count of a card's theme tags — 0 when untagged. Proxy for "carries a produces/cares tag". */
function themeTagCount(dc: DeckCard): number {
  return dc.tags ? cardThemeTags(dc.tags).size : 0;
}

/** Classify a gold pair from its emitted reasons and the two cards' tag state. */
export function classifyPair(pair: GoldPair, reasons: Reason[], a: DeckCard, b: DeckCard): Outcome {
  const matched = reasons.find((r) => categoryMatches(r, pair.category));
  if (matched) return { status: "PASS", matchedReason: matched, reasons };
  if (reasons.length > 0) return { status: "WRONG-REASON", reasons };
  const noEdgeCause: NoEdgeCause =
    themeTagCount(a) === 0 ? "MISSING-TAG-A" : themeTagCount(b) === 0 ? "MISSING-TAG-B" : "NO-LINKING-RULE";
  return { status: "NO-EDGE", reasons, noEdgeCause };
}
