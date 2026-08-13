import { describe, expect, test } from "vitest";
import { forceCollide, forceLink, forceManyBody, forceX, forceY } from "d3-force";
import {
  ALPHA_DECAY,
  ALPHA_FLOOR,
  boardMetrics,
  containment,
  CONTAINMENT,
  countOverlaps,
  createBoardSimulation,
  DEFAULT_PARAMS,
  FOREIGN_PUSH,
  forceNestedOffset,
  forceRoomAttraction,
  forceRoomSeparation,
  forceRoomContainment,
  foreignPush,
  holdCardCentroid,
  nodeRadius,
  projectRoomMembership,
  REPULSION,
  VELOCITY_DECAY,
  type BoardParams,
  type CustomForce,
  type Sim,
} from "./board-force.js";
import { ART_RADIUS } from "./deck-rooms.js";
import type { Circle, RoomId } from "./deck-rooms.js";
import { boardTrial, type TrialFixture } from "./board-trial.js";
import inalla from "../fixtures/inalla-graph.json" with { type: "json" };

/** vitest swallows console.log from this file, and the client tsconfig has no node types -- so the
 *  measurement line below writes to stdout directly with a local declaration rather than pulling
 *  @types/node into a browser build's typecheck for one line of test output. */
declare const process: { stdout: { write(s: string): void } };

function card(id: string, x: number, y: number): Sim {
  return { id, kind: "card", label: id, x, y, vx: 0, vy: 0, deg: 0 };
}

describe("forceRoomAttraction", () => {
  test("pulls two cards sharing a room toward each other", () => {
    const a = card("card:a", -50, 0);
    const b = card("card:b", 50, 0);
    const force = forceRoomAttraction({
      roomsByNode: new Map([["card:a", ["ramp"]], ["card:b", ["ramp"]]]),
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
      stiffness: 0.008,
    });
    force.initialize([a, b]);
    force(1);
    expect(a.vx).toBe(0);
    expect(b.vx).toBe(0);
  });


  test("scales with alpha, the way every d3 force does", () => {
    const build = () => {
      const a = card("card:a", -50, 0);
      const b = card("card:b", 50, 0);
      const force = forceRoomAttraction({
        roomsByNode: new Map([["card:a", ["ramp"]], ["card:b", ["ramp"]]]),
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
        stiffness: 0.008,
      });
      force.initialize([a, b]);
      force(1);
      return a.vx;
    };
    expect(build(["ramp", "lands"])).toBeGreaterThan(build(["ramp"]));
  });
});

describe("foreignPush's reach past the rim", () => {
  // The margin makes the push ANTICIPATORY. Without it the force is purely reactive: it does
  // nothing until a card is already inside a room it does not belong to, so the only thing keeping
  // non-members out at range is the general repulsion. Measured across ten cases at ten trials,
  // a margin of 40 beat 0 on all three counts at once -- overlaps 48 -> 35, intrusions 36 -> 24,
  // unresolved 94 -> 58.
  const outside = (margin: number) => foreignPush(130, 0, 100, 14, 0.008, margin).x;

  test("does nothing outside the rim when there is no margin", () => {
    // Near rim at 130 - 14 = 116, clear of the 100 radius.
    expect(outside(0)).toBe(0);
  });

  test("pushes a card that is outside the rim but inside the margin", () => {
    expect(outside(40)).toBeGreaterThan(0);
  });

  test("still does nothing beyond the margin", () => {
    expect(outside(10)).toBe(0);
  });

  test("pushes a card deep inside harder than one merely in the margin", () => {
    const deep = foreignPush(20, 0, 100, 14, 0.008, 40).x;
    expect(deep).toBeGreaterThan(outside(40));
  });

  test("leaves the inside-the-circle behaviour unchanged at margin 0", () => {
    expect(foreignPush(20, 0, 100, 14, 0.008, 0)).toEqual(foreignPush(20, 0, 100, 14, 0.008));
  });
});

