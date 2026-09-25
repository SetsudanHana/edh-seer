import type { DeckReport } from "@edh-seer/engine";
import type { GraphEdge, NodeKind, EdgeKind } from "@edh-seer/matcher";
import type { DeckAnalysis } from "@edh-seer/matcher/orchestrate";
import type { WireGraph, WireGraphNode } from "@edh-seer/matcher/wire-graph";

/** `CardGraph`/`GraphNode` used to re-export straight from `@edh-seer/matcher`'s projection types,
 *  which still advertise `props?` and know nothing of `roles`/`artCrop`. The shape the analysis
 *  actually returns is `WireGraph`/`WireGraphNode` (see `wire-graph.ts` for what gets stripped and
 *  why), so this aliases those rather than hand-copying the shape. Names kept as
 *  `CardGraph`/`GraphNode` since every client component already imports them under those names.
 *  `AnalyzeResponse` is `DeckAnalysis`, the one result `analyzeDecklist` returns; it pointed into
 *  the removed server's folder until 2026-09-25. */
export type CardGraph = WireGraph;
export type GraphNode = WireGraphNode;
export type AnalyzeResponse = DeckAnalysis;
export type { DeckReport, GraphEdge, NodeKind, EdgeKind };
