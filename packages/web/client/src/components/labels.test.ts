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

  // THE CULL. Between the floor and card zoom the board used to make every node a candidate, so a
  // 130-node deck sent 130 names into a greedy placer and the reader got whichever ones won a
  // rectangle fight. Passing the degree map is what turns the cull on -- omitting it keeps the old
  // behaviour, which the test above still pins.
  it("labels the better-connected half between the floor and card mode", () => {
    const five = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }, { id: "e" }];
    const weightedDegree = new Map([["a", 0], ["b", 1], ["c", 5], ["d", 9], ["e", 12]]);
    // Median of [0,1,5,9,12] is 5, so c/d/e clear it -- and "a" rides in on the commander set,
    // which is never culled however unconnected the card is.
    expect(labelCandidates(five, 1, { ...opts, cull: { weightedDegree, degreeQuantile: 0.5 } }).map((n) => n.id))
      .toEqual(["a", "c", "d", "e"]);
    // The shipped quantile keeps three quarters: the bar is [0,1,5,9,12][1] = 1.
    expect(labelCandidates(five, 1, { ...opts, cull: { weightedDegree, degreeQuantile: 0.25 } }).map((n) => n.id))
      .toEqual(["a", "b", "c", "d", "e"]);
  });

  it("culls nothing at all when no degree map is given", () => {
    expect(labelCandidates(nodes, 1, { ...opts, cull: undefined }).map((n) => n.id))
      .toEqual(["a", "b", "c"]);
  });

  // A node absent from the map reads 0, not "unknown" -- an unconnected card really does have no
  // weighted degree, and the map is built by summing over links.
  it("treats a node with no degree entry as unconnected", () => {
    const weightedDegree = new Map([["b", 4], ["c", 4]]);
    expect(labelCandidates(nodes, 1, { ...opts, cull: { weightedDegree, degreeQuantile: 0.5 } }).map((n) => n.id))
      .toEqual(["a", "b", "c"]);
    const weightedDegree2 = new Map([["b", 0], ["c", 9]]);
    // Median of [0,0,9] is 0, so everything clears it: the cull cannot fire on a board where most
    // cards are unconnected, which is the honest answer -- there is nothing to prioritise.
    expect(labelCandidates(nodes, 1, { ...opts, cull: { weightedDegree: weightedDegree2, degreeQuantile: 0.5 } }).map((n) => n.id))
      .toEqual(["a", "b", "c"]);
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
