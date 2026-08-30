import { describe, expect, it } from "vitest";
import { computeFlow, FLOW_FANOUT_CAP, FLOW_NODE_BUDGET } from "./flow.js";
import type { CardGraph } from "../types.js";

type Edge = CardGraph["edges"][number];
const e = (from: string, to: string, weight = 1): Edge =>
  ({ from, to, weight, tags: [], reasonTexts: [] });

describe("computeFlow", () => {
  // A -> B -> C, and X -> A. Selecting A: B is what A feeds, X is what feeds A, and C is B's
  // business rather than A's.
  const chain = [e("A", "B"), e("B", "C"), e("X", "A")];

  // ONE HOP. This used to walk breadth-first to a budget of 40 and the owner's verdict was "I can
  // still see too much" -- a neighbour brought its own fan along, so one click lit edges between
  // two cards the reader had never asked about.
  it("shows what the selected card feeds, and stops there", () => {
    const flow = computeFlow(chain, ["A"]);
    expect(flow.nodes.get("B")?.downstreamDepth).toBe(1);
    expect(flow.nodes.has("C")).toBe(false);
    expect(flow.edges.some((fe) => fe.from === "B" && fe.to === "C")).toBe(false);
  });

  // AND SELECTING THE NEIGHBOUR IS HOW YOU GET THE SECOND HOP. The suppressed edge is not gone,
  // it is waiting for the reader to say the card it hangs off is interesting.
  it("reveals a neighbour's own edges once that neighbour is selected too", () => {
    const flow = computeFlow(chain, ["A", "B"]);
    expect(flow.edges.some((fe) => fe.from === "B" && fe.to === "C")).toBe(true);
    expect(flow.nodes.get("C")?.downstreamDepth).toBe(1);
  });

  // SELECTION IS A SET. Two roots walk together rather than as two flows merged afterwards, which
  // is what keeps the node budget honest: N merged flows could light N x FLOW_NODE_BUDGET cards.
  it("walks from every root at once and reports all of them", () => {
    const flow = computeFlow([e("A", "B"), e("P", "Q")], ["A", "P"]);
    expect([...flow.roots].sort()).toEqual(["A", "P"]);
    expect(flow.nodes.get("B")?.downstreamDepth).toBe(1);
    expect(flow.nodes.get("Q")?.downstreamDepth).toBe(1);
    // Neither root is a node in the other's fan; they are roots, and the fans are disjoint here.
    expect(flow.nodes.has("A")).toBe(false);
    expect(flow.nodes.has("P")).toBe(false);
  });

  // An edge BETWEEN two selected cards still draws: both endpoints are already in `seen`, and the
  // walk records that edge before deciding whether it also closes a loop. Selecting a chain's two
  // ends and losing the link between them would be the obvious way to get this wrong.
  it("draws the edge between two roots", () => {
    const flow = computeFlow([e("A", "B")], ["A", "B"]);
    expect(flow.edges.some((fe) => fe.from === "A" && fe.to === "B")).toBe(true);
  });

  // The budget binds on a MULTI-CARD selection now, which is the only place it can: one card's two
  // fans cannot exceed 2 x fanoutCap on their own.
  it("shares one node budget across the roots rather than one budget each", () => {
    const roots = Array.from({ length: 6 }, (_, i) => `r${i}`);
    const edges = roots.flatMap((r) => Array.from({ length: 3 }, (_, i) => e(r, `${r}-x${i}`)));
    const flow = computeFlow(edges, roots, { nodeBudget: 5 });
    expect(flow.nodes.size).toBeLessThanOrEqual(5);
  });

  it("follows the chain upstream and records depth", () => {
    const flow = computeFlow(chain, ["A"]);
    expect(flow.nodes.get("X")?.upstreamDepth).toBe(1);
    expect(flow.nodes.get("X")?.downstreamDepth).toBeUndefined();
  });

  // THE LOAD-BEARING RULE. `A -> B` and `A -> C`: clicking B, A is upstream at depth 1 and a PURE
  // walk stops there. A walk that turned around at A would carry on downstream to C -- but C is A's
  // OTHER consumer, a sibling of B, and nothing B feeds or is fed by. Measured over six calibration
  // decks, a walk that may turn around reaches 50-76% of a deck by depth 3 against 3-12% for a pure
  // one, which is the difference between a readable flow and the whole board lighting up.
  it("never turns around: the card that feeds the selection does not bring its other consumers", () => {
    const flow = computeFlow([e("A", "B"), e("A", "C")], ["B"]);
    expect(flow.nodes.get("A")?.upstreamDepth).toBe(1);
    expect(flow.nodes.has("C")).toBe(false);
  });

  it("marks a card that both produces and consumes with both depths", () => {
    // X and Y feed each other. Y is in both of X's fans, and that is ONE node carrying two depths,
    // not two nodes -- the second fan must merge into the first entry rather than clobber it.
    // Deleting the `flow.nodes.get(other) ?? {}` merge is what this catches.
    const flow = computeFlow([e("X", "Y"), e("Y", "X")], ["X"]);
    const y = flow.nodes.get("Y");
    expect(y?.downstreamDepth).toBe(1);
    expect(y?.upstreamDepth).toBe(1);
  });

  it("keeps the strongest fanoutCap edges per node and reports the rest as truncated", () => {
    const many = Array.from({ length: 10 }, (_, i) => e("A", `n${i}`, i));
    const flow = computeFlow(many, ["A"], { fanoutCap: 3 });
    // Weights 9, 8, 7 are the strongest three.
    expect(flow.nodes.has("n9")).toBe(true);
    expect(flow.nodes.has("n7")).toBe(true);
    expect(flow.nodes.has("n6")).toBe(false);
    expect(flow.truncated.get("A")).toEqual({ down: { total: 10, shown: 3 } });
  });

  // THE ROOT CAN BE TRUNCATED ON BOTH WALKS AT ONCE, AND MUST NOT COLLIDE. Keying `truncated` by id
  // alone let the upstream walk's entry for the root silently overwrite the downstream walk's --
  // a card feeding 10 (shown 6) and fed by 8 (shown 6) reported `{total:8,shown:6}` under BOTH
  // headings, so "feeds 10" printed as "8 in total" in the panel.
  it("keeps the root's downstream and upstream truncation separate", () => {
    const downEdges = Array.from({ length: 10 }, (_, i) => e("R", `d${i}`, i));
    const upEdges = Array.from({ length: 8 }, (_, i) => e(`u${i}`, "R", i));
    const flow = computeFlow([...downEdges, ...upEdges], ["R"], { fanoutCap: 6 });
    expect(flow.truncated.get("R")).toEqual({
      down: { total: 10, shown: 6 },
      up: { total: 8, shown: 6 },
    });
  });

  // A -> B -> A is real: two cards that feed each other, and both directions are the selection's
  // own edges. `cycles` is gone with the walk that could find one -- at one hop the only loop
  // reachable is this pair, and it is already two ordinary edges.
  it("keeps both directions when two cards feed each other", () => {
    const flow = computeFlow([e("A", "B"), e("B", "A")], ["A"]);
    expect(flow.edges).toContainEqual({ from: "A", to: "B", dir: "down", depth: 1 });
    expect(flow.edges).toContainEqual({ from: "B", to: "A", dir: "up", depth: 1 });
  });

  // TWO CARDS THE SELECTION ONLY INTRODUCED TO EACH OTHER ARE NOT RELATED BY IT. A -> B, A -> C,
  // B -> C: selecting A lights B and C, and the B->C edge stays dark. It is a claim about B and C,
  // and the reader asked about A -- drawing it is how the board used to say more than it knew.
  it("suppresses an edge between two neighbours when neither of them is selected", () => {
    const flow = computeFlow([e("A", "B"), e("A", "C"), e("B", "C")], ["A"]);
    expect(flow.edges.some((fe) => fe.from === "B" && fe.to === "C")).toBe(false);
    expect(flow.nodes.has("B")).toBe(true);
    expect(flow.nodes.has("C")).toBe(true);
  });

  it("returns empty fans for a root with no edges", () => {
    const flow = computeFlow([e("A", "B")], ["Z"]);
    expect(flow.nodes.size).toBe(0);
    expect(flow.edges).toEqual([]);
  });

  it("ignores a self-edge rather than trusting it cannot exist", () => {
    const flow = computeFlow([e("A", "A")], ["A"]);
    expect(flow.nodes.size).toBe(0);
  });

  it("ships the measured caps", () => {
    expect(FLOW_FANOUT_CAP).toBe(6);
    expect(FLOW_NODE_BUDGET).toBe(40);
  });
});
