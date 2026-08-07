import { describe, expect, it } from "vitest";
import { cardFacts } from "./presets.js";
import type { CardGraph } from "../types.js";

/** Malakir Rebirth // Malakir Mire: an Instant whose back face is a Land. The front/back split is
 *  the whole point of the fixture -- grouping must never see the Land. */
const graph: CardGraph = {
  nodes: [
    { id: "card:1", kind: "card", label: "Malakir Rebirth // Malakir Mire", roles: ["protection"], copies: 1 },
    { id: "face:1:0", kind: "face", label: "Malakir Rebirth" },
    { id: "face:1:1", kind: "face", label: "Malakir Mire" },
    { id: "type:Instant", kind: "type", label: "Instant" },
    { id: "type:Land", kind: "type", label: "Land" },
    { id: "color:B", kind: "color", label: "B" },
    { id: "cmc:2", kind: "cmc", label: "2" },
    { id: "card:2", kind: "card", label: "Deathrite Shaman", copies: 1 },
    { id: "face:2:0", kind: "face", label: "Deathrite Shaman" },
    { id: "type:Creature", kind: "type", label: "Creature" },
    { id: "subtype:Elf", kind: "subtype", label: "Elf" },
    { id: "subtype:Shaman", kind: "subtype", label: "Shaman" },
    { id: "color:G", kind: "color", label: "G" },
    { id: "cmc:1", kind: "cmc", label: "1" },
  ],
  edges: [
    { from: "card:1", to: "face:1:0", kind: "FACE", index: 0 },
    { from: "card:1", to: "face:1:1", kind: "FACE", index: 1 },
    { from: "face:1:0", to: "type:Instant", kind: "TYPE" },
    { from: "face:1:1", to: "type:Land", kind: "TYPE" },
    { from: "card:1", to: "color:B", kind: "IDENTITY" },
    { from: "card:1", to: "cmc:2", kind: "CMC" },
    { from: "card:2", to: "face:2:0", kind: "FACE", index: 0 },
    { from: "face:2:0", to: "type:Creature", kind: "TYPE" },
    { from: "face:2:0", to: "subtype:Elf", kind: "SUBTYPE" },
    { from: "face:2:0", to: "subtype:Shaman", kind: "SUBTYPE" },
    { from: "card:2", to: "color:B", kind: "IDENTITY" },
    { from: "card:2", to: "color:G", kind: "IDENTITY" },
    { from: "card:2", to: "cmc:1", kind: "CMC" },
  ],
};

describe("cardFacts", () => {
  it("returns one entry per card node and nothing else", () => {
    expect(cardFacts(graph).map((f) => f.id)).toEqual(["card:1", "card:2"]);
  });

  it("reads types from the FRONT face only", () => {
    const [rebirth] = cardFacts(graph);
    expect(rebirth.types).toEqual(["Instant"]);
  });

  it("reads every subtype of the front face", () => {
    const shaman = cardFacts(graph)[1];
    expect([...shaman.subtypes].sort()).toEqual(["Elf", "Shaman"]);
  });

  it("reads colour identity from the card, not the face", () => {
    const shaman = cardFacts(graph)[1];
    expect([...shaman.colors].sort()).toEqual(["B", "G"]);
  });

  it("reads mana value as a number", () => {
    expect(cardFacts(graph).map((f) => f.manaValue)).toEqual([2, 1]);
  });

  it("defaults roles and copies when the wire omitted them", () => {
    const shaman = cardFacts(graph)[1];
    expect(shaman.roles).toEqual([]);
    expect(shaman.copies).toBe(1);
  });
});

import { PRESETS, roomsForFacts, type CardFacts, type Room } from "./presets.js";

const facts = (over: Partial<CardFacts>): CardFacts => ({
  id: "card:x", name: "X", roles: [], types: [], subtypes: [], colors: [], manaValue: 0, copies: 1,
  ...over,
});
const preset = (id: string) => PRESETS.find((p) => p.id === id)!;

describe("PRESETS", () => {
  it("ships five presets with role first", () => {
    expect(PRESETS.map((p) => p.id)).toEqual(["role", "type", "colour", "manaValue", "subtype"]);
  });
});

describe("the colour preset", () => {
  const deck = [
    facts({ id: "a", colors: ["B", "G"] }),
    facts({ id: "b", colors: ["B"] }),
    facts({ id: "c", colors: [] }),
  ];

  it("puts a Golgari card in BOTH colour rooms", () => {
    const rooms = preset("colour").rooms(deck);
    expect(roomsForFacts(rooms, deck[0]).sort()).toEqual(["B", "G"]);
  });

  it("orders rooms by member count, descending", () => {
    expect(preset("colour").rooms(deck).map((r) => r.id)).toEqual(["B", "G"]);
  });

  it("makes no room for a colour the deck does not run", () => {
    expect(preset("colour").rooms(deck).map((r) => r.id)).not.toContain("W");
  });

  it("leaves a colourless card in no room at all", () => {
    expect(roomsForFacts(preset("colour").rooms(deck), deck[2])).toEqual([]);
  });
});

describe("the type preset", () => {
  it("puts an Artifact Creature in two rooms", () => {
    const deck = [facts({ id: "a", types: ["Artifact", "Creature"] })];
    expect(roomsForFacts(preset("type").rooms(deck), deck[0]).sort()).toEqual(["Artifact", "Creature"]);
  });
});

describe("the mana value preset", () => {
  it("buckets everything from seven upward into 7+", () => {
    const deck = [facts({ id: "a", manaValue: 9 }), facts({ id: "b", manaValue: 7 })];
    const rooms = preset("manaValue").rooms(deck);
    expect(rooms.map((r) => r.id)).toEqual(["7+"]);
    expect(roomsForFacts(rooms, deck[0])).toEqual(["7+"]);
  });

  it("gives each card exactly one room", () => {
    const deck = [facts({ id: "a", manaValue: 3 })];
    expect(roomsForFacts(preset("manaValue").rooms(deck), deck[0])).toHaveLength(1);
  });
});

describe("the role preset", () => {
  it("keeps the seven rooms and their order", () => {
    expect(preset("role").rooms([]).map((r) => r.id)).toEqual([
      "strategy", "wincons", "cardAdvantage", "ramp", "lands", "interaction", "boardWipes",
    ]);
  });

  it("sends a card no other room claims to the fallback", () => {
    const rooms = preset("role").rooms([]);
    expect(roomsForFacts(rooms, facts({ roles: [] }))).toEqual(["strategy"]);
  });

  it("does not use the fallback when another room claims the card", () => {
    const rooms = preset("role").rooms([]);
    expect(roomsForFacts(rooms, facts({ roles: ["ramp"] }))).toEqual(["ramp"]);
  });
});
