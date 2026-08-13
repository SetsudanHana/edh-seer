import { describe, expect, it } from "vitest";
import { edgeCrossings, linkDistError, hubFreedom } from "./board-quality.js";

describe("edgeCrossings", () => {
  const at = (x: number, y: number) => ({ x, y });

  it("counts a plain X as one crossing", () => {
    const nodes = { a: at(0, 0), b: at(10, 10), c: at(0, 10), d: at(10, 0) };
    expect(edgeCrossings([{ from: "a", to: "b" }, { from: "c", to: "d" }], nodes)).toBe(1);
  });

  it("counts parallel edges as none", () => {
    const nodes = { a: at(0, 0), b: at(10, 0), c: at(0, 5), d: at(10, 5) };
    expect(edgeCrossings([{ from: "a", to: "b" }, { from: "c", to: "d" }], nodes)).toBe(0);
  });

  it("does not count edges that merely share an endpoint", () => {
    // Two edges out of one node touch at that node. Counting it would make every hub look terrible
    // and would swamp the real crossings.
    const nodes = { a: at(0, 0), b: at(10, 10), c: at(10, -10) };
    expect(edgeCrossings([{ from: "a", to: "b" }, { from: "a", to: "c" }], nodes)).toBe(0);
  });
});

describe("linkDistError", () => {
  it("is zero when every edge sits at its target distance", () => {
    const nodes = { a: { x: 0, y: 0 }, b: { x: 3, y: 4 } };
    const edges = [{ from: "a", to: "b", target: 5 }];
    expect(linkDistError(edges, nodes)).toBeCloseTo(0);
  });

  it("is the rms of the per-edge errors", () => {
    const nodes = { a: { x: 0, y: 0 }, b: { x: 3, y: 4 }, c: { x: 0, y: 10 } };
    const edges = [
      { from: "a", to: "b", target: 4 },   // actual 5, error 1
      { from: "a", to: "c", target: 13 },  // actual 10, error 3
    ];
    expect(linkDistError(edges, nodes)).toBeCloseTo(Math.sqrt((1 + 9) / 2));
  });
});

describe("hubFreedom", () => {
  it("passes a graph of card nodes only", () => {
    expect(hubFreedom([{ id: "Sol Ring" }, { id: "Bitterblossom" }])).toEqual([]);
  });

  it("names any node carrying a kind, which is how a facet node would come back", () => {
    expect(hubFreedom([{ id: "color:B", kind: "color" }])).toEqual(["color:B"]);
  });
});
