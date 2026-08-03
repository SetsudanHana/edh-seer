import { describe, expect, it } from "vitest";
import { ROOMS, ROOM_HUE, roomsForCard, roomTallies, subcategoryLabel } from "./deck-rooms.js";

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
});

describe("roomTallies", () => {
  const build = [
    { category: "draw", count: 7, target: 10 },
    { category: "cardSelection", count: 3, target: 4 },
    { category: "boardWipe", count: 0, target: 3 },
    { category: "burn", count: 5, target: 0 },
    { category: "tutor", count: 2, target: 0 },
  ];

  it("counts distinct cards per room, not summed category counts", () => {
    // one card in BOTH draw and cardSelection must count once
    const cardRooms = new Map([
      ["Ponder", ["cardAdvantage"] as const],
      ["Rhystic Study", ["cardAdvantage"] as const],
    ]);
    const t = roomTallies(cardRooms, build);
    expect(t.get("cardAdvantage")!.count).toBe(2);
  });

  it("sums the archetype-adjusted targets of a room's subcategories", () => {
    const t = roomTallies(new Map(), build);
    expect(t.get("cardAdvantage")!.target).toBe(14); // draw 10 + cardSelection 4
    expect(t.get("boardWipes")!.target).toBe(3);
  });

  it("reports target 0 for a room whose subcategories all have target 0", () => {
    const t = roomTallies(new Map(), build);
    expect(t.get("wincons")!.target).toBe(0); // burn 0 + tutor 0
    expect(t.get("wincons")!.under).toBe(false);
  });

  it("flags a room under its target", () => {
    const t = roomTallies(new Map(), build);
    expect(t.get("boardWipes")).toEqual({ count: 0, target: 3, under: true });
  });

  it("does not flag a room at or over its target", () => {
    const cardRooms = new Map(
      Array.from({ length: 14 }, (_, i) => [`c${i}`, ["cardAdvantage"] as const]),
    );
    expect(roomTallies(cardRooms, build).get("cardAdvantage")!.under).toBe(false);
  });

  it("returns an entry for every room even with no data at all", () => {
    const t = roomTallies(new Map(), undefined);
    expect(t.size).toBe(7);
    expect(t.get("strategy")).toEqual({ count: 0, target: 0, under: false });
  });
});
