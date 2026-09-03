import { describe, expect, test } from "vitest";
import { egoGraph } from "./ego-graph.js";
import type { CardGraph, GraphNode } from "../types.js";

function node(id: string): GraphNode {
  return {
    id, label: id, copies: 1, types: ["creature"], subtypes: [], supertypes: [], colors: ["R"], cmc: 2,
  } as GraphNode;
}
function edge(from: string, to: string, weight: number): CardGraph["edges"][number] {
  return { from, to, weight, reasonTexts: [`${from} -> ${to}`] } as CardGraph["edges"][number];
}
function graphOf(nodes: GraphNode[], edges: CardGraph["edges"]): CardGraph {
  return { nodes, edges, undirectedReasons: 0, offDeckReasons: 0 };
}

describe("egoGraph", () => {
  test("keeps the focus, its neighbours, and nothing a hop further out", () => {
    const g = graphOf(
      ["A", "B", "C", "D"].map(node),
      [edge("A", "B", 1), edge("B", "C", 1), edge("C", "D", 1)],
    );
    const ego = egoGraph(g, "A");
    expect(ego.nodes.map((n) => n.id)).toEqual(["A", "B"]);
    // C is B's neighbour, not A's. A one-hop view that admitted it would be showing a relationship
    // the reader never asked about -- the same ruling `computeFlow`'s own comment records.
    expect(ego.edges.map((e) => `${e.from}->${e.to}`)).toEqual(["A->B"]);
  });

  test("the focus comes first and neighbours follow by descending weight", () => {
    const g = graphOf(
      ["A", "W", "S"].map(node),
      [edge("A", "W", 0.2), edge("A", "S", 9)],
    );
    expect(egoGraph(g, "A").nodes.map((n) => n.id)).toEqual(["A", "S", "W"]);
  });

  test("both directions count as neighbours", () => {
    const g = graphOf(["A", "U", "D"].map(node), [edge("U", "A", 1), edge("A", "D", 1)]);
    expect(new Set(egoGraph(g, "A").nodes.map((n) => n.id))).toEqual(new Set(["A", "U", "D"]));
  });

  test("the fanout cap bounds each direction, so a hub cannot flood the view", () => {
    const many = Array.from({ length: 20 }, (_, i) => `N${i}`);
    const g = graphOf(
      [node("A"), ...many.map(node)],
      many.map((n, i) => edge("A", n, i + 1)),
    );
    // 1 focus + at most FLOW_FANOUT_CAP downstream.
    expect(egoGraph(g, "A").nodes.length).toBe(7);
    // Strongest kept, weakest dropped.
    expect(egoGraph(g, "A").nodes.map((n) => n.id)).toContain("N19");
    expect(egoGraph(g, "A").nodes.map((n) => n.id)).not.toContain("N0");
  });

  test("a card nothing connects to is its own graph, not an empty one", () => {
    const g = graphOf(["A", "B"].map(node), [edge("A", "B", 1)]);
    const ego = egoGraph(g, "LONE");
    expect(ego.nodes).toEqual([]);
    expect(ego.edges).toEqual([]);
    // A focus that is not in the graph yields nothing; an ORPHAN that IS in the graph yields itself.
    const withOrphan = graphOf([node("A"), node("B"), node("O")], [edge("A", "B", 1)]);
    expect(egoGraph(withOrphan, "O").nodes.map((n) => n.id)).toEqual(["O"]);
    expect(egoGraph(withOrphan, "O").edges).toEqual([]);
  });
});
