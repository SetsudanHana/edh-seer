import { expect, test } from "vitest";
import { drawnEdges } from "./board-edges.js";

test("keeps drawn edges and edges from before the flag existed, drops the undrawn", () => {
  const edges = [
    { from: "a", to: "b", drawn: true },
    { from: "a", to: "c", drawn: false },
    { from: "b", to: "c" },
  ];
  expect(drawnEdges(edges).map((e) => `${e.from}->${e.to}`)).toEqual(["a->b", "b->c"]);
});
