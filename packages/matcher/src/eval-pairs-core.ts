import type { Reason } from "@edh-seer/engine";
import type { DeckCard } from "./types.js";
import { cardThemeTags } from "./edges.js";
import { categoryMatches, type MechanismCategory } from "./mechanisms.js";

/** One curated gold synergy pair. `verified` gates whether eval counts it. */
export interface CompassPair {
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
export function classifyPair(pair: CompassPair, reasons: Reason[], a: DeckCard, b: DeckCard): Outcome {
  const matched = reasons.find((r) => categoryMatches(r, pair.category));
  if (matched) return { status: "PASS", matchedReason: matched, reasons };
  if (reasons.length > 0) return { status: "WRONG-REASON", reasons };
  const noEdgeCause: NoEdgeCause =
    themeTagCount(a) === 0 ? "MISSING-TAG-A" : themeTagCount(b) === 0 ? "MISSING-TAG-B" : "NO-LINKING-RULE";
  return { status: "NO-EDGE", reasons, noEdgeCause };
}

/** One curated pair that must NEVER join on this category. The mirror of `CompassPair`.
 *
 *  `compass-pairs.json` asks only "did we find the edge" and reads 55/55 — a score an engine that
 *  joined EVERY pair would also get. These are the other half of the equivalence-class set: one
 *  representative per CLASS of false edge, so a mesh regression fails on a NAME instead of drifting
 *  through a percentage. The class names are the panel's own `cause` values, and each row is drawn
 *  from a judged FALSE verdict rather than invented. */
export interface AntiPair {
  a: string;
  b: string;
  /** The TAG the panel judged false, e.g. `cast:any`. NOT a `MechanismCategory` -- the positive
   *  compass keys on a category (`spellslinger`), but a FALSE verdict is recorded against the exact
   *  tag that was wrong, and mapping those onto categories would invent a judgement the evidence
   *  does not contain. */
  tag: string;
  /** The panel's own `cause` value: false-care, subject-mismatch, false-emit, generic,
   *  self-reference, consumer-qualifier, intervening-if. One representative per class. */
  class: string;
  why: string;
}

/** Does the engine wrongly join this pair on the category it must never join on?
 *
 *  Deliberately narrower than "are there any reasons": two cards may legitimately relate through
 *  some OTHER mechanism, and failing that would make the guard un-satisfiable. Abstruse
 *  Appropriation and Nulldrifter do join under another tag today, and only the `cast:any` claim is
 *  the false one. */
export function classifyAntiPair(pair: AntiPair, reasons: Reason[]): "clean" | "false-edge" {
  return reasons.some((r) => r.tag === pair.tag) ? "false-edge" : "clean";
}
