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
    const flow = computeFlow(chain, "A");
    expect(flow.nodes.get("B")?.downstreamDepth).toBe(1);
    expect(flow.nodes.get("C")?.downstreamDepth).toBe(2);
  });

  it("follows the chain upstream and records depth", () => {
    const flow = computeFlow(chain, "A");
    expect(flow.nodes.get("X")?.upstreamDepth).toBe(1);
    expect(flow.nodes.get("X")?.downstreamDepth).toBeUndefined();
  });

  // THE LOAD-BEARING RULE. `A -> B` and `A -> C`: clicking B, A is upstream at depth 1 and a PURE
  // walk stops there. A walk that turned around at A would carry on downstream to C -- but C is A's
  // OTHER consumer, a sibling of B, and nothing B feeds or is fed by. Measured over six calibration
  // decks, a walk that may turn around reaches 50-76% of a deck by depth 3 against 3-12% for a pure
  // one, which is the difference between a readable flow and the whole board lighting up.
  it("never turns around: an upstream walk does not continue downstream from what it reaches", () => {
    const flow = computeFlow([e("A", "B"), e("A", "C")], "B");
    expect(flow.nodes.get("A")?.upstreamDepth).toBe(1);
    expect(flow.nodes.has("C")).toBe(false);
  });

  it("marks a card that both produces and consumes with both depths", () => {
    // A -> B -> C and A -> C: C is downstream of both, B is downstream of A and upstream of C.
    const flow = computeFlow([e("A", "B"), e("B", "C"), e("A", "C")], "B");
    const a = flow.nodes.get("A");
    expect(a?.upstreamDepth).toBe(1);
    const c = flow.nodes.get("C");
    expect(c?.downstreamDepth).toBe(1);
  });

  it("keeps the strongest fanoutCap edges per node and reports the rest as truncated", () => {
    const many = Array.from({ length: 10 }, (_, i) => e("A", `n${i}`, i));
    const flow = computeFlow(many, "A", { fanoutCap: 3 });
    // Weights 9, 8, 7 are the strongest three.
    expect(flow.nodes.has("n9")).toBe(true);
    expect(flow.nodes.has("n7")).toBe(true);
    expect(flow.nodes.has("n6")).toBe(false);
    expect(flow.truncated.get("A")).toEqual({ total: 10, shown: 3 });
  });

  it("caps the whole walk with the node budget, cutting the farthest ring", () => {
    // A chain 10 long. A budget of 3 keeps the nearest three and stops.
    const long = Array.from({ length: 10 }, (_, i) => e(`n${i}`, `n${i + 1}`));
    const flow = computeFlow(long, "n0", { nodeBudget: 3 });
    expect(flow.nodes.size).toBe(3);
    expect(flow.nodes.has("n1")).toBe(true);
    expect(flow.nodes.has("n9")).toBe(false);
  });

  // A -> B -> A is real: two cards that feed each other. The walk must terminate AND keep the
  // closing edge, because a cycle whose every edge is repeatable is the infinite-combo shape and a
  // later detector needs the evidence (spec §7).
  it("terminates on a cycle and records it rather than dropping the closing edge", () => {
    const flow = computeFlow([e("A", "B"), e("B", "A")], "A");
    expect(flow.nodes.get("B")?.downstreamDepth).toBe(1);
    expect(flow.cycles.length).toBeGreaterThan(0);
    expect(flow.cycles[0].nodes).toContain("A");
    expect(flow.cycles[0].nodes).toContain("B");
  });

  it("returns empty fans for a root with no edges", () => {
    const flow = computeFlow([e("A", "B")], "Z");
    expect(flow.nodes.size).toBe(0);
    expect(flow.edges).toEqual([]);
  });

  it("ignores a self-edge rather than trusting it cannot exist", () => {
    const flow = computeFlow([e("A", "A")], "A");
    expect(flow.nodes.size).toBe(0);
  });

  it("ships the measured caps", () => {
    expect(FLOW_FANOUT_CAP).toBe(6);
    expect(FLOW_NODE_BUDGET).toBe(40);
  });
});
