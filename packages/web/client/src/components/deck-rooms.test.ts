import { describe, expect, it } from "vitest";
import { ROOMS, ROOM_HUE, roomsForCard, subcategoryLabel } from "./deck-rooms.js";

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
    expect(subcategoryLabel("protection")).toBe("protection");
  });
});
