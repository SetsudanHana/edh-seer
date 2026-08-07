import { describe, expect, it } from "vitest";
import {
  ROOMS, ROOM_HUE, OVERFLOW_HUE, roomsForCard, roomTallies, subcategoryLabel,
  roomLayout, rimArcs, type Circle, type RoomId, type RoomMember, type RoomTally,
} from "./deck-rooms.js";

describe("ROOMS", () => {
  it("declares exactly the seven rooms, strategy first", () => {
    expect(ROOMS.map((r) => r.id)).toEqual([
      "strategy", "wincons", "cardAdvantage", "ramp", "lands", "interaction", "boardWipes",
    ]);
  });

  it("covers all eleven build categories exactly once across the non-fallback rooms", () => {
    const all = ROOMS.flatMap((r) => r.categories);
    expect([...all].sort()).toEqual([
      "boardWipe", "burn", "cardSelection", "draw", "lands", "protection",
      "ramp", "stackInteraction", "stax", "targetedRemoval", "tutor",
    ].sort());
    expect(new Set(all).size).toBe(all.length);
  });

  it("gives every room a distinct hue", () => {
    const hues = ROOMS.map((r) => ROOM_HUE[r.id]);
    expect(new Set(hues).size).toBe(ROOMS.length);
  });
});

describe("roomsForCard", () => {
  const none = new Set<string>();

  it("maps a role to its room", () => {
    expect(roomsForCard(["draw"], "Rhystic Study", none)).toEqual(["cardAdvantage"]);
    expect(roomsForCard(["targetedRemoval"], "Swords", none)).toEqual(["interaction"]);
    expect(roomsForCard(["stax"], "Winter Orb", none)).toEqual(["interaction"]);
    expect(roomsForCard(["burn"], "Bolt", none)).toEqual(["wincons"]);
    expect(roomsForCard(["tutor"], "Demonic Tutor", none)).toEqual(["wincons"]);
  });

  it("returns every room a multi-role card belongs to, in ROOMS order", () => {
    expect(roomsForCard(["targetedRemoval", "draw"], "Fire Covenant", none))
      .toEqual(["cardAdvantage", "interaction"]);
  });

  it("falls back to strategy for a card nothing else claims", () => {
    expect(roomsForCard([], "Some Wizard", none)).toEqual(["strategy"]);
    expect(roomsForCard(undefined, "Some Wizard", none)).toEqual(["strategy"]);
  });

  it("does not add the strategy fallback when another room already claimed the card", () => {
    expect(roomsForCard(["ramp"], "Sol Ring", none)).toEqual(["ramp"]);
  });

  it("does not put a categorised card in strategy just because an archetype names it", () => {
    expect(roomsForCard(["ramp"], "Sol Ring", new Set())).toEqual(["ramp"]);
  });

  it("puts a card no room claims in strategy", () => {
    expect(roomsForCard([], "Archmage of Echoes", new Set())).toEqual(["strategy"]);
  });

  it("puts a combo piece in wincons even with no roles", () => {
    expect(roomsForCard([], "Thassa's Oracle", new Set(["Thassa's Oracle"]))).toEqual(["wincons"]);
  });
});

describe("subcategoryLabel", () => {
  it("uses plain language for the jargon categories", () => {
    expect(subcategoryLabel("cardSelection")).toBe("digging");
    expect(subcategoryLabel("stackInteraction")).toBe("counterspells");
    expect(subcategoryLabel("stax")).toBe("taxes & locks");
    expect(subcategoryLabel("tutor")).toBe("deck search");
    expect(subcategoryLabel("ramp")).toBe("extra mana");
  });

  it("falls back to the raw key for anything unmapped", () => {
    expect(subcategoryLabel("someUnknownCategory")).toBe("someUnknownCategory");
  });

  it("leaves protection untranslated -- it's already plain English (Task 1 decision, not a gap)", () => {
    expect(subcategoryLabel("protection")).toBe("protection");
  });
});

