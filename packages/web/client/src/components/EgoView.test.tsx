import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { EgoView } from "./EgoView.js";
import { SAMPLE } from "../fixtures.js";
import type { CardGraph, GraphNode } from "../types.js";

// SAMPLE.graph is Krenko -> Impact Tremors and nothing else, so the orphan case needs its own
// fixture rather than a change to one four other suites assert against.
function loneGraph(): CardGraph {
  const node = (id: string): GraphNode => ({
    id, label: id, copies: 1, types: ["creature"], subtypes: [], supertypes: [], colors: ["R"], cmc: 2,
  } as GraphNode);
  return {
    nodes: [node("A"), node("B"), node("Alone")],
    edges: [{ from: "A", to: "B", weight: 1, reasonTexts: ["a"] } as CardGraph["edges"][number]],
    undirectedReasons: 0, offDeckReasons: 0,
  };
}

test("draws the focus card's own graph, not the whole deck", () => {
  const { container } = render(
    <EgoView graph={SAMPLE.graph} report={SAMPLE.report} focusId="Krenko, Mob Boss" onFocus={() => {}} onBack={() => {}} />,
  );
  expect(container.querySelector("canvas")).not.toBeNull();
  // Bare chrome: the whole-deck controls are absent, which is what buys the viewport.
  expect(screen.queryByLabelText("Find a card")).toBeNull();
  expect(screen.getByText("Krenko, Mob Boss")).toBeInTheDocument();
});

test("names the focus card and how many partners it has", () => {
  render(<EgoView graph={SAMPLE.graph} report={SAMPLE.report} focusId="Krenko, Mob Boss" onFocus={() => {}} onBack={() => {}} />);
  expect(screen.getByText(/1 partner\b/)).toBeInTheDocument();
});

// THE READER ARRIVED FROM A ROW SAYING "43 partners" AND THE VIEW DRAWS 7. That gap is real -- the
// fanout cap is 6 per direction and deliberate -- so the always-visible line has to reconcile it.
// It did not: it said "7 partners on screen" full stop, which reads as a contradiction of the row
// the reader just tapped, and the sentence that explains the cut ("the board draws the strongest
// 6 -- all 42 are listed here") sits inside the collapsed sheet where nobody meets it first.
test("the visible line reconciles what is drawn with the total the list promised", () => {
  const hub = "Hub";
  const nodes = [hub, ...Array.from({ length: 20 }, (_, i) => `P${i}`)].map((id) => ({
    id, label: id, copies: 1, types: ["creature"], subtypes: [], supertypes: [], colors: ["R"], cmc: 2,
  }));
  const edges = Array.from({ length: 20 }, (_, i) => ({
    from: `P${i}`, to: hub, weight: i + 1, tags: ["token"], reasonTexts: [`P${i} feeds Hub`],
  }));
  const graph = { nodes, edges, undirectedReasons: 0, offDeckReasons: 0 } as unknown as CardGraph;
  render(<EgoView graph={graph} report={SAMPLE.report} focusId={hub} onFocus={() => {}} onBack={() => {}} />);
  // 6 of 20: the fanout cap, against the count the list row shows for the same card.
  expect(screen.getByText(/6 of 20 partners/)).toBeInTheDocument();
  expect(screen.getByText(/strongest/)).toBeInTheDocument();
});

test("a card with no partners says so rather than drawing an empty box", () => {
  render(<EgoView graph={loneGraph()} report={SAMPLE.report} focusId="Alone" onFocus={() => {}} onBack={() => {}} />);
  expect(screen.getByText(/nothing else in the deck connects to this card/i)).toBeInTheDocument();
});

test("a focus that does not resolve renders nothing rather than an invented card", () => {
  const { container } = render(
    <EgoView graph={loneGraph()} report={SAMPLE.report} focusId="Not In This Deck" onFocus={() => {}} onBack={() => {}} />,
  );
  expect(container.querySelector("canvas")).toBeNull();
});

test("back leaves the view", async () => {
  const onBack = vi.fn();
  const user = userEvent.setup();
  render(<EgoView graph={SAMPLE.graph} report={SAMPLE.report} focusId="Krenko, Mob Boss" onFocus={() => {}} onBack={onBack} />);
  await user.click(screen.getByRole("button", { name: /back to the card list/i }));
  expect(onBack).toHaveBeenCalledOnce();
});
