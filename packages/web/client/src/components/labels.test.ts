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
/** One label with a single candidate slot -- the shape these tests were written against, before a
 *  blocked label could try a second position. */
const only = (b: ReturnType<typeof box>) => [b];
const ids = (placed: { id: string }[]) => placed.map((p) => p.id);

describe("placeLabels", () => {
  it("draws a lone label", () => {
    expect(ids(placeLabels([only(box("a", 0, 0))]))).toEqual(["a"]);
  });

  it("drops the lower-priority label of an overlapping pair", () => {
    // Input is priority-ordered; the first one wins.
    expect(ids(placeLabels([only(box("high", 0, 0)), only(box("low", 5, 0))]))).toEqual(["high"]);
  });

  it("keeps both when they clear each other", () => {
    expect(ids(placeLabels([only(box("a", 0, 0)), only(box("b", 100, 0))]))).toEqual(["a", "b"]);
  });

  it("never reorders: a later label cannot displace an earlier one", () => {
    // The whole point. If a big label could evict a small one, which labels showed would depend on
    // the camera, and the reveal would flicker as the user zoomed.
    const out = placeLabels([only(box("first", 0, 0, 10, 10)), only(box("second", 2, 0, 400, 10))]);
    expect(ids(out)).toEqual(["first"]);
  });

  // ROADMAP H7. The pass compared labels against labels only, so a label could be printed straight
  // across a neighbouring card's art -- three such collisions in one screenshot of a real deck.
  it("refuses a slot that covers another node, and reports which slot it used", () => {
    const nodeInTheWay = box("other-node", 0, 0, 30, 30);
    const blocked = box("a", 5, 5, 20, 10);      // sits on top of that node
    const free = box("a", 5, 100, 20, 10);       // the below-the-node fallback
    expect(placeLabels([[blocked, free]], [nodeInTheWay])).toEqual([{ id: "a", slot: 1 }]);
  });

  it("a label may sit on its OWN node, or nothing could ever be labelled", () => {
    const own = box("a", 0, 0, 30, 30);
    expect(placeLabels([only(box("a", 5, 5, 20, 10))], [own])).toEqual([{ id: "a", slot: 0 }]);
  });

  it("drops the label when every slot is blocked", () => {
    const wall = box("other-node", 0, 0, 500, 500);
    expect(placeLabels([[box("a", 5, 5), box("a", 5, 200)]], [wall])).toEqual([]);
  });
});
