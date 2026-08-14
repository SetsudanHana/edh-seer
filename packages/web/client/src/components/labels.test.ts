import { describe, expect, it } from "vitest";
import { labelCandidates, placeLabels } from "./labels.js";

// A FLOOR AND A CEILING. Labels used to start above the floor and never stop, so from CARD_MODE_Z
// (4) to MAX_Z (8) a name was painted over a card whose own art prints that name larger and better.
// Tested here rather than through GraphView because jsdom cannot load an image: every card there
// draws as a placeholder, so the suppressing branch is unreachable through the component.
describe("labelCandidates", () => {
  const nodes = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const opts = {
    zoomFloor: 0.6,
    cardModeZoom: 4,
    eligibleBelowFloor: new Set(["a"]),
    placeholders: new Set(["c"]),
  };

  it("narrows to commanders and the hovered set below the floor", () => {
    expect(labelCandidates(nodes, 0.5, opts).map((n) => n.id)).toEqual(["a"]);
  });

  it("labels everything between the floor and card mode", () => {
    expect(labelCandidates(nodes, 1, opts).map((n) => n.id)).toEqual(["a", "b", "c"]);
    expect(labelCandidates(nodes, 3.99, opts).map((n) => n.id)).toEqual(["a", "b", "c"]);
  });

  it("suppresses labels in card mode, where the art carries the name", () => {
    // Only "c", which drew as a placeholder and so has no art naming it.
    expect(labelCandidates(nodes, 4, opts).map((n) => n.id)).toEqual(["c"]);
    expect(labelCandidates(nodes, 8, opts).map((n) => n.id)).toEqual(["c"]);
  });

  it("labels nothing in card mode once every card's art has landed", () => {
    expect(labelCandidates(nodes, 4, { ...opts, placeholders: new Set() })).toEqual([]);
  });
});

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