describe("roomTallies", () => {
  // Targets deliberately differ from BASE_TARGETS (draw 10, cardSelection 4, boardWipe 3 in
  // build.ts) so a regression that hardcodes base targets instead of summing what was passed
  // in fails loudly, rather than passing by coincidence.
  const build = [
    { category: "draw", count: 7, target: 7 },
    { category: "cardSelection", count: 3, target: 2 },
    { category: "boardWipe", count: 0, target: 1 },
    { category: "burn", count: 5, target: 0 },
    { category: "tutor", count: 2, target: 0 },
  ];

  it("counts distinct cards per room from cardRooms, not by summing buildCategories[].count", () => {
    // guards summing draw.count(7) + cardSelection.count(3) = 10 instead of counting cardRooms'
    // 2 entries. Note: cardRooms arrives already room-resolved and deduped by roomsForCard, so
    // this cannot (and does not attempt to) test a single card double-counted within one room.
    const cardRooms = new Map([
      ["Ponder", ["cardAdvantage"] as const],
      ["Rhystic Study", ["cardAdvantage"] as const],
    ]);
    const t = roomTallies(cardRooms, ROOMS, build);
    expect(t.get("cardAdvantage")!.count).toBe(2);
  });

  it("sums the archetype-adjusted targets of a room's subcategories", () => {
    const t = roomTallies(new Map(), ROOMS, build);
    expect(t.get("cardAdvantage")!.target).toBe(9); // draw 7 + cardSelection 2, the SUM
    expect(t.get("cardAdvantage")!.target).not.toBe(7); // not just one operand
    expect(t.get("cardAdvantage")!.target).not.toBe(2); // not just the other
    expect(t.get("boardWipes")!.target).toBe(1);
  });

  it("reports target 0 for a room whose subcategories all have target 0", () => {
    const t = roomTallies(new Map(), ROOMS, build);
    expect(t.get("wincons")!.target).toBe(0); // burn 0 + tutor 0
    expect(t.get("wincons")!.under).toBe(false);
  });

  it("flags a room under its target", () => {
    const t = roomTallies(new Map(), ROOMS, build);
    expect(t.get("boardWipes")).toEqual({ count: 0, target: 1, under: true });
  });

  it("does not flag a room at or over its target", () => {
    const cardRooms = new Map(
      Array.from({ length: 9 }, (_, i) => [`c${i}`, ["cardAdvantage"] as const]),
    );
    expect(roomTallies(cardRooms, ROOMS, build).get("cardAdvantage")!.under).toBe(false);
  });

  it("returns an entry for every room even with no data at all", () => {
    const t = roomTallies(new Map(), ROOMS, undefined);
    expect(t.size).toBe(7);
    expect(t.get("strategy")).toEqual({ count: 0, target: 0, under: false });
  });

  it("counts copies, not distinct names", () => {
    const cardRooms = new Map([["Mountain", ["lands"] as const], ["Island", ["lands"] as const]]);
    const copies = new Map([["Mountain", 24]]);
    const t = roomTallies(cardRooms, ROOMS, [{ category: "lands", count: 25, target: 36 }], copies);
    expect(t.get("lands")!.count).toBe(25); // 24 Mountains + 1 Island
  });

  it("treats a card with no copies entry as a single copy", () => {
    expect(roomTallies(new Map([["Sol Ring", ["ramp"] as const]]), ROOMS, undefined, new Map()).get("ramp")!.count).toBe(1);
  });

  it("ignores a buildCategories entry no room claims, without throwing or perturbing tallies", () => {
    const withOrphan = [...build, { category: "notARoomCategory", count: 99, target: 99 }];
    expect(() => roomTallies(new Map(), ROOMS, withOrphan)).not.toThrow();
    const t = roomTallies(new Map(), ROOMS, withOrphan);
    expect(t.get("cardAdvantage")!.target).toBe(9);
    expect(t.get("boardWipes")!.target).toBe(1);
    expect(t.get("wincons")!.target).toBe(0);
  });
});

