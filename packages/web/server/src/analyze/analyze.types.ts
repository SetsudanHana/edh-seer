import type { DeckReport } from "@mtg/engine";
import type { GraphEdge, NodeKind } from "@mtg/matcher";

/** A `CardGraph` node as sent over the wire: most of `GraphNode.props` is stripped (`legalities`
 *  alone is 81KB across a graph), but `roles` (from the report, joined on by the `graph` dep) and
 *  `artCrop` (the one `props` entry worth its weight) ride along. */
export interface WireGraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  /** Functional BUILD roles (`BuildCategory[]` in @mtg/matcher, kept as plain strings here so this
   *  file doesn't need to depend on @mtg/matcher's build.ts) the report gave this card. Absent
   *  when the report had none for it -- not the same as an empty array. */
  roles?: string[];
  artCrop?: string;
}

export interface WireGraph {
  nodes: WireGraphNode[];
  edges: GraphEdge[];
}

export interface AnalyzeResponse {
  report: DeckReport;
  missing: string[];
  resolvedCount: number;
  totalCount: number;
  commanderColorIdentity: string[];
  /** The deck as a graph: card and characteristic nodes, plus reified `event:` nodes carrying the
   *  matcher's synergy edges. Computed alongside the report rather than behind a second endpoint,
   *  because the expensive half -- resolving every card and its tags -- is already done here. */
  graph: WireGraph;
}
