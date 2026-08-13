import type { DeckReport } from "@mtg/engine";

/** A deck card. Facet values are FIELDS, never nodes -- see
 *  docs/superpowers/specs/2026-08-13-deck-graph-presentation-design.md §1. */
export interface WireGraphNode {
  /** Card name. */
  id: string;
  label: string;
  /** How many copies the deck holds. Every copy collapses into one node, so a deck's 24 basic
   *  Mountains are one disc; this is where the count survives so the node can say so. */
  copies: number;
  types: string[];
  subtypes: string[];
  supertypes: string[];
  colors: string[];
  cmc: number;
  /** Functional BUILD roles the report gave this card. Absent when it had none -- not the same as
   *  an empty array. Kept as plain strings so this file need not depend on @mtg/matcher. */
  roles?: string[];
  artCrop?: string;
}

export interface WireGraphEdge {
  from: string;
  to: string;
  weight: number;
  tags: string[];
  /** Reason texts, for the inspector. The full `Reason` objects stay server-side. */
  reasonTexts: string[];
}

export interface WireGraph {
  nodes: WireGraphNode[];
  edges: WireGraphEdge[];
  undirectedReasons: number;
  offDeckReasons: number;
}

export interface AnalyzeResponse {
  report: DeckReport;
  missing: string[];
  resolvedCount: number;
  totalCount: number;
  commanderColorIdentity: string[];
  /** The deck as a card-level graph: one node per distinct card, one edge per producer/consumer
   *  pair carrying at least one synergy reason. Computed alongside the report rather than behind a
   *  second endpoint, because the expensive half -- resolving every card and its tags -- is
   *  already done here. */
  graph: WireGraph;
}
