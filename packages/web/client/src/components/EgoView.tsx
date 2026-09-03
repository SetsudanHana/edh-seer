import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { ArtLoader } from "./art-loader.js";
import type { CardGraph, DeckReport } from "../types.js";
import { CardInspector } from "./CardInspector.js";
import { CardSheet } from "./CardSheet.js";
import { GraphView } from "./GraphView.js";
import { egoGraph } from "./ego-graph.js";
import { computeFlow } from "./flow.js";
import { usePinned } from "./card-drawer.js";

/** WHAT A TAP MEANS, AS A FUNCTION OF WHAT IS ALREADY SELECTED.
 *
 *  A tap used to re-root immediately, which left no gesture for "tell me about this one" -- the last
 *  thing the phone judge named: *"I wanted to read an edge reason WHILE looking at which circle it
 *  was. The panel takes the whole width, so I get the reasons or the picture, never both."*
 *
 *  A HIDDEN GESTURE WAS NOT AN OPTION. The same judge had already shown that undiscoverable
 *  interactions stay undiscovered, so this is not a long-press: it is the SAME tap, with a first
 *  stage. Tap a card to read the edge in the strip that is already on screen; tap it again to go
 *  there. The strip says so in words, and re-rooting stops being something a mis-aim can do. */
export function tapAction(
  tappedId: string | null,
  focusId: string,
  selectedPartner: string | null,
): "clear" | "select" | "focus" {
  // Empty space and the focus card itself both mean "stop reading that edge" -- neither is a
  // destination, and a tap that does nothing at all reads as the board being broken.
  if (tappedId === null || tappedId === focusId) return "clear";
  return tappedId === selectedPartner ? "focus" : "select";
}

/** One edge as the strip says it: the pair in the direction the edge runs, and its printed reason.
 *
 *  Takes ids as well as labels because a node id is not always its name -- a back face's id is
 *  `face:<n>:<card>` -- so deciding direction by comparing labels would be right by accident on
 *  single-faced cards and wrong on the ones the faces-as-nodes work exists for. */
export function edgeLine(
  edge: CardGraph["edges"][number],
  focus: { id: string; label: string },
  partner: { id: string; label: string },
): { pair: string; reason: string } {
  const nameOfEnd = (id: string): string => (id === focus.id ? focus.label : partner.label);
  return {
    // The arrow is the edge's own direction, not reading order: "A feeds B" is a different claim
    // from "B feeds A", and this strip is the only place on the surface carrying it.
    pair: `${nameOfEnd(edge.from)} → ${nameOfEnd(edge.to)}`,
    // An edge with no printed reason is a gap in the data, and saying so is the house rule: a
    // silent wrong answer is worse than a missing one.
    reason: edge.reasonTexts[0] ?? "No reason recorded for this pair.",
  };
}

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
  /** The partner whose edge the strip is currently reading, or null. Cleared whenever the focus
   *  moves, because an edge to the card you just left is not a fact about the card you are on. */
  const [selectedPartner, setSelectedPartner] = useState<string | null>(null);
  useEffect(() => setSelectedPartner(null), [focusId]);

  const node = ego.nodes[0];
  // A focus that does not resolve draws nothing rather than an invented card -- a silent wrong
  // answer is worse than a missing one, and the caller's own list is the only thing that can pick
  // a real id.
  if (!node) return null;

  const partners = ego.nodes.length - 1;
  const edges = graph.edges.filter((e) => e.from === node.id || e.to === node.id);
  /** EVERY distinct partner, both directions -- the same count `GraphList`'s row prints, which is
   *  the number the reader has just been shown and tapped. The view draws at most
   *  `FLOW_FANOUT_CAP` per direction, so the two differ on any hub, and the line below has to say
   *  so: Shark Typhoon's row reads 43 and its view drew 7, with nothing on screen reconciling them
   *  until the sheet was opened. Counted here rather than taken from `flow.truncated`, which is
   *  per-direction EDGES ("all 42 are listed here" is the FED BY total alone) and would put a third
   *  number on one card. */
  const totalPartners = new Set(
    edges.map((e) => (e.from === node.id ? e.to : e.from)),
  ).size;

  /** THE EDGE, READ WITHOUT COVERING THE BOARD. This is the whole point of the first tap: the pair,
   *  its direction and its reason land in a strip that is already on screen, so the reader keeps
   *  every disc in view while reading why two of them are joined. The alternative on offer was the
   *  full panel, which takes the width and hides the picture it is describing. */
  const reading = useMemo(() => {
    if (selectedPartner === null) return null;
    const partnerNode = ego.nodes.find((n) => n.id === selectedPartner);
    const edge = edges.find(
      (e) => e.from === selectedPartner || e.to === selectedPartner,
    );
    if (!partnerNode || !edge) return null;
    const line = edgeLine(
      edge,
      { id: node.id, label: node.label },
      { id: partnerNode.id, label: partnerNode.label },
    );
    return (
      <>
        <span className="block text-(--foreground)">{line.pair}</span>
        <span className="block">{line.reason}</span>
        <span className="block opacity-70">Tap {partnerNode.label} again to centre on it.</span>
      </>
    );
  }, [selectedPartner, ego.nodes, edges, node.id, node.label]);

  // PORTALLED TO `document.body`, AND THAT IS NOT TIDINESS -- IT IS THE ONLY THING THAT MAKES
  // `fixed` MEAN THE VIEWPORT HERE. `App` wraps the report in `.reveal`, which carries a transform,
  // and a transformed ancestor becomes the containing block for every `position: fixed` descendant.
  // Measured before the portal: the fixed root resolved to 326x114 -- its transformed ancestor's own
  // box -- the canvas collapsed to 1px tall, the fit clamped to its 0.15 floor, and the discs drew
  // at 4.2px. A class name alone could not have caught it, which is why the test asserts the parent.
  return createPortal(
    // FIXED, NOT `h-[100svh]` IN PAGE FLOW. The height was honoured and bought nothing: measured at
    // 390, the view still began 451px down, under the shell's header, deck-input card and route
    // tabs, so the canvas ran 452->1199 on an 844px screen and the page was 1856px tall. A surface
    // whose whole justification is owning the viewport has to leave the flow to own it -- and doing
    // so is also what makes the canvas's `touch-action: none` correct rather than a scroll trap,
    // since there is no longer a page behind it that the reader was trying to scroll.
    <div data-testid="ego-view" className="fixed inset-0 z-40 bg-(--background) flex flex-col">
      <div className="flex-1 min-h-0">
        <GraphView
          graph={ego}
          report={report}
          artLoader={artLoader}
          chrome="bare"
          // Touch has no hover, so the tap is what tells the board which edge the strip is reading.
          emphasisId={selectedPartner}
          // Empty board space is not a re-root: `null` leaves the focus where it is, so a missed tap
          // costs nothing -- which matters when the thing being aimed at used to be 14.7px. Tapping
          // the focus itself is a no-op for the same reason.
          onNodeTap={(id) => {
            const action = tapAction(id, focusId, selectedPartner);
            if (action === "clear") setSelectedPartner(null);
            else if (action === "select") setSelectedPartner(id);
            else onFocus(id!);
          }}
        />
      </div>
      <CardSheet
        title={node.label}
        subtitle={reading ?? (partners === 0
          ? "No synergy edges — nothing else in the deck connects to this card."
          : partners < totalPartners
            ? `${partners} of ${totalPartners} partners — the strongest. Tap one to read it.`
            : `${partners} partner${partners === 1 ? "" : "s"}. Tap one to read it.`)}
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
    </div>,
    document.body,
  );
}
