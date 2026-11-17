import type { Reason, SynergyEdge } from "@edh-seer/engine";
import type { DeckCard } from "./types.js";
import { cardThemeTags } from "./edges.js";
import { categoryMatches, type MechanismCategory } from "./mechanisms.js";

/** One curated gold synergy pair. `verified` gates whether eval counts it. */
export interface CompassPair {
  a: string;
  b: string;
  /** The mechanism the pair belongs to. With a `tag` it is only a label for the report ("donate",
   *  "spell-grant"): a case with no mechanism category is keyed on the tag instead. */
  category: MechanismCategory | string;
  /** THE EXACT REASON TAG that must join the pair (owner 2026-09-28: a fix the compass cannot see is
   *  a case it lacks). The categories also drive the report's archetype labels, so a case no category
   *  names -- a donation (`scales:donated`), a grant to spells -- is keyed here rather than by adding a
   *  category to the product just to measure it. The anti-pairs have always been keyed this way. */
  tag?: string;
  /** WHICH WAY, WHAT BADGE, WHAT WORDS (the #500/#506/#518/#530/#560 backfill): fixes that changed no
   *  tag, only whether a link reads EVERY TIME, once or once a turn, and what its sentence says. Each
   *  must hold on the SAME reason as the tag. */
  producer?: string;
  repeatability?: string;
  perTurn?: boolean;
  says?: string;
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
  const matched = reasons.find((r) => (pair.tag !== undefined ? r.tag === pair.tag : categoryMatches(r, pair.category as MechanismCategory))
    && (pair.producer === undefined || r.producer === pair.producer)
    && (pair.repeatability === undefined || r.repeatability === pair.repeatability)
    && (pair.perTurn === undefined || (r.perTurn === true) === pair.perTurn)
    && (pair.says === undefined || r.text.includes(pair.says)));
  if (matched) return { status: "PASS", matchedReason: matched, reasons };
  if (reasons.length > 0) return { status: "WRONG-REASON", reasons };
  const noEdgeCause: NoEdgeCause =
    themeTagCount(a) === 0 ? "MISSING-TAG-A" : themeTagCount(b) === 0 ? "MISSING-TAG-B" : "NO-LINKING-RULE";
  return { status: "NO-EDGE", reasons, noEdgeCause };
}

/** One curated pair that must NEVER join on this category. The mirror of `CompassPair`.
 *
 *  `compass-pairs.json` asks only "did we find the edge" and reads full marks — a score an engine that
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

/** Does `endpoint` (an edge end, keyed by FACE name on a multi-face card) name the physical card
 *  `name`? A token or third card never matches. */
function endpointIs(endpoint: string, name: string): boolean {
  return endpoint === name || name.split(" // ").includes(endpoint);
}

/** DECK-MODE JOIN (#728). The real pipeline's answer to "do these two cards join": a
 *  `SynergyEdge` whose two ENDS are the pair, in either direction, carrying at least one reason that
 *  does not run through a token node (a token can share a name with a card).
 *  Edges to a third card (the basics of the synthetic deck, a token node) never count -- an edge is
 *  keyed on its endpoints (`SynergyEdge.a`/`.b`), so a reason on a third-party edge is not the pair's. */
export function deckJoins(edges: readonly SynergyEdge[], a: string, b: string): boolean {
  return edges.some((e) =>
    e.reasons.some((r) => !r.producerIsToken && !r.consumerIsToken)
    && ((endpointIs(e.a, a) && endpointIs(e.b, b)) || (endpointIs(e.a, b) && endpointIs(e.b, a))));
}

/** One compass row's join answer in each mode. */
export interface ModeRow {
  /** `pair a / b`, for the printed list. */
  label: string;
  /** Joined by `pairReasons` in isolation (any reason). */
  iso: boolean;
  /** Joined by `analyzeDeckStructured` in the synthetic deck (`deckJoins`). NULL: deck mode could not
   *  build the deck for a row the isolated side resolved -- a disagreement, never a silent skip. */
  deck: boolean | null;
}

/** The rows whose isolated and deck answers differ -- in EITHER direction. */
export function modeDisagreements(rows: readonly ModeRow[]): ModeRow[] {
  return rows.filter((r) => r.iso !== r.deck);
}
