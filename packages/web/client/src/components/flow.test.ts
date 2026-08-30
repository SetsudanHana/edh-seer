import { describe, expect, it } from "vitest";
import { computeFlow, FLOW_FANOUT_CAP, FLOW_NODE_BUDGET } from "./flow.js";
import type { CardGraph } from "../types.js";

type Edge = CardGraph["edges"][number];
const e = (from: string, to: string, weight = 1): Edge =>
  ({ from, to, weight, tags: [], reasonTexts: [] });

describe("computeFlow", () => {
  // A -> B -> C, and X -> A. Clicking A: C is downstream at depth 2, X is upstream at depth 1.
  const chain = [e("A", "B"), e("B", "C"), e("X", "A")];

  it("follows the chain downstream and records depth", () => {
    const flow = computeFlow(chain, ["A"]);
    expect(flow.nodes.get("B")?.downstreamDepth).toBe(1);
    expect(flow.nodes.get("C")?.downstreamDepth).toBe(2);
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

  it("shares one node budget across the roots rather than one budget each", () => {
    const long = Array.from({ length: 20 }, (_, i) => e(`n${i}`, `n${i + 1}`));
    const other = Array.from({ length: 20 }, (_, i) => e(`m${i}`, `m${i + 1}`));
    const flow = computeFlow([...long, ...other], ["n0", "m0"], { nodeBudget: 5 });
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
  it("never turns around: an upstream walk does not continue downstream from what it reaches", () => {
    const flow = computeFlow([e("A", "B"), e("A", "C")], ["B"]);
    expect(flow.nodes.get("A")?.upstreamDepth).toBe(1);
    expect(flow.nodes.has("C")).toBe(false);
  });

  it("marks a card that both produces and consumes with both depths", () => {
    // A 3-cycle: X -> B -> Y -> X. Clicking X, the downstream walk reaches Y (via B, depth 2) and
    // the upstream walk reaches Y directly (Y -> X, depth 1) -- Y is fed by X's own chain AND
    // feeds X, so it genuinely carries both depths on ONE node. The old fixture asserted two
    // different single-depth nodes and never exercised the `flow.nodes.get(other) ?? {}` merge
    // that lets a node keep an earlier-set depth when the other walk visits it -- deleting that
    // merge (so the second walk clobbers the first) kept the old test green.
    const cycle = [e("X", "B"), e("B", "Y"), e("Y", "X")];
    const flow = computeFlow(cycle, ["X"]);
    const y = flow.nodes.get("Y");
    expect(y?.downstreamDepth).toBe(2);
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

  it("caps the whole walk with the node budget, cutting the farthest ring", () => {
    // A chain 10 long. A budget of 3 keeps the nearest three and stops.
    const long = Array.from({ length: 10 }, (_, i) => e(`n${i}`, `n${i + 1}`));
    const flow = computeFlow(long, ["n0"], { nodeBudget: 3 });
    expect(flow.nodes.size).toBe(3);
    expect(flow.nodes.has("n1")).toBe(true);
    expect(flow.nodes.has("n9")).toBe(false);
  });

  // A -> B -> A is real: two cards that feed each other. The walk must terminate AND keep the
  // closing edge, because a cycle whose every edge is repeatable is the infinite-combo shape and a
  // later detector needs the evidence (spec §7).
  it("terminates on a cycle and records it rather than dropping the closing edge", () => {
    const flow = computeFlow([e("A", "B"), e("B", "A")], ["A"]);
    expect(flow.nodes.get("B")?.downstreamDepth).toBe(1);
    expect(flow.cycles.length).toBeGreaterThan(0);
    expect(flow.cycles[0].nodes).toContain("A");
    expect(flow.cycles[0].nodes).toContain("B");
  });

  // A GENUINE EDGE BETWEEN TWO FLOW NODES MUST NOT BE DROPPED AS A "CYCLE". A -> B, A -> C, B -> C:
  // from A, B and C are both downstream at depth 1 and 1... wait, B->C is a real direction-pure
  // edge reaching an already-seen node via a DIFFERENT path (convergence), not a loop back onto an
  // ancestor. It has to be drawn -- on the board it's a neutral, dimmed line between two lit cards
  // if it's missing, which reads as though B and C have no relationship at all.
  it("keeps a genuine edge into an already-seen node when it is not a loop back to an ancestor", () => {
    const flow = computeFlow([e("A", "B"), e("A", "C"), e("B", "C")], ["A"]);
    expect(flow.edges).toContainEqual({ from: "B", to: "C", dir: "down", depth: 2 });
    // And it must NOT be misfiled as a cycle: C is not an ancestor of B on this walk.
    expect(flow.cycles.some((c) => c.nodes.includes("B") && c.nodes.includes("C"))).toBe(false);
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
