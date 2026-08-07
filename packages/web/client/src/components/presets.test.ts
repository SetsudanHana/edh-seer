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
