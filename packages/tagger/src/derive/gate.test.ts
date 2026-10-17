import { describe, expect, it } from "vitest";
import { parseGate } from "./gate.js";

describe("parseGate (#1191): the one parse of ManaLine.gate", () => {
  it("a board count: one, N or more, and an either-or of nouns", () => {
    expect(parseGate("you control a dragon")).toEqual({ kind: "control", need: 1, nouns: ["dragon"], text: "you control a dragon" });
    expect(parseGate("you control three or more artifacts")).toMatchObject({ kind: "control", need: 3, nouns: ["artifact"] });
    expect(parseGate("you control a plains or an island")).toMatchObject({ kind: "control", need: 1, nouns: ["plains", "island"] });
    expect(parseGate("you control five or more lands")).toMatchObject({ kind: "control", need: 5, nouns: ["land"] });
  });
  it("the Gleaming Bastion cycle's real text is a basic-land count (the entry-turn alternative is not read)", () => {
    expect(parseGate("this land entered this turn or if you control a basic land")).toMatchObject({ kind: "control", need: 1, nouns: ["land"], basic: true });
    expect(parseGate("this land entered this turn")).toEqual({ kind: "turn-event", event: "entered-this-turn", text: "this land entered this turn" });
  });
  it("a creature with power N or greater", () => {
    expect(parseGate("you control a creature with power 4 or greater")).toMatchObject({ kind: "control", need: 1, nouns: ["creature"], minPower: 4 });
  });
  it("same-name, tron, speed, initiative", () => {
    expect(parseGate("you control three or more lands with the same name")).toMatchObject({ kind: "same-name", need: 3 });
    expect(parseGate("you control an urza's mine and an urza's power-plant")).toMatchObject({ kind: "tron", names: ["urza's mine", "urza's power-plant"] });
    expect(parseGate("speed 4")).toMatchObject({ kind: "speed", n: 4 });
    expect(parseGate("you have the initiative")).toMatchObject({ kind: "initiative" });
  });
  it("everything no decklist settles stays unknown, text kept", () => {
    for (const t of ["a land named wastes is on the battlefield", "you control a land named wastes", "threshold", "you control four or fewer lands", "you control creatures named mine worker and power plant worker"])
      expect(parseGate(t)).toEqual({ kind: "unknown", text: t });
  });

  // #1267 (owner 2026-10-17): three kinds a decklist can estimate. The gate texts below are the ones derive stores for the 18 corpus cards, read by WORDING.
  it("a graveyard count: N cards, or of a type, or of a subtype (Cabal Ritual, Far Wanderings, Corrupted Grafstone, Dark Petition, Lys Alana Dignitary)", () => {
    expect(parseGate("there are seven or more cards in your graveyard")).toEqual({ kind: "threshold", zone: "graveyard", need: 7, text: "there are seven or more cards in your graveyard" });
    expect(parseGate("there is a card in your graveyard")).toMatchObject({ kind: "threshold", need: 1 });
    expect(parseGate("there are two or more instant and/or sorcery cards in your graveyard")).toMatchObject({ kind: "threshold", need: 2, types: ["instant", "sorcery"] });
    expect(parseGate("there is an elf card in your graveyard")).toMatchObject({ kind: "threshold", need: 1, subtypes: ["elf"] });
    expect(parseGate("there are three or more creature cards in your graveyard")).toMatchObject({ kind: "threshold", need: 3, types: ["creature"] });
  });
  it("counters on the card itself: the kind, how many, and a bare 'it' / 'this <type>' / the card's own name as the holder (Incubation Druid, Gemstone Caverns, Pyramid, Tablet, Charitable Levy)", () => {
    expect(parseGate("this creature has a +1/+1 counter on it")).toEqual({ kind: "counter", counter: "+1/+1", need: 1, text: "this creature has a +1/+1 counter on it" });
    expect(parseGate("gemstone caverns has a luck counter on it")).toMatchObject({ kind: "counter", counter: "luck", need: 1 });
    expect(parseGate("there are three or more brick counters on this artifact")).toMatchObject({ kind: "counter", counter: "brick", need: 3 });
    expect(parseGate("this artifact has two or more oil counters on it")).toMatchObject({ kind: "counter", counter: "oil", need: 2 });
    expect(parseGate("there are three or more collection counters on it")).toMatchObject({ kind: "counter", counter: "collection", need: 3 });
  });
  it("this turn: the six events", () => {
    const cases: [string, string][] = [["an opponent lost life this turn", "opponent-lost-life"], ["this land entered this turn", "entered-this-turn"], ["a creature died this turn", "creature-died"],
      ["a permanent left the battlefield under your control this turn", "permanent-left"], ["you attacked this turn", "attacked"], ["you played a land this turn", "land-played"]];
    for (const [t, event] of cases) expect(parseGate(t), t).toEqual({ kind: "turn-event", event, text: t });
  });
  it("near misses stay unknown: a count of times, a target, a win, a counter on someone else, a graveyard that is not yours, a bare 'threshold'", () => {
    for (const t of ["it's the third time", "this is the third time this ability has resolved this turn", "a legal target exists: target land card from a graveyard", "you win", "an opponent has three or more poison counters",
      "there are seven or more cards in an opponent's graveyard", "a card is exiled with this land", "an opponent lost life", "you attacked with a creature this turn", "enchanted permanent has a +1/+1 counter on it", "a creature died", "threshold"])
      expect(parseGate(t), t).toEqual({ kind: "unknown", text: t });
  });
});
