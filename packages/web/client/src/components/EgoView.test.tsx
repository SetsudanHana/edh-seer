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
