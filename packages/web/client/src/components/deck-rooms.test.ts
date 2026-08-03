import { describe, expect, it } from "vitest";
import {
  ROOMS, ROOM_HUE, roomsForCard, roomTallies, subcategoryLabel,
  roomLayout, roomCenter, type RoomId,
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
    expect(roomsForCard(["draw"], "Rhystic Study", none, none)).toEqual(["cardAdvantage"]);
    expect(roomsForCard(["targetedRemoval"], "Swords", none, none)).toEqual(["interaction"]);
    expect(roomsForCard(["stax"], "Winter Orb", none, none)).toEqual(["interaction"]);
    expect(roomsForCard(["burn"], "Bolt", none, none)).toEqual(["wincons"]);
    expect(roomsForCard(["tutor"], "Demonic Tutor", none, none)).toEqual(["wincons"]);
  });

  it("returns every room a multi-role card belongs to, in ROOMS order", () => {
    expect(roomsForCard(["targetedRemoval", "draw"], "Fire Covenant", none, none))
      .toEqual(["cardAdvantage", "interaction"]);
  });

  it("puts a combo piece in wincons even with no roles", () => {
    expect(roomsForCard([], "Thassa's Oracle", new Set(["Thassa's Oracle"]), none))
      .toEqual(["wincons"]);
  });

  it("puts an archetype-group member in strategy", () => {
    expect(roomsForCard([], "Inalla", none, new Set(["Inalla"]))).toEqual(["strategy"]);
  });

  it("falls back to strategy for a card nothing else claims", () => {
    expect(roomsForCard([], "Some Wizard", none, none)).toEqual(["strategy"]);
    expect(roomsForCard(undefined, "Some Wizard", none, none)).toEqual(["strategy"]);
  });

  it("does not add the strategy fallback when another room already claimed the card", () => {
    expect(roomsForCard(["ramp"], "Sol Ring", none, none)).toEqual(["ramp"]);
  });

  it("still adds strategy when the card is BOTH categorised and an archetype member", () => {
    expect(roomsForCard(["ramp"], "Sol Ring", none, new Set(["Sol Ring"])))
      .toEqual(["strategy", "ramp"]);
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
    const t = roomTallies(cardRooms, build);
    expect(t.get("cardAdvantage")!.count).toBe(2);
  });

  it("sums the archetype-adjusted targets of a room's subcategories", () => {
    const t = roomTallies(new Map(), build);
    expect(t.get("cardAdvantage")!.target).toBe(9); // draw 7 + cardSelection 2, the SUM
    expect(t.get("cardAdvantage")!.target).not.toBe(7); // not just one operand
    expect(t.get("cardAdvantage")!.target).not.toBe(2); // not just the other
    expect(t.get("boardWipes")!.target).toBe(1);
  });

  it("reports target 0 for a room whose subcategories all have target 0", () => {
    const t = roomTallies(new Map(), build);
    expect(t.get("wincons")!.target).toBe(0); // burn 0 + tutor 0
    expect(t.get("wincons")!.under).toBe(false);
  });

  it("flags a room under its target", () => {
    const t = roomTallies(new Map(), build);
    expect(t.get("boardWipes")).toEqual({ count: 0, target: 1, under: true });
  });

  it("does not flag a room at or over its target", () => {
    const cardRooms = new Map(
      Array.from({ length: 9 }, (_, i) => [`c${i}`, ["cardAdvantage"] as const]),
    );
    expect(roomTallies(cardRooms, build).get("cardAdvantage")!.under).toBe(false);
  });

  it("returns an entry for every room even with no data at all", () => {
    const t = roomTallies(new Map(), undefined);
    expect(t.size).toBe(7);
    expect(t.get("strategy")).toEqual({ count: 0, target: 0, under: false });
  });

  it("counts copies, not distinct names", () => {
    const cardRooms = new Map([["Mountain", ["lands"] as const], ["Island", ["lands"] as const]]);
    const copies = new Map([["Mountain", 24]]);
    const t = roomTallies(cardRooms, [{ category: "lands", count: 25, target: 36 }], copies);
    expect(t.get("lands")!.count).toBe(25); // 24 Mountains + 1 Island
  });

  it("treats a card with no copies entry as a single copy", () => {
    expect(roomTallies(new Map([["Sol Ring", ["ramp"] as const]]), undefined, new Map()).get("ramp")!.count).toBe(1);
  });

  it("ignores a buildCategories entry no room claims, without throwing or perturbing tallies", () => {
    const withOrphan = [...build, { category: "notARoomCategory", count: 99, target: 99 }];
    expect(() => roomTallies(new Map(), withOrphan)).not.toThrow();
    const t = roomTallies(new Map(), withOrphan);
    expect(t.get("cardAdvantage")!.target).toBe(9);
    expect(t.get("boardWipes")!.target).toBe(1);
    expect(t.get("wincons")!.target).toBe(0);
  });
});

