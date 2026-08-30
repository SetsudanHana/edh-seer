import type { DeckReport } from "@edh-seer/engine";

export type { WireGraph, WireGraphNode, WireGraphEdge } from "@edh-seer/matcher/wire-graph";
import type { WireGraph } from "@edh-seer/matcher/wire-graph";

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
