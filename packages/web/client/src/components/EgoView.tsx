import { useMemo } from "react";
import type { ArtLoader } from "./art-loader.js";
import type { CardGraph, DeckReport } from "../types.js";
import { CardInspector } from "./CardInspector.js";
import { CardSheet } from "./CardSheet.js";
import { GraphView } from "./GraphView.js";
import { egoGraph } from "./ego-graph.js";
import { computeFlow } from "./flow.js";
import { usePinned } from "./card-drawer.js";

/** ONE CARD'S GRAPH, OWNING THE VIEWPORT (roadmap R1, spec 2026-09-03).
 *
 *  The whole-deck board cannot be drawn on a phone at a size a thumb can aim at: the 24px floor is
 *  crossed at ~36 nodes and every deck here is 73-100, so at 390 the discs measured 14.7px and the
 *  phone judge's verdict on aiming at one was "I'd tap and accept whatever opened". This is the
 *  surface that replaces it -- the reader searches the list, taps a card, and gets that card's
 *  one-hop context with room for every disc.
 *
 *  A TAP RE-ROOTS. That is the "Expand on Demand" step: the tapped neighbour becomes the focus and
 *  brings its own context. It is also the phone judge's first condition -- see what a card connects
 *  to WITHOUT losing sight of the graph, which is exactly what the old overlay panel cost.
 *
 *  CEILING: no breadcrumb. Back returns to the list, not to the previously focused card, so a reader
 *  three expansions deep cannot step back one. Upgrade path is a focus stack in the caller, which is
 *  the same change that would put the focus in the URL (`/graph/:cardName`). */
export function EgoView(
  { graph, report, focusId, onFocus, onBack, artLoader }:
  {
    graph: CardGraph;
    report: DeckReport;
    focusId: string;
    onFocus: (id: string) => void;
    onBack: () => void;
    artLoader?: ArtLoader;
  },
) {
  const ego = useMemo(() => egoGraph(graph, focusId), [graph, focusId]);
  /** Only `truncated` is read by the panel, and it has to be computed over the FULL graph: the
   *  point of the sentence it feeds is that the view drew 6 of 42, which the ego graph alone can no
   *  longer say -- it IS the 6. */
  const flow = useMemo(() => computeFlow(graph.edges, [focusId]), [graph.edges, focusId]);
  /** Printed text by node id, from the FULL graph. Same rule the board follows: the panel's evidence
   *  disclosure is a claim about a card, and narrowing the graph must not remove the text that
   *  card's row is quoting. */
  const textById = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of graph.nodes) if (n.oracleText) m.set(n.id, n.oracleText);
    return (id: string) => m.get(id);
  }, [graph]);
  const { pinned, togglePin } = usePinned();

  const node = ego.nodes[0];
  // A focus that does not resolve draws nothing rather than an invented card -- a silent wrong
  // answer is worse than a missing one, and the caller's own list is the only thing that can pick
  // a real id.
  if (!node) return null;

  const partners = ego.nodes.length - 1;
  const edges = graph.edges.filter((e) => e.from === node.id || e.to === node.id);

  return (
    <div className="flex flex-col h-[100svh]">
      <div className="flex-1 min-h-0">
        <GraphView
          graph={ego}
          report={report}
          artLoader={artLoader}
          chrome="bare"
          // Empty board space is not a re-root: `null` leaves the focus where it is, so a missed tap
          // costs nothing -- which matters when the thing being aimed at used to be 14.7px. Tapping
          // the focus itself is a no-op for the same reason.
          onNodeTap={(id) => { if (id && id !== focusId) onFocus(id); }}
        />
      </div>
      <CardSheet
        title={node.label}
        subtitle={partners === 0
          ? "No synergy edges — nothing else in the deck connects to this card."
          : `${partners} partner${partners === 1 ? "" : "s"} on screen. Tap one to centre on it.`}
        onBack={onBack}
      >
        <CardInspector
          node={node}
          edges={edges}
          flow={flow}
          textOf={textById}
          // The sheet's own Back is the way out of this surface, and it is always on screen. Closing
          // the panel from inside it would leave the reader on a graph with no detail and no
          // explanation of what changed, so this collapses to a no-op by design.
          onClose={onBack}
          pinned={pinned.has(node.cardName ?? node.label)}
          onTogglePin={() => togglePin(node.cardName ?? node.label)}
        />
      </CardSheet>
    </div>
  );
}
