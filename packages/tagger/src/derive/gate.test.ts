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
    expect(parseGate("this land entered this turn")).toMatchObject({ kind: "unknown" });
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
    for (const t of ["a land named wastes is on the battlefield", "you control a land named wastes", "there are seven or more cards in your graveyard", "threshold", "you control four or fewer lands", "you control creatures named mine worker and power plant worker"])
      expect(parseGate(t)).toEqual({ kind: "unknown", text: t });
  });
});