describe("roomLayout", () => {
  const noTallies = new Map<RoomId, RoomTally>();
  const tallyOf = (target: number): RoomTally => ({ count: 0, target, under: target > 0 });

  it("draws a room around its one member", () => {
    const rooms = roomLayout([{ x: 10, y: 20, r: 5, rooms: ["ramp"] }], ROOMS, noTallies);
    expect(rooms.get("ramp")).toEqual({ x: 10, y: 20, r: 5 });
  });

  it("centres a room on the centroid of its members", () => {
    const rooms = roomLayout(
      [
        { x: 0, y: 0, r: 2, rooms: ["ramp"] },
        { x: 10, y: 0, r: 2, rooms: ["ramp"] },
      ],
      ROOMS,
      noTallies,
    );
    expect(rooms.get("ramp")!.x).toBe(5);
    expect(rooms.get("ramp")!.y).toBe(0);
  });

  it("reaches the far rim of the furthest member, not its centre", () => {
    const rooms = roomLayout(
      [
        { x: 0, y: 0, r: 2, rooms: ["ramp"] },
        { x: 10, y: 0, r: 3, rooms: ["ramp"] },
      ],
      ROOMS,
      noTallies,
    );
    // centroid x=5; furthest member centre is 5 away, its far rim another 3.
    expect(rooms.get("ramp")!.r).toBe(8);
  });

  it("encloses a card that is in two rooms in BOTH rooms", () => {
    const shared = { x: 50, y: 0, r: 4, rooms: ["lands", "ramp"] as const };
    const rooms = roomLayout(
      [{ x: 0, y: 0, r: 4, rooms: ["lands"] }, shared, { x: 100, y: 0, r: 4, rooms: ["ramp"] }],
      ROOMS,
      noTallies,
    );
    const inside = (c: { x: number; y: number; r: number }) =>
      Math.hypot(shared.x - c.x, shared.y - c.y) + shared.r <= c.r + 1e-9;
    expect(inside(rooms.get("lands")!)).toBe(true);
    expect(inside(rooms.get("ramp")!)).toBe(true);
  });

  it("returns a circle for every room, including empty ones", () => {
    const rooms = roomLayout([{ x: 0, y: 0, r: 4, rooms: ["ramp"] }], ROOMS, noTallies);
    expect([...rooms.keys()].sort()).toEqual(ROOMS.map((r) => r.id).sort());
  });

  it("sizes an empty room from its target, since it has no members to measure", () => {
    const member = [{ x: 0, y: 0, r: 4, rooms: ["ramp"] as const }];
    const withTarget = roomLayout(member, ROOMS, new Map([["boardWipes", tallyOf(3)]]));
    const without = roomLayout(member, ROOMS, noTallies);
    // A bigger hole draws bigger. Compared against the no-target case, not against zero -- an
    // assertion of "> 0" passes on the base radius alone and would not notice target being ignored.
    expect(withTarget.get("boardWipes")!.r).toBeGreaterThan(without.get("boardWipes")!.r);
  });

  it("gives an empty room with no target a visible circle rather than a point", () => {
    const rooms = roomLayout([{ x: 0, y: 0, r: 4, rooms: ["ramp"] }], ROOMS, noTallies);
    expect(rooms.get("boardWipes")!.r).toBeGreaterThan(0);
  });

  it("does not put an empty room on top of an occupied one", () => {
    const rooms = roomLayout([{ x: 0, y: 0, r: 40, rooms: ["ramp"] }], ROOMS, noTallies);
    const ramp = rooms.get("ramp")!, wipes = rooms.get("boardWipes")!;
    expect(Math.hypot(ramp.x - wipes.x, ramp.y - wipes.y)).toBeGreaterThan(ramp.r);
  });

  it("is a pure function of its arguments -- same input, same output", () => {
    const members = [{ x: 3, y: 7, r: 4, rooms: ["ramp"] as const }];
    expect(roomLayout(members, ROOMS, noTallies)).toEqual(roomLayout(members, ROOMS, noTallies));
  });

  it("handles no members at all without throwing", () => {
    expect(() => roomLayout([], ROOMS, noTallies)).not.toThrow();
    expect(roomLayout([], ROOMS, noTallies).size).toBe(ROOMS.length);
  });
});

