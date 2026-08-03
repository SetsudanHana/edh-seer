import type { DeckReport } from "@mtg/engine";
import type { GraphEdge, NodeKind, EdgeKind } from "@mtg/matcher";
import type {
  AnalyzeResponse as WireAnalyzeResponse,
  WireGraph,
  WireGraphNode,
} from "../../server/src/analyze/analyze.types.js";

/** `CardGraph`/`GraphNode` used to re-export straight from `@mtg/matcher`, which still advertises
 *  `props?` and knows nothing of `roles`/`artCrop`. That's not what the server actually sends --
 *  `WireGraph`/`WireGraphNode` in the server's own `analyze.types.ts` is the true wire shape (see
 *  that file's doc comment for what gets stripped and why). Reconciled here by aliasing to the
 *  server's types rather than hand-copying the shape a third time, so this file stays the client's
 *  one source of truth without drifting from what actually arrives over HTTP. Names kept as
 *  `CardGraph`/`GraphNode` since every client component already imports them under those names. */
export type CardGraph = WireGraph;
export type GraphNode = WireGraphNode;
export type AnalyzeResponse = WireAnalyzeResponse;
export type { DeckReport, GraphEdge, NodeKind, EdgeKind };