describe("forceRoomSeparation", () => {
  const sep = (roomsByNode: Map<string, string[]>, nodes: Sim[], circles: () => ReadonlyMap<RoomId, Circle>) => {
    const f = forceRoomSeparation({ roomsByNode, circles, stiffness: 0.03 });
    f.initialize(nodes);
    f(1);
  };
  const two = () => new Map<RoomId, Circle>([
    ["a", { x: -30, y: 0, r: 100 }], ["b", { x: 30, y: 0, r: 100 }],
  ]);

  test("pushes two overlapping rooms apart along the line joining them", () => {
    const x = card("card:x", -30, 0), y = card("card:y", 30, 0);
    sep(new Map([["card:x", ["a"]], ["card:y", ["b"]]]), [x, y], two);
    expect(x.vx).toBeLessThan(0); // room a sits left, pushed further left
    expect(y.vx).toBeGreaterThan(0);
    expect(x.vx).toBeCloseTo(-y.vx, 10);
  });

  test("does nothing to rooms that do not overlap", () => {
    const x = card("card:x", -300, 0), y = card("card:y", 300, 0);
    sep(new Map([["card:x", ["a"]], ["card:y", ["b"]]]),
      [x, y], () => new Map([["a", { x: -300, y: 0, r: 100 }], ["b", { x: 300, y: 0, r: 100 }]]));
    expect([x.vx, y.vx]).toEqual([0, 0]);
  });

  // The property the whole design rests on: a card in BOTH rooms is in both member lists, so it
  // takes -k from one and +k from the other and nets to exactly zero. It does not move, and since
  // a circle is centred on its members, it anchors both -- which is what stops rooms that share
  // cards from separating past what their shared membership allows. No threshold required.
  test("leaves a card shared by both rooms exactly where it is", () => {
    const shared = card("card:s", 0, 0);
    const x = card("card:x", -30, 0), y = card("card:y", 30, 0);
    sep(new Map([["card:s", ["a", "b"]], ["card:x", ["a"]], ["card:y", ["b"]]]), [shared, x, y], two);
    expect([shared.vx, shared.vy]).toEqual([0, 0]);
    expect(x.vx).toBeLessThan(0); // the unshared members still move
  });

  test("a room nested inside another cannot be moved by this force at all", () => {
    // Every member of `b` is also in `a`, so every push cancels on every card.
    const p = card("card:p", -10, 0), q = card("card:q", 10, 0);
    sep(new Map([["card:p", ["a"]], ["card:q", ["a", "b"]]]), [p, q], two);
    expect([q.vx, q.vy]).toEqual([0, 0]);
  });

  // THE TARGET IS A LENS, NOT TANGENCY. Pushing every overlapping pair toward "no overlap" drives
  // rooms that SHARE cards to tangency, where the lens has zero area and the cards in both rooms
  // have nowhere legal to stand. Measured on the settled board: inalla/Colour's R+U lens held 1.2
  // card discs against the 7 cards that need it, B+U held 0.7 against 6, and separation shrank
  // every lens 2-4x. So the target is the overlap those shared members actually need.
  describe("the lens a pair's shared members need", () => {
    // Two rooms that share cards but sit tangent: the lens is empty and there is nowhere for the
    // shared members to be. This is the case the original force drove TOWARD.
    test("pulls two rooms that share cards TOGETHER when their lens is too small", () => {
      const shared = card("card:s", 0, 0);
      const x = card("card:x", -200, 0), y = card("card:y", 200, 0);
      const tangent = () => new Map<RoomId, Circle>([
        ["a", { x: -100, y: 0, r: 100 }], ["b", { x: 100, y: 0, r: 100 }],
      ]);
      sep(new Map([["card:s", ["a", "b"]], ["card:x", ["a"]], ["card:y", ["b"]]]),
        [shared, x, y], tangent);
      expect(x.vx).toBeGreaterThan(0); // room a sits left, pulled RIGHT, toward b
      expect(y.vx).toBeLessThan(0);
    });

    test("still pushes apart when the overlap is far more than the shared members need", () => {
      // One shared card between two large rooms needs only a sliver; these are nearly concentric.
      const shared = card("card:s", 0, 0);
      const x = card("card:x", -10, 0), y = card("card:y", 10, 0);
      sep(new Map([["card:s", ["a", "b"]], ["card:x", ["a"]], ["card:y", ["b"]]]),
        [shared, x, y], two);
      expect(x.vx).toBeLessThan(0);
      expect(y.vx).toBeGreaterThan(0);
    });

    // The guarantee that keeps the original purpose intact. Two rooms with no card in common have
    // no lens to size, so they are only ever pushed apart -- never drawn together.
    test("never pulls together two rooms that share nothing", () => {
      const x = card("card:x", -300, 0), y = card("card:y", 300, 0);
      sep(new Map([["card:x", ["a"]], ["card:y", ["b"]]]),
        [x, y], () => new Map([["a", { x: -300, y: 0, r: 100 }], ["b", { x: 300, y: 0, r: 100 }]]));
      expect([x.vx, y.vx]).toEqual([0, 0]);
    });

    test("asks for more overlap the more cards the pair shares", () => {
      const need = (shared: number) => {
        const cards: Sim[] = [];
        const rooms = new Map<string, string[]>();
        for (let i = 0; i < shared; i++) {
          cards.push(card(`card:s${i}`, 0, 0));
          rooms.set(`card:s${i}`, ["a", "b"]);
        }
        // One unshared member each, so the pair has something the force can actually move.
        cards.push(card("card:x", -100, 0)); rooms.set("card:x", ["a"]);
        cards.push(card("card:y", 100, 0)); rooms.set("card:y", ["b"]);
        sep(rooms, cards, () => new Map<RoomId, Circle>([
          ["a", { x: -70, y: 0, r: 100 }], ["b", { x: 70, y: 0, r: 100 }],
        ]));
        return cards[cards.length - 2].vx; // card:x, the unshared member of room a
      };
      // card:x is room a's UNSHARED member, sitting left: pushing the pair apart drives it further
      // left (negative), pulling them together drives it right (positive). A pair sharing more
      // cards needs a wider lens, so at one fixed geometry it is pushed apart less hard -- and past
      // some count, pulled together instead.
      expect(need(8)).toBeGreaterThan(need(1));
    });
  });
});

