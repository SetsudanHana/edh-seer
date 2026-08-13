import { describe, expect, it } from "vitest";
import { placeLabels } from "./labels.js";

const box = (id: string, x: number, y: number, w = 40, h = 12) => ({ id, x, y, w, h });

describe("placeLabels", () => {
  it("draws a lone label", () => {
    expect(placeLabels([box("a", 0, 0)])).toEqual(["a"]);
  });

  it("drops the lower-priority label of an overlapping pair", () => {
    // Input is priority-ordered; the first one wins.
    expect(placeLabels([box("high", 0, 0), box("low", 5, 0)])).toEqual(["high"]);
  });

  it("keeps both when they clear each other", () => {
    expect(placeLabels([box("a", 0, 0), box("b", 100, 0)])).toEqual(["a", "b"]);
  });

  it("never reorders: a later label cannot displace an earlier one", () => {
    // The whole point. If a big label could evict a small one, which labels showed would depend on
    // the camera, and the reveal would flicker as the user zoomed.
    const out = placeLabels([box("first", 0, 0, 10, 10), box("second", 2, 0, 400, 10)]);
    expect(out).toEqual(["first"]);
  });
});
