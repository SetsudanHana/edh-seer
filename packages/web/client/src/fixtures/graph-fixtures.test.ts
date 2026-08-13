import { describe, expect, it } from "vitest";
import sorin from "./sorin-graph.json";
import inalla from "./inalla-graph.json";
import fairdrazi from "./fairdrazi-graph.json";
import changelings from "./changelings-graph.json";
import braids from "./braids-graph.json";

const FIXTURES = { sorin, inalla, fairdrazi, changelings, braids };

describe.each(Object.entries(FIXTURES))("%s fixture", (_name, fx) => {
  const g = (fx as { graph: { nodes: unknown[]; edges: unknown[] } }).graph;

  it("holds only card nodes -- no facet value is a node", () => {
    // The whole point of the projection. `color:B` reached degree 83 in an 84-card deck.
    for (const n of g.nodes as Array<Record<string, unknown>>) {
      expect(n).not.toHaveProperty("kind");
      expect(typeof n.id).toBe("string");
      expect(Array.isArray(n.types)).toBe(true);
    }
  });

  it("names both endpoints of every edge as nodes present in the graph", () => {
    const ids = new Set((g.nodes as Array<{ id: string }>).map((n) => n.id));
    for (const e of g.edges as Array<{ from: string; to: string }>) {
      expect(ids.has(e.from), `${e.from} missing`).toBe(true);
      expect(ids.has(e.to), `${e.to} missing`).toBe(true);
    }
  });

  it("weights every edge above zero", () => {
    for (const e of g.edges as Array<{ weight: number }>) expect(e.weight).toBeGreaterThan(0);
  });

  it("placed every reason it was given", () => {
    // Nonzero means the reason set and the card list disagree -- a wiring bug, not a fixture quirk.
    expect((fx as { graph: { offDeckReasons: number } }).graph.offDeckReasons).toBe(0);
  });
});