describe("rimArcs", () => {
  const TAU = Math.PI * 2;

  it("gives a card with one hue a single full-circle arc", () => {
    const arcs = rimArcs([ROOM_HUE.ramp]);
    expect(arcs).toHaveLength(1);
    expect(arcs[0].to - arcs[0].from).toBeCloseTo(TAU);
    expect(arcs[0].hue).toBe(ROOM_HUE.ramp);
  });

  it("splits a two-hue card in half", () => {
    const arcs = rimArcs([ROOM_HUE.lands, ROOM_HUE.ramp]);
    expect(arcs).toHaveLength(2);
    expect(arcs[0].to - arcs[0].from).toBeCloseTo(Math.PI);
    expect(arcs[1].to - arcs[1].from).toBeCloseTo(Math.PI);
  });

  it("covers the full circle with no gap and no overlap", () => {
    const arcs = rimArcs([ROOM_HUE.lands, ROOM_HUE.ramp, ROOM_HUE.interaction]);
    expect(arcs[0].from).toBeCloseTo(-Math.PI / 2);
    for (let i = 1; i < arcs.length; i++) expect(arcs[i].from).toBeCloseTo(arcs[i - 1].to);
    expect(arcs[arcs.length - 1].to).toBeCloseTo(-Math.PI / 2 + TAU);
  });

  it("handles the six-hue maximum -- sixty degrees each", () => {
    const arcs = rimArcs([
      ROOM_HUE.wincons, ROOM_HUE.cardAdvantage, ROOM_HUE.ramp,
      ROOM_HUE.lands, ROOM_HUE.interaction, ROOM_HUE.boardWipes,
    ]);
    expect(arcs).toHaveLength(6);
    for (const a of arcs) expect(a.to - a.from).toBeCloseTo(TAU / 6);
  });

  it("returns nothing for a card in no room, rather than dividing by zero", () => {
    expect(rimArcs([])).toEqual([]);
  });

  it("uses each hue given, in order", () => {
    expect(rimArcs([ROOM_HUE.lands, ROOM_HUE.ramp]).map((a) => a.hue)).toEqual([ROOM_HUE.lands, ROOM_HUE.ramp]);
  });
});

describe("rimArcs takes hues and caps at six", () => {
  it("splits the circle evenly among the hues given", () => {
    const arcs = rimArcs(["#111111", "#222222"]);
    expect(arcs.map((a) => a.hue)).toEqual(["#111111", "#222222"]);
    expect(arcs[1].to - arcs[0].from).toBeCloseTo(Math.PI * 2);
  });

  it("caps at six arcs and paints the sixth in the overflow hue", () => {
    const arcs = rimArcs(["#1", "#2", "#3", "#4", "#5", "#6", "#7", "#8"]);
    expect(arcs).toHaveLength(6);
    expect(arcs[5].hue).toBe(OVERFLOW_HUE);
    expect(arcs.slice(0, 5).map((a) => a.hue)).toEqual(["#1", "#2", "#3", "#4", "#5"]);
  });

  it("still covers the full circle when capped", () => {
    const arcs = rimArcs(["#1", "#2", "#3", "#4", "#5", "#6", "#7"]);
    expect(arcs[5].to - arcs[0].from).toBeCloseTo(Math.PI * 2);
  });
});

describe("roomLayout takes its room list", () => {
  it("parks a room with no members even when it is not one of the seven", () => {
    const members: RoomMember[] = [{ x: 0, y: 0, r: 14, rooms: ["alpha"] }];
    const rooms = [{ id: "alpha" }, { id: "beta" }];
    const out = roomLayout(members, rooms, new Map());
    expect(out.get("alpha")).toEqual({ x: 0, y: 0, r: 14 });
    expect(out.has("beta")).toBe(true);
    expect(out.get("beta")!.r).toBeGreaterThan(0);
  });

  it("ignores rooms absent from the list even if a member claims them", () => {
    const members: RoomMember[] = [{ x: 0, y: 0, r: 14, rooms: ["ghost"] }];
    expect(roomLayout(members, [{ id: "alpha" }], new Map()).has("ghost")).toBe(false);
  });
});
