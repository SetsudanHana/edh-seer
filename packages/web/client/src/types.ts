import type { DeckReport } from "@mtg/engine";
import type { CardGraph, GraphNode, GraphEdge, NodeKind, EdgeKind } from "@mtg/matcher";

export type { DeckReport, CardGraph, GraphNode, GraphEdge, NodeKind, EdgeKind };

export interface AnalyzeResponse {
  report: DeckReport;
  missing: string[];
  resolvedCount: number;
  totalCount: number;
  commanderColorIdentity: string[];
  graph: CardGraph;
}
