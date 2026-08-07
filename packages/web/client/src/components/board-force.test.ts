import { describe, expect, test } from "vitest";
import { forceRoomAttraction, forceRoomContainment, type Sim } from "./board-force.js";
import type { Circle, RoomId } from "./deck-rooms.js";

function card(id: string, x: number, y: number): Sim {
  return { id, kind: "card", label: id, x, y, vx: 0, vy: 0, deg: 0 };
}

describe("forceRoomAttraction", () => {
  test("pulls two cards sharing a room toward each other", () => {
    const a = card("card:a", -50, 0);
    const b = card("card:b", 50, 0);
    const force = forceRoomAttraction({
      roomsByNode: new Map([["card:a", ["ramp"]], ["card:b", ["ramp"]]]),
      universal: new Set(),
      stiffness: 0.008,
    });
    force.initialize([a, b]);
    force(1);
    expect(a.vx).toBeGreaterThan(0); // a sits left, pulled right
    expect(b.vx).toBeLessThan(0);
    expect(a.vx).toBeCloseTo(-b.vx, 10); // equal and opposite
  });

  test("does nothing for cards sharing no room", () => {
    const a = card("card:a", -50, 0);
    const b = card("card:b", 50, 0);
    const force = forceRoomAttraction({
      roomsByNode: new Map([["card:a", ["ramp"]], ["card:b", ["lands"]]]),
      universal: new Set(),
      stiffness: 0.008,
    });
    force.initialize([a, b]);
    force(1);
    expect(a.vx).toBe(0);
    expect(b.vx).toBe(0);
  });

  test("ignores a room listed as universal", () => {
    const a = card("card:a", -50, 0);
    const b = card("card:b", 50, 0);
    const force = forceRoomAttraction({
      roomsByNode: new Map([["card:a", ["strategy"]], ["card:b", ["strategy"]]]),
      universal: new Set(["strategy"]),
      stiffness: 0.008,
    });
    force.initialize([a, b]);
    force(1);
    expect(a.vx).toBe(0);
  });

  test("scales with alpha, the way every d3 force does", () => {
    const build = () => {
      const a = card("card:a", -50, 0);
      const b = card("card:b", 50, 0);
      const force = forceRoomAttraction({
        roomsByNode: new Map([["card:a", ["ramp"]], ["card:b", ["ramp"]]]),
        universal: new Set(),
        stiffness: 0.008,
      });
      force.initialize([a, b]);
      return { a, force };
    };
    const full = build(); full.force(1);
    const half = build(); half.force(0.5);
    expect(half.a.vx).toBeCloseTo(full.a.vx / 2, 10);
  });

  test("pulls harder for a pair sharing two rooms than one", () => {
    const build = (rooms: RoomId[]) => {
      const a = card("card:a", -50, 0);
      const b = card("card:b", 50, 0);
      const force = forceRoomAttraction({
        roomsByNode: new Map([["card:a", rooms], ["card:b", rooms]]),
        universal: new Set(),
        stiffness: 0.008,
      });
      force.initialize([a, b]);
      force(1);
      return a.vx;
    };
    expect(build(["ramp", "lands"])).toBeGreaterThan(build(["ramp"]));
  });
});

describe("forceRoomContainment", () => {
  const circles = (): ReadonlyMap<RoomId, Circle> =>
    new Map([["ramp", { x: 0, y: 0, r: 100 }]]);

  test("pulls a member that has drifted outside back toward the room", () => {
    const a = card("card:a", 300, 0);
    const force = forceRoomContainment({
      roomsByNode: new Map([["card:a", ["ramp"]]]),
      circles,
      containmentStiffness: 0.02,
      foreignStiffness: 0.008,
    });
    force.initialize([a]);
    force(1);
    expect(a.vx).toBeLessThan(0); // pulled back toward the centre at x=0
  });

  test("pushes a non-member sitting inside the room outward", () => {
    const a = card("card:a", 20, 0);
    const force = forceRoomContainment({
      roomsByNode: new Map([["card:a", ["lands"]]]),
      circles,
      containmentStiffness: 0.02,
      foreignStiffness: 0.008,
    });
    force.initialize([a]);
    force(1);
    expect(a.vx).toBeGreaterThan(0); // pushed out, away from the centre
  });

  // The regression this repo already paid for once: a card in NO room makes no claim about
  // where it should NOT be either. Without the guard it takes foreignPush from every circle at
  // once and is flung off the board -- measured at 14/94 cards, 275-371 units past the nearest
  // rim, on inalla.txt's Colour preset.
  test("leaves a card in no room completely alone", () => {
    const a = card("card:a", 20, 0);
    const force = forceRoomContainment({
      roomsByNode: new Map([["card:a", []]]),
      circles,
      containmentStiffness: 0.02,
      foreignStiffness: 0.008,
    });
    force.initialize([a]);
    force(1);
    expect(a.vx).toBe(0);
    expect(a.vy).toBe(0);
  });

  test("leaves a non-card node alone", () => {
    const n: Sim = { id: "event:x", kind: "event", label: "x", x: 20, y: 0, vx: 0, vy: 0, deg: 0 };
    const force = forceRoomContainment({
      roomsByNode: new Map(),
      circles,
      containmentStiffness: 0.02,
      foreignStiffness: 0.008,
    });
    force.initialize([n]);
    force(1);
    expect(n.vx).toBe(0);
  });

  test("scales with alpha", () => {
    const build = (alpha: number) => {
      const a = card("card:a", 300, 0);
      const force = forceRoomContainment({
        roomsByNode: new Map([["card:a", ["ramp"]]]),
        circles,
        containmentStiffness: 0.02,
        foreignStiffness: 0.008,
      });
      force.initialize([a]);
      force(alpha);
      return a.vx;
    };
    expect(build(0.5)).toBeCloseTo(build(1) / 2, 10);
  });
});