describe("roomLayout", () => {
  it("places all seven rooms", () => {
    const l = roomLayout(900, 600);
    expect(l.size).toBe(7);
    for (const r of ROOMS) expect(l.get(r.id)).toBeDefined();
  });

  it("centres the board on the origin", () => {
    const l = roomLayout(900, 600);
    const xs = [...l.values()].flatMap((r) => [r.x, r.x + r.w]);
    const ys = [...l.values()].flatMap((r) => [r.y, r.y + r.h]);
    expect(Math.min(...xs) + Math.max(...xs)).toBeCloseTo(0, 6);
    expect(Math.min(...ys) + Math.max(...ys)).toBeCloseTo(0, 6);
  });

  it("spans strategy and lands across two columns", () => {
    const l = roomLayout(900, 600);
    expect(l.get("strategy")!.w).toBeCloseTo(l.get("wincons")!.w * 2, 6);
    expect(l.get("lands")!.w).toBeCloseTo(l.get("ramp")!.w * 2, 6);
  });

  it("gives every row the same height and fills the width", () => {
    const l = roomLayout(900, 600);
    const heights = [...l.values()].map((r) => r.h);
    expect(new Set(heights.map((h) => h.toFixed(6))).size).toBe(1);
    const row1 = ["cardAdvantage", "interaction", "boardWipes"].map((id) => l.get(id as RoomId)!);
    const total = row1.reduce((sum, r) => sum + r.w, 0);
    expect(total).toBeCloseTo(l.get("strategy")!.w + l.get("wincons")!.w, 6);
  });

  it("never overlaps two rooms", () => {
    const rects = [...roomLayout(900, 600).values()];
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i], b = rects[j];
        const overlap = a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
        expect(overlap).toBe(false);
      }
  });

  it("scales with the viewport it is given", () => {
    const small = roomLayout(400, 300).get("ramp")!;
    const big = roomLayout(800, 600).get("ramp")!;
    expect(big.w).toBeGreaterThan(small.w);
    expect(big.h).toBeGreaterThan(small.h);
  });

  // A canvas legitimately reports 0x0 mid-layout (before the first resize measurement lands),
  // and GraphView now calls roomLayout with that live size every tick. Negative width/height
  // (e.g. a caller subtracting a border) must not invert every rect's direction; clamp to 0
  // instead so the board degenerates to nothing-visible rather than a mirrored layout.
  it("clamps negative width/height to zero instead of inverting the grid", () => {
    expect(roomLayout(-900, -600)).toEqual(roomLayout(0, 0));
  });

  it("does not throw or produce negative-size rects on a zero-size canvas", () => {
    const l = roomLayout(0, 0);
    expect(l.size).toBe(7);
    for (const r of l.values()) {
      expect(r.w).toBeGreaterThanOrEqual(0);
      expect(r.h).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("roomCenter", () => {
  it("returns the rect's midpoint", () => {
    expect(roomCenter({ x: -10, y: -20, w: 20, h: 40 })).toEqual({ x: 0, y: 0 });
  });
});