describe("forceNestedOffset", () => {
  // `child` holds a and b; `parent` holds all four. Both circles start on the origin, which is the
  // situation the force exists for: two circles centred on the centroid of almost the same cards.
  const nested = () => {
    const nodes = [card("card:a", 0, 0), card("card:b", 0, 0), card("card:c", 0, 0), card("card:d", 0, 0)];
    const roomsByNode = new Map<string, readonly RoomId[]>([
      ["card:a", ["parent", "child"]], ["card:b", ["parent", "child"]],
      ["card:c", ["parent"]], ["card:d", ["parent"]],
    ]);
    const circles = (): ReadonlyMap<RoomId, Circle> =>
      new Map([["parent", { x: 0, y: 0, r: 100 }], ["child", { x: 0, y: 0, r: 40 }]]);
    return { nodes, roomsByNode, circles };
  };

  test("slides the nested room's members toward internal tangency with the parent's rim", () => {
    const { nodes, roomsByNode, circles } = nested();
    const force = forceNestedOffset({ roomsByNode, circles, stiffness: 0.1 });
    force.initialize(nodes);
    force(1);
    // One child, so angle 0: target is (parentR - childR, 0) = (60, 0), and the child's circle is
    // on the origin, so the nudge is 60 * 0.1 * alpha.
    expect(nodes[0].vx).toBeCloseTo(6, 10);
    expect(nodes[0].vy).toBeCloseTo(0, 10);
  });

  test("moves every member of the nested room by the SAME amount, so the cluster translates", () => {
    // Pulling each member toward the target point individually would compress the child against
    // its own roomAttraction. It is a translation, not a gather.
    const { nodes, roomsByNode, circles } = nested();
    const force = forceNestedOffset({ roomsByNode, circles, stiffness: 0.1 });
    force.initialize(nodes);
    force(1);
    expect([nodes[1].vx, nodes[1].vy]).toEqual([nodes[0].vx, nodes[0].vy]);
  });

  test("leaves the parent's own members alone", () => {
    const { nodes, roomsByNode, circles } = nested();
    const force = forceNestedOffset({ roomsByNode, circles, stiffness: 0.1 });
    force.initialize(nodes);
    force(1);
    expect([nodes[2].vx, nodes[2].vy]).toEqual([0, 0]);
    expect([nodes[3].vx, nodes[3].vy]).toEqual([0, 0]);
  });

  test("does nothing at all when no room is nested inside another", () => {
    // Overlapping is not nesting. These two share a card and neither contains the other, so there
    // is no parent to slide off -- and every preset but inalla's Subtype is this case.
    const a = card("card:a", 0, 0), b = card("card:b", 0, 0), c = card("card:c", 0, 0);
    const force = forceNestedOffset({
      roomsByNode: new Map<string, readonly RoomId[]>([
        ["card:a", ["x"]], ["card:b", ["x", "y"]], ["card:c", ["y"]],
      ]),
      circles: () => new Map([["x", { x: 0, y: 0, r: 50 }], ["y", { x: 10, y: 0, r: 50 }]]),
      stiffness: 0.1,
    });
    force.initialize([a, b, c]);
    force(1);
    expect([a.vx, a.vy, b.vx, b.vy, c.vx, c.vy]).toEqual([0, 0, 0, 0, 0, 0]);
  });

  test("spreads two children of one parent to opposite sides", () => {
    const nodes = [
      card("card:a", 0, 0), card("card:b", 0, 0), card("card:c", 0, 0), card("card:d", 0, 0),
    ];
    const force = forceNestedOffset({
      roomsByNode: new Map<string, readonly RoomId[]>([
        ["card:a", ["parent", "one"]], ["card:b", ["parent", "two"]],
        ["card:c", ["parent"]], ["card:d", ["parent"]],
      ]),
      circles: () => new Map([
        ["parent", { x: 0, y: 0, r: 100 }],
        ["one", { x: 0, y: 0, r: 40 }], ["two", { x: 0, y: 0, r: 40 }],
      ]),
      stiffness: 0.1,
    });
    force.initialize(nodes);
    force(1);
    // Angles 0 and pi: equal and opposite, so the two children cannot stack on the same side.
    expect(nodes[0].vx).toBeCloseTo(-nodes[1].vx, 10);
    expect(nodes[0].vx).not.toBeCloseTo(0, 6);
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

  // Sign alone can't catch the two stiffnesses wired to the wrong branches -- a swap still
  // pulls/pushes in the right direction, just at the wrong rate. This pins the MAGNITUDE to the
  // pure function called with the stiffness that branch is supposed to use, so a swap of
  // containmentStiffness <-> foreignStiffness (the ordering the doc comment calls load-bearing)
  // fails here instead of only showing up as a board that falls apart.
  test("a member's pull uses the containment stiffness, not the foreign one", () => {
    const a = card("card:a", 300, 0);
    const force = forceRoomContainment({
      roomsByNode: new Map([["card:a", ["ramp"]]]),
      circles,
      containmentStiffness: 0.02,
      foreignStiffness: 0.008,
    });
    force.initialize([a]);
    force(1);
    // dx/dy run from the room's centre to the card.
    const expected = containment(300, 0, 100, nodeRadius(a), 0.02);
    expect(a.vx).toBeCloseTo(expected.x, 10);
  });

  test("a non-member's push uses the foreign stiffness, not the containment one", () => {
    const a = card("card:a", 20, 0);
    const force = forceRoomContainment({
      roomsByNode: new Map([["card:a", ["lands"]]]),
      circles,
      containmentStiffness: 0.02,
      foreignStiffness: 0.008,
    });
    force.initialize([a]);
    force(1);
    const expected = foreignPush(20, 0, 100, nodeRadius(a), 0.008);
    expect(a.vx).toBeCloseTo(expected.x, 10);
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

  // Same guard, the other way a card can carry no rooms: no entry in the map at all (`mine ===
  // undefined`), not just an empty array. The guard is `!mine || mine.length === 0` -- only the
  // empty-array half is covered above.
  test("leaves a card with no roomsByNode entry completely alone", () => {
    const a = card("card:a", 20, 0);
    const force = forceRoomContainment({
      roomsByNode: new Map(),
      circles,
      containmentStiffness: 0.02,
      foreignStiffness: 0.008,
    });
    force.initialize([a]);
    force(1);
    expect(a.vx).toBe(0);
    expect(a.vy).toBe(0);
  });

  // The realistic multi-room case: a card that is a member of one circle and foreign to another
  // in the SAME tick, both centred at the origin so both contributions land on the same axis.
  // This is the only case where the per-circle summation (`n.vx += t.x`) actually does work --
  // every other test here has exactly one circle in play.
  test("sums a member pull and a foreign push from two different circles", () => {
    const twoCircles = (): ReadonlyMap<RoomId, Circle> =>
      new Map([
        ["ramp", { x: 0, y: 0, r: 100 }],
        ["lands", { x: 0, y: 0, r: 350 }],
      ]);
    const a = card("card:a", 300, 0);
    const force = forceRoomContainment({
      roomsByNode: new Map([["card:a", ["ramp"]]]), // member of ramp, foreign to lands
      circles: twoCircles,
      containmentStiffness: 0.02,
      foreignStiffness: 0.008,
    });
    force.initialize([a]);
    force(1);
    const r = nodeRadius(a);
    const expected =
      containment(300, 0, 100, r, 0.02).x + foreignPush(300, 0, 350, r, 0.008).x;
    expect(a.vx).toBeCloseTo(expected, 10);
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

describe("createBoardSimulation's stated invariants", () => {
  /** The board WALKS on its own -- this is the defect holdCardCentroid exists for, pinned so that
   *  a future anchor inside the simulation would be noticed rather than silently duplicating the
   *  pass. A common-mode velocity survives every force here (none of them is absolute for a roomed
   *  card) and integrates into net translation. Measured in the app at up to 67 units / 3 s. */
  test("does not anchor the board itself: a common-mode velocity translates it", () => {
    const nodes = Array.from({ length: 12 }, (_, i) => {
      const n = card(`card:${i}`, Math.cos(i) * 60, Math.sin(i) * 60);
      n.vx = 3; n.vy = -2;
      return n;
    });
    const { simulation } = createBoardSimulation({
      nodes, links: [], roomsByNode: new Map(), rooms: [],
      tallies: new Map(), visible: () => true,
    });
    const centroid = () => ({
      x: nodes.reduce((s, n) => s + n.x, 0) / nodes.length,
      y: nodes.reduce((s, n) => s + n.y, 0) / nodes.length,
    });
    const before = centroid();
    for (let i = 0; i < 200; i++) simulation.tick();
    const after = centroid();
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeGreaterThan(1);
  });

  /** And the same board with the pass GraphView's paint loop runs, which is where the fix lives. */
  test("holdCardCentroid in the loop holds it still", () => {
    const nodes = Array.from({ length: 12 }, (_, i) => {
      const n = card(`card:${i}`, Math.cos(i) * 60, Math.sin(i) * 60);
      n.vx = 3; n.vy = -2;
      return n;
    });
    const { simulation } = createBoardSimulation({
      nodes, links: [], roomsByNode: new Map(), rooms: [],
      tallies: new Map(), visible: () => true,
    });
    for (let i = 0; i < 200; i++) {
      simulation.tick();
      holdCardCentroid(nodes, nodes);
    }
    // Repulsion still spreads the ring, so individual nodes move a long way; the CENTROID must not.
    const x = nodes.reduce((s, n) => s + n.x, 0) / nodes.length;
    const y = nodes.reduce((s, n) => s + n.y, 0) / nodes.length;
    expect(Math.hypot(x, y)).toBeLessThan(1e-9);
  });

  // Stated as a HARD CONSTRAINT in three doc comments (foreignPush, forceRoomContainment,
  // CONTAINMENT) and asserted nowhere until now. The reverse expels cards from every room at once
  // and the board falls apart -- a whole-board failure that no unit test would localise.
  test("FOREIGN_PUSH stays below CONTAINMENT", () => {
    expect(FOREIGN_PUSH).toBeLessThan(CONTAINMENT);
  });

  // The simulation must come back STOPPED: GraphView's requestAnimationFrame paint loop is what
  // calls tick(), and d3's own d3-timer stepper would be a SECOND loop on a schedule independent
  // of paint. That failure is invisible -- the board just settles faster -- so it needs an
  // assertion rather than a code reading.
  //
  // Reads alpha rather than node positions because this test makes NO manual tick() calls between
  // its two assertions, so any alpha movement can only have come from an automatic second loop.
  // (An explicit tick() moves alpha too -- d3's manual tick runs the same
  // `alpha += (alphaTarget - alpha) * alphaDecay` step -- which is why the absence of tick() calls
  // is what makes alpha a clean signal here, not some property of alpha itself.) No flake risk in
  // the passing direction: a stopped timer cannot fire late.
  test("comes back stopped, so nothing ticks it but the caller", async () => {
    const a: Sim = { id: "card:a", kind: "card", label: "a", x: 10, y: 0, vx: 0, vy: 0, deg: 0 };
    const b: Sim = { id: "card:b", kind: "card", label: "b", x: -10, y: 0, vx: 0, vy: 0, deg: 0 };
    const { simulation } = createBoardSimulation({
      nodes: [a, b],
      links: [],
      roomsByNode: new Map([["card:a", ["ramp"]], ["card:b", ["ramp"]]]),
      rooms: [{ id: "ramp" }],
      tallies: new Map([["ramp", { count: 2, target: 0, under: false }]]),
      visible: () => true,
    });
    expect(simulation.alpha()).toBe(1);
    // Long enough for d3-timer to have fired several times (it steps on rAF, or setTimeout ~17ms
    // without one) had the simulation been left running.
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(simulation.alpha()).toBe(1);
  });
});

describe("holdCardCentroid", () => {
  test("puts the cards' centroid on the origin", () => {
    const a = card("card:a", 100, 40), b = card("card:b", 120, 60);
    holdCardCentroid([a, b], [a, b]);
    expect((a.x + b.x) / 2).toBeCloseTo(0, 10);
    expect((a.y + b.y) / 2).toBeCloseTo(0, 10);
  });

  // The property that makes it free: a rigid translation changes no distance between any two
  // nodes, so no room circle, overlap, escape or intrusion can move. Every acceptance metric is
  // blind to it, which is why it needs no retune.
  test("preserves every pairwise distance", () => {
    const a = card("card:a", 100, 40), b = card("card:b", 120, 60);
    const before = Math.hypot(a.x - b.x, a.y - b.y);
    holdCardCentroid([a, b], [a, b]);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeCloseTo(before, 10);
  });

  // Moves every node, not just the cards: the non-card nodes are held to the cards by ~1,300 link
  // springs, so translating cards alone would stretch every one of them and the springs would drag
  // the board back next tick.
  test("carries the non-card nodes along", () => {
    const a = card("card:a", 10, 0);
    const e: Sim = { id: "event:x", kind: "event", label: "x", x: 30, y: 0, vx: 0, vy: 0, deg: 0 };
    holdCardCentroid([a, e], [a]);
    expect(a.x).toBeCloseTo(0, 10);
    expect(e.x).toBeCloseTo(20, 10);
  });

  // Velocity is the simulation's business, not this pass's. Zeroing it here would fight the
  // settling the board is still doing.
  test("leaves velocity alone", () => {
    const a = card("card:a", 50, 50);
    a.vx = 3; a.vy = -4;
    holdCardCentroid([a], [a]);
    expect([a.vx, a.vy]).toEqual([3, -4]);
  });

  // Same skip projectRoomMembership makes for a card claiming no room: no claim, no move.
  // NOT reachable by toggling the card chip off -- GraphView's `simCards` filters on kind alone,
  // with no visibility filter (owner's ruling: hidden cards still anchor the board). This is the
  // degenerate no-card-nodes graph only. Do not "fix" GraphView to match it.
  test("does nothing without cards", () => {
    const e: Sim = { id: "event:x", kind: "event", label: "x", x: 30, y: 7, vx: 0, vy: 0, deg: 0 };
    holdCardCentroid([e], []);
    expect([e.x, e.y]).toEqual([30, 7]);
  });
});

describe("countOverlaps", () => {
  test("counts a pair once, not twice", () => {
    expect(countOverlaps([{ x: 0, y: 0 }, { x: 10, y: 0 }])).toBe(1);
  });

  test("exactly 2 * ART_RADIUS apart is not an overlap", () => {
    expect(countOverlaps([{ x: 0, y: 0 }, { x: 2 * ART_RADIUS, y: 0 }])).toBe(0);
  });

  test("a hair closer than 2 * ART_RADIUS is", () => {
    expect(countOverlaps([{ x: 0, y: 0 }, { x: 2 * ART_RADIUS - 0.01, y: 0 }])).toBe(1);
  });

  test("counts every overlapping pair, not every overlapping card", () => {
    // Three mutually overlapping cards are three pairs.
    expect(countOverlaps([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }])).toBe(3);
  });

  test("is zero for fewer than two cards", () => {
    expect(countOverlaps([])).toBe(0);
    expect(countOverlaps([{ x: 0, y: 0 }])).toBe(0);
  });
});

describe("projectRoomMembership", () => {
  const circles = (...cs: [string, number, number, number][]) =>
    new Map<RoomId, Circle>(cs.map(([id, x, y, r]) => [id, { x, y, r }]));

  // maxPasses 0 runs no ejection at all, so these two read the REPORT rule on its own -- which is
  // the only way to see it, since the pass would otherwise fix any violation it can reach.
  //
  // The report is deliberately slacker than the pass. RIM_SLACK (1e-6) absorbs float residue
  // against the geometry the pass was HANDED; REPORT_SLACK (0.1 world units) absorbs the circles
  // moving between the pass and the report, because the pass just moved their members. Measured
  // worst case ~0.002 units, and it was failing the acceptance gate on inalla's role preset.
  test("does not report a violation shallower than the report slack", () => {
    // 0.05 units inside a foreign rim: 0.36% of a card radius, sub-pixel until ~10x zoom.
    const n = card("card:a", 100 + ART_RADIUS - 0.05, 0);
    expect(projectRoomMembership(
      [n], () => circles(["ramp", 0, 0, 100]), new Map([["card:a", ["lands"]]]), 0,
    )).toBe(0);
  });

  test("does report one deeper than it", () => {
    const n = card("card:a", 100 + ART_RADIUS - 0.5, 0);
    expect(projectRoomMembership(
      [n], () => circles(["ramp", 0, 0, 100]), new Map([["card:a", ["lands"]]]), 0,
    )).toBe(1);
  });

  test("moves a non-member until its NEAR rim clears the room's rim, and no further", () => {
    const n = card("card:a", 10, 0); // deep inside a circle centred on the origin
    const unresolved = projectRoomMembership(
      [n], () => circles(["ramp", 0, 0, 100]), new Map([["card:a", ["lands"]]]),
    );
    expect(unresolved).toBe(0);
    // near rim clears exactly: distance - cardR === roomR
    expect(Math.hypot(n.x, n.y) - ART_RADIUS).toBeCloseTo(100, 6);
    expect(n.y).toBeCloseTo(0, 6); // pushed straight out along the centre->card direction
  });

  test("leaves a member alone however deep inside its own room it sits", () => {
    const n = card("card:a", 1, 0);
    projectRoomMembership(
      [n], () => circles(["ramp", 0, 0, 100]), new Map([["card:a", ["ramp"]]]),
    );
    expect(n.x).toBe(1);
    expect(n.y).toBe(0);
  });

  test("pulls a single-room card back inside its own room, to the FAR rim", () => {
    // The other half of the same constraint. Ejecting non-members alone dragged single-room cards
    // out of their own rooms: escapes.one 0 -> 54 across ten trials, at every FOREIGN_PUSH arm.
    const n = card("card:a", 300, 0);
    const unresolved = projectRoomMembership(
      [n], () => circles(["ramp", 0, 0, 100]), new Map([["card:a", ["ramp"]]]),
    );
    expect(unresolved).toBe(0);
    // containment's reading, not foreignPush's: the whole disc is inside, so d + cardR === roomR.
    expect(Math.hypot(n.x, n.y) + ART_RADIUS).toBeCloseTo(100, 6);
    expect(n.y).toBeCloseTo(0, 6);
  });

  test("zeroes the outward velocity of a card it pulls back in", () => {
    const n = card("card:a", 300, 0);
    n.vx = 5; // still heading out
    n.vy = 3; // tangential
    projectRoomMembership(
      [n], () => circles(["ramp", 0, 0, 100]), new Map([["card:a", ["ramp"]]]),
    );
    expect(n.vx).toBeCloseTo(0, 10);
    expect(n.vy).toBeCloseTo(3, 10);
  });

  test("leaves a card in TWO rooms outside both of them, rather than oscillating", () => {
    // Two rooms whose circles do not overlap give a two-room card no legal position at all, and
    // hard-projecting it would make it vibrate between irreconcilable demands. That is exactly
    // what escapes.two being a SOFT metric concedes -- those cards keep the containment force and
    // nothing more, so this pass must not touch them.
    const n = card("card:a", 0, 0);
    const unresolved = projectRoomMembership(
      [n],
      () => circles(["a", -500, 0, 100], ["b", 500, 0, 100]),
      new Map([["card:a", ["a", "b"]]]),
    );
    expect(n.x).toBe(0);
    expect(n.y).toBe(0);
    // Outside both of its own rooms, but it is not a card the pass failed to place -- it never
    // claimed to place it.
    expect(unresolved).toBe(0);
  });

  test("leaves a card in NO room alone", () => {
    const n = card("card:a", 1, 0);
    projectRoomMembership([n], () => circles(["ramp", 0, 0, 100]), new Map());
    expect(n.x).toBe(1);
  });

  test("leaves a card already outside alone", () => {
    const n = card("card:a", 500, 0);
    projectRoomMembership(
      [n], () => circles(["ramp", 0, 0, 100]), new Map([["card:a", ["lands"]]]),
    );
    expect(n.x).toBe(500);
  });

  test("zeroes the inward velocity component and keeps the tangential one", () => {
    const n = card("card:a", 10, 0);
    n.vx = -5; // straight at the centre
    n.vy = 3;  // tangential
    projectRoomMembership(
      [n], () => circles(["ramp", 0, 0, 100]), new Map([["card:a", ["lands"]]]),
    );
    expect(n.vx).toBeCloseTo(0, 10);
    expect(n.vy).toBeCloseTo(3, 10);
  });

  test("does not touch an OUTWARD velocity", () => {
    const n = card("card:a", 10, 0);
    n.vx = 5; // already leaving
    projectRoomMembership(
      [n], () => circles(["ramp", 0, 0, 100]), new Map([["card:a", ["lands"]]]),
    );
    expect(n.vx).toBeCloseTo(5, 10);
  });

  test("resolves two overlapping circles by iterating", () => {
    // Two circles 120 apart, radius 100 each: they overlap, and leaving A lands you in B. Started
    // just OFF the axis joining the centres -- see the limit-cycle test below for why on-axis is a
    // different case rather than a harder version of this one. Takes two passes: the first pass's
    // ejection from B puts the card back inside A.
    const n = card("card:a", 0, 5);
    const unresolved = projectRoomMembership(
      [n],
      () => circles(["a", -60, 0, 100], ["b", 60, 0, 100]),
      new Map([["card:a", ["lands"]]]),
    );
    expect(unresolved).toBe(0);
    for (const c of [{ x: -60, y: 0 }, { x: 60, y: 0 }]) {
      expect(Math.hypot(n.x - c.x, n.y - c.y) - ART_RADIUS).toBeGreaterThanOrEqual(100 - 1e-6);
    }
  });

  test("counts a card it could not free within the pass ceiling", () => {
    // Same geometry as the test above, which needs two passes. With the ceiling at 1 it stops
    // still illegal and says so instead of pretending otherwise -- this is about WORK, not
    // impossibility.
    const n = card("card:a", 0, 5);
    const unresolved = projectRoomMembership(
      [n],
      () => circles(["a", -60, 0, 100], ["b", 60, 0, 100]),
      new Map([["card:a", ["lands"]]]),
      1, // the shipped default is PROJECTION_PASSES
    );
    expect(unresolved).toBe(1);
  });

  test("counts, rather than loops on, a card trapped between two collinear circles", () => {
    // A card exactly on the line joining two overlapping centres is a LIMIT CYCLE, not slow
    // convergence: both pushes are along that line, so the card is thrown from A to B and back
    // forever at the same two positions, and every legal position is off the line the projection
    // can never leave. Legal positions do exist (finitely many discs never cover the plane) --
    // this pass just cannot reach them from here.
    //
    // Reported as unresolved, which is the whole reason that return value exists. The board's
    // recourse is the next frame: the circles are recomputed from member positions every tick, so
    // the symmetry that traps the card is gone as soon as anything else moves.
    const n = card("card:a", 0, 0);
    const unresolved = projectRoomMembership(
      [n],
      () => circles(["a", -60, 0, 100], ["b", 60, 0, 100]),
      new Map([["card:a", ["lands"]]]),
    );
    expect(unresolved).toBe(1);
  });

  test("enforces a universal room like any other -- there is no exemption branch", () => {
    // The caller passes circles; universality is not a property this function can see, and that
    // is the point. A room holding every card still bars a non-member.
    const n = card("card:a", 0, 0);
    projectRoomMembership(
      [n], () => circles(["colour:black", 0, 0, 400]), new Map([["card:a", ["colour:red"]]]),
    );
    expect(Math.hypot(n.x, n.y) - ART_RADIUS).toBeCloseTo(400, 6);
  });

  test("pushes a card sitting exactly on the centre along +x rather than skipping it", () => {
    const n = card("card:a", 0, 0);
    projectRoomMembership(
      [n], () => circles(["ramp", 0, 0, 100]), new Map([["card:a", ["lands"]]]),
    );
    expect(n.x).toBeCloseTo(100 + ART_RADIUS, 6);
    expect(n.y).toBeCloseTo(0, 6);
  });
});

/** One settled layout of the inalla fixture on the role preset, with the acceptance defaults
 *  (preset 0, 800 ticks, pin on). The trial body lives in board-trial.ts so the measurement
 *  harness runs the SAME loop -- they had a copy each and the copies drifted. */
const runTrial = boardTrial(inalla as TrialFixture);

describe("the settled board, ten trials on inalla.txt", () => {
  const trials = Array.from({ length: 10 }, (_, i) => runTrial(i + 1));

  // Hard condition. A single-room card outside its own room is the board failing at the one
  // thing it claims to show.
  test("no single-room card escapes its room, in any trial", () => {
    expect(trials.map((t) => t.escapes.one)).toEqual(new Array(10).fill(0));
  });

  // Hard condition, and the one design 3.2 puts at risk: forceCollide adjusts velocity where
  // the separation() it replaces adjusted position.
  test("no two card discs overlap, in any trial", () => {
    expect(trials.map((t) => t.overlaps)).toEqual(new Array(10).fill(0));
  });

  /** The INTRUSION_CAP ratchet is gone, LOWERED to an exact zero per trial by
   *  projectRoomMembership -- which is what the ratchet's own comment demanded be done the moment
   *  a change improved the number. It stood at 60 across ten trials and the soft force settled at
   *  14; the projection makes it a post-condition instead of a budget.
   *
   *  Printed rather than only asserted: these five numbers are the arms in
   *  2026-08-08-d3-migration-measurements.md, and a run of this file is how the next arm gets
   *  measured. */
  test("prints the five acceptance numbers, so a tuning arm is one run away", () => {
    process.stdout.write(`MEASURE ${JSON.stringify({
      escapesOne: trials.map((t) => t.escapes.one),
      escapesTwo: trials.map((t) => t.escapes.two),
      intrusions: trials.map((t) => t.intrusions),
      overlaps: trials.map((t) => t.overlaps),
      unresolved: trials.map((t) => t.unresolved),
    })}\n`);
    expect(trials).toHaveLength(10);
  });

  // The rule this work exists for: a card inside a circle belongs to that room. Not a budget.
  test("no card sits inside a room it does not belong to, in any trial", () => {
    expect(trials.map((t) => t.intrusions)).toEqual(new Array(10).fill(0));
  });

  /** Zero, not a ratchet. A cap of 4 was written here first, on a measured residual that turned
   *  out to be a defect and not geometry: the pass moves a card to LAND on a rim, and the recheck
   *  recomputing `d + cardR` from the moved position saw a violation of ~1e-14, moved it again,
   *  and burned all 64 passes reporting failure on a board that was already legal. RIM_SLACK
   *  absorbs the residue and the whole residual goes with it.
   *
   *  Pinned per trial rather than as a total, because after the fix there is nothing to trade. */
  test("the projection places every card, in any trial", () => {
    expect(trials.map((t) => t.unresolved)).toEqual(new Array(10).fill(0));
  });
});

describe("BoardParams", () => {
  // A simulation over two unroomed cards -- enough to build every force. roomsByNode empty means
  // both are unzoned, which is also what exercises CENTER_PULL.
  function sim(params?: Partial<BoardParams>) {
    const nodes = [card("card:a", -50, 0), card("card:b", 50, 0)];
    return createBoardSimulation({
      nodes,
      links: [],
      roomsByNode: new Map(),
      rooms: [],
      tallies: new Map(),
      visible: () => true,
      params,
    }).simulation;
  }

  test("DEFAULT_PARAMS carries the exported constants", () => {
    expect(DEFAULT_PARAMS.repulsion).toBe(REPULSION);
    expect(DEFAULT_PARAMS.containment).toBe(CONTAINMENT);
    expect(DEFAULT_PARAMS.foreignPush).toBe(FOREIGN_PUSH);
  });

  test("an override reaches the force it names", () => {
    const charge = sim({ repulsion: 999 }).force("charge") as ReturnType<typeof forceManyBody>;
    // forceManyBody stores strength as a per-node accessor, so read it back through the accessor.
    expect((charge.strength() as (n: Sim, i: number, ns: Sim[]) => number)(
      card("card:a", 0, 0), 0, [],
    )).toBe(-999);
  });

  test("an absent key falls back to the exported constant", () => {
    const s = sim({ repulsion: 999 });
    expect(s.velocityDecay()).toBeCloseTo(VELOCITY_DECAY, 10);
    expect(s.alphaDecay()).toBeCloseTo(ALPHA_DECAY, 10);
    expect(s.alphaTarget()).toBeCloseTo(ALPHA_FLOOR, 10);
  });

  test("no params at all is the same simulation as before", () => {
    const s = sim();
    expect(s.velocityDecay()).toBeCloseTo(VELOCITY_DECAY, 10);
    const charge = s.force("charge") as ReturnType<typeof forceManyBody>;
    expect((charge.strength() as (n: Sim, i: number, ns: Sim[]) => number)(
      card("card:a", 0, 0), 0, [],
    )).toBe(-REPULSION);
  });

  // Fix round 1: the four tests above only round-trip `repulsion` through a real force, plus check
  // velocityDecay/alphaDecay/alphaFloor in their FALLBACK (unset) form. Reverting any of the other
  // seven `p.x` references in createBoardSimulation back to a bare constant left every test above
  // green. Each test below pins one of the remaining nine keys through the actual force it wires.

  test("linkStiffness override reaches the link force", () => {
    const link = sim({ linkStiffness: 0.5 }).force("link") as ReturnType<typeof forceLink>;
    // forceLink stores strength as a per-link accessor, same idiom as charge's -- the accessor is
    // a constant function here (a bare number was passed to .strength()), so any link datum reads
    // the same value back.
    const dummyLink = { source: card("card:a", 0, 0), target: card("card:b", 0, 0) };
    expect((link.strength() as (l: typeof dummyLink, i: number, ls: unknown[]) => number)(
      dummyLink, 0, [],
    )).toBe(0.5);
  });

  test("centerPull override reaches the x and y centering forces", () => {
    // roomsByNode is empty in sim(), so both cards are unzoned and centerPull is what strength()
    // returns for either of them.
    const s = sim({ centerPull: 0.5 });
    const x = s.force("x") as ReturnType<typeof forceX>;
    const y = s.force("y") as ReturnType<typeof forceY>;
    expect((x.strength() as (n: Sim, i: number, ns: Sim[]) => number)(
      card("card:a", 0, 0), 0, [],
    )).toBe(0.5);
    expect((y.strength() as (n: Sim, i: number, ns: Sim[]) => number)(
      card("card:a", 0, 0), 0, [],
    )).toBe(0.5);
  });

  test("collideIterations override reaches the collide force", () => {
    const collide = sim({ collideIterations: 7 }).force("collide") as ReturnType<typeof forceCollide>;
    expect(collide.iterations()).toBe(7);
  });

  test("velocityDecay, alphaDecay and alphaFloor overrides reach the simulation", () => {
    // The existing "absent key falls back" test only exercises these three at their DEFAULT
    // value (repulsion was the only key overridden there). This pins the override itself.
    const s = sim({ velocityDecay: 0.5, alphaDecay: 0.1, alphaFloor: 0.3 });
    expect(s.velocityDecay()).toBeCloseTo(0.5, 10);
    expect(s.alphaDecay()).toBeCloseTo(0.1, 10);
    expect(s.alphaTarget()).toBeCloseTo(0.3, 10);
  });

  // roomAttraction, containment and foreignPush are custom closures (forceRoomAttraction /
  // forceRoomContainment) with no d3 accessor to read back, so each is pinned behaviourally: build
  // a two-card room, invoke the bound force directly (already initialize()d by createBoardSimulation
  // via simulation.force(name, force)), and check the imparted velocity scales linearly with the
  // override -- exactly the relationship roomAttraction()/containment()/foreignPush() themselves
  // implement (force = depth-or-distance * stiffness). A 10x stiffness must give a 10x velocity.

  test("roomAttraction override scales the pull between two cards sharing a room", () => {
    const pull = (roomAttraction: number) => {
      const a = card("card:a", -50, 0);
      const b = card("card:b", 50, 0);
      const { simulation } = createBoardSimulation({
        nodes: [a, b],
        links: [],
        roomsByNode: new Map([["card:a", ["ramp"]], ["card:b", ["ramp"]]]),
        rooms: [{ id: "ramp" }],
        tallies: new Map(),
        visible: () => true,
        params: { roomAttraction },
      });
      simulation.force<CustomForce>("rooms")!(1);
      return a.vx;
    };
    const weak = pull(0.008);
    const strong = pull(0.08);
    expect(weak).toBeGreaterThan(0); // a sits left, pulled right toward b
    expect(strong).toBeCloseTo(weak * 10, 6);
  });

  test("containment override scales the pull back into a room a card has drifted outside of", () => {
    // card:a sits far outside the "ramp" circle its own membership implies; card:b anchors the
    // room's centroid away from a so containment has real depth to correct.
    const push = (containmentStiffness: number) => {
      const a = card("card:a", -200, 0);
      const b = card("card:b", 50, 0);
      const { simulation } = createBoardSimulation({
        nodes: [a, b],
        links: [],
        roomsByNode: new Map([["card:a", ["ramp"]], ["card:b", ["ramp"]]]),
        rooms: [{ id: "ramp" }],
        tallies: new Map(),
        visible: () => true,
        params: { containment: containmentStiffness },
      });
      simulation.force<CustomForce>("containment")!(1);
      return a.vx;
    };
    const weak = push(0.02);
    const strong = push(0.2);
    expect(weak).toBeGreaterThan(0); // pulled right, back toward the room's centroid
    expect(strong).toBeCloseTo(weak * 10, 6);
  });

  test("foreignPush override scales the push out of a room a card does not belong to", () => {
    // card:c is not a "ramp" member but sits well inside the circle a and b's membership draws.
    // It must belong to SOME room, though -- forceRoomContainment skips a card with no membership
    // at all ("makes no claim about where it should NOT be either"), so a bare non-member is
    // silently exempt and foreignPush would never fire on it.
    const push = (foreignStiffness: number) => {
      const a = card("card:a", -50, 0);
      const b = card("card:b", 50, 0);
      const outsider = card("card:c", 10, 0);
      const { simulation } = createBoardSimulation({
        nodes: [a, b, outsider],
        links: [],
        roomsByNode: new Map([
          ["card:a", ["ramp"]], ["card:b", ["ramp"]], ["card:c", ["other"]],
        ]),
        rooms: [{ id: "ramp" }],
        tallies: new Map(),
        visible: () => true,
        params: { foreignPush: foreignStiffness },
      });
      simulation.force<CustomForce>("containment")!(1);
      return outsider.vx;
    };
    const weak = push(0.008);
    const strong = push(0.08);
    expect(weak).toBeGreaterThan(0); // pushed right, away from the room's centroid
    expect(strong).toBeCloseTo(weak * 10, 6);
  });
});
