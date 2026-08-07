import { describe, expect, test } from "vitest";
import {
  boardMetrics,
  containment,
  CONTAINMENT,
  createBoardSimulation,
  FOREIGN_PUSH,
  forceRoomAttraction,
  forceRoomContainment,
  foreignPush,
  nodeRadius,
  universalRooms,
  type Sim,
} from "./board-force.js";
import { ART_RADIUS, roomTallies } from "./deck-rooms.js";
import type { Circle, RoomId } from "./deck-rooms.js";
import { PRESETS, cardFacts, roomsForFacts } from "./presets.js";
import inalla from "../fixtures/inalla-graph.json" with { type: "json" };
import type { CardGraph } from "../types.js";

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
    expect(b.vx).toBe(0);
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
      universal: new Set(),
      visible: () => true,
    });
    expect(simulation.alpha()).toBe(1);
    // Long enough for d3-timer to have fired several times (it steps on rAF, or setTimeout ~17ms
    // without one) had the simulation been left running.
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(simulation.alpha()).toBe(1);
  });
});

/** A seeded LCG, so a trial is reproducible from its seed. d3-force is itself deterministic
 *  (it seeds its own fixed LCG), so ALL trial-to-trial variance has to come from the initial
 *  seeding -- which is exactly where it comes from in the browser today, via Math.random() in
 *  seedPosition's fallback. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (1664525 * s + 1013904223) >>> 0) / 4294967296);
}

/** One settled layout of the inalla fixture on the role preset. */
function runTrial(seed: number) {
  const graph = inalla.graph as CardGraph;
  const random = lcg(seed);
  const comboCards = new Set(inalla.combos.flatMap((c) => c.cards));
  const facts = cardFacts(graph, comboCards);
  // The role preset's rooms, not deck-rooms.ts's bare ROOMS: roomsForFacts needs each room's
  // `test` predicate, which only the preset builds. Same seven rooms, same order.
  const rooms = PRESETS[0].rooms(facts);
  const roomsByNode = new Map<string, readonly RoomId[]>(
    facts.map((f) => [f.id, roomsForFacts(rooms, f)]),
  );

  const cardRooms = new Map<string, readonly RoomId[]>();
  const copies = new Map<string, number>();
  for (const n of graph.nodes) {
    if (n.kind !== "card") continue;
    cardRooms.set(n.label, roomsByNode.get(n.id) ?? []);
    copies.set(n.label, n.copies ?? 1);
  }
  const tallies = roomTallies(
    cardRooms,
    rooms.map((r) => ({ id: r.id, categories: r.categories ?? [] })),
    inalla.buildCategories,
    copies,
  );

  // Only card nodes are visible on first paint (DIM_BY_DEFAULT hides every other kind), which
  // is the state the acceptance condition is about.
  const nodes: Sim[] = graph.nodes.map((n, i) => ({
    ...n,
    x: Math.cos(i) * 260 + random() * 30,
    y: Math.sin(i) * 260 + random() * 30,
    vx: 0, vy: 0, deg: 0,
  }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const links = graph.edges
    .map((e) => ({ source: byId.get(e.from)!, target: byId.get(e.to)! }))
    .filter((l) => l.source && l.target);
  for (const l of links) { l.source.deg++; l.target.deg++; }

  const visible = (n: Sim) => n.kind === "card";
  const universal = universalRooms(
    rooms.map((r) => r.id),
    nodes.filter(visible).map((n) => roomsByNode.get(n.id) ?? []),
  );

  const { simulation, roomCircles } = createBoardSimulation({
    nodes, links, roomsByNode, rooms, tallies, universal, visible,
  });

  // 800 ticks. NOT because alpha has reached its floor -- it has not, and the arithmetic that
  // once claimed so here was wrong. d3's update is `alpha += (alphaTarget - alpha) * alphaDecay`,
  // so with alphaTarget 0.02 the trajectory is `alpha_n = 0.02 + 0.98 * 0.995^n`, an exponential
  // approach to the floor rather than a decay to zero that crosses it. At n=800 alpha is 0.0378,
  // still ~1.9x the floor; within 5% of it takes ~1375 ticks. (The old "~781" was the
  // decay-to-ZERO crossing, which ignores the alphaTarget term -- i.e. exactly the thing
  // alphaTarget was chosen over alphaMin to provide.)
  //
  // 800 is nonetheless enough, for a reason that has nothing to do with the floor: every force
  // here except collide scales linearly in alpha, so alpha sets how FAST the board converges and
  // not where it converges TO. The equilibrium is alpha-independent. Measured, ten trials each:
  // at 1600 / 3000 / 6000 ticks escapes.one stays 0 and overlaps stay 0/10, intrusions settle
  // 14 -> 11 and escapes.two drifts 55 -> 60. See 2026-08-08-d3-migration-measurements.md.
  for (let i = 0; i < 800; i++) simulation.tick();

  const cards = nodes.filter(visible);
  const circles = [...roomCircles().entries()].map(([id, c]) => ({ id, ...c }));
  const metrics = boardMetrics(
    cards.map((n) => ({ x: n.x, y: n.y, rooms: roomsByNode.get(n.id) ?? [] })),
    circles,
  );

  // The Task-9 no-overlap gate: two card discs closer than 2 * ART_RADIUS visibly overlap.
  let overlaps = 0;
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      if (Math.hypot(cards[i].x - cards[j].x, cards[i].y - cards[j].y) < 2 * ART_RADIUS) overlaps++;
    }
  }
  return { ...metrics, overlaps };
}

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

  /** A RATCHET, not a pin. PACK 0.5 already traded intrusions away to buy escapes.one
   *  (measured: escapes 13 -> 5 -> 2 against intrusions 1 -> 8 -> 26 at PACK 0.7/0.6/0.5), so
   *  pinning d3 to the old ~26 would re-fight a battle deliberately lost. The cap is loose
   *  enough to let the axis float and tight enough that a collapse still fails.
   *
   *  Same idiom as pair-calibration.test.ts's KNOWN_DEFECT_CAP: raise it only with a written
   *  reason, LOWER it the moment a change improves the number. A cap nobody lowers is
   *  decoration. */
  const INTRUSION_CAP = 60;
  test("intrusions stay under the cap", () => {
    const total = trials.reduce((sum, t) => sum + t.intrusions, 0);
    console.log("intrusions across ten trials:", trials.map((t) => t.intrusions), "total", total);
    expect(total).toBeLessThanOrEqual(INTRUSION_CAP);
  });
});
