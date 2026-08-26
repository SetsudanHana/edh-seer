import { describe, expect, it } from "vitest";
import { castTurnStats, castTurns, silenceRamp } from "./commander-ramp-core.js";
import type { SimulateResult } from "../goldfish.js";
import type { DeckCard } from "../types.js";

/** `manaAt[turn - 1][trial]` — three trials, four turns. */
const result = (manaAt: number[][]): SimulateResult =>
  ({ trials: manaAt[0].length, turns: manaAt.length, manaAt, payableShareAt: [], byCard: new Map(), byCardCastable: new Map() });

const card = (over: Partial<DeckCard["card"]>): DeckCard =>
  ({ card: { name: "x", typeLine: "Artifact", manaValue: 2, oracleText: "", producedMana: [], ...over } as DeckCard["card"], tags: null });

describe("castTurns", () => {
  it("returns the FIRST turn each trial reaches the mana value", () => {
    // turn 1: [1,2,3] · turn 2: [2,4,6] · turn 3: [3,6,9]
    expect(castTurns(result([[1, 2, 3], [2, 4, 6], [3, 6, 9]]), 3)).toEqual([3, 2, 1]);
  });

  it("returns null for a trial that never gets there — censoring is not silently dropped", () => {
    expect(castTurns(result([[1, 5], [2, 6]]), 5)).toEqual([null, 1]);
  });
});

describe("castTurnStats", () => {
  it("reports a censored quantile as >horizon rather than inventing a turn", () => {
    // Half the trials never arrive, so the median falls in the censored tail.
    const s = castTurnStats([1, 2, null, null], 4);
    expect(s.median).toBe(">4");
    expect(s.censored).toBe(0.5);
  });

  it("sorts censored trials LAST, so an uncensored median survives a censored tail", () => {
    const s = castTurnStats([2, 2, 2, null], 4);
    expect(s.median).toBe("2");
    expect(s.censored).toBe(0.25);
  });
});

describe("silenceRamp", () => {
  const ramp = new Set(["Sol Ring", "Cultivate", "Bad Ramp", "Ramp Land"]);

  it("silences a classifiable nonland ramp card and leaves the slot in place", () => {
    // ORACLE TEXT VERBATIM FROM THE CORPUS. The fixture used to carry an empty string, and after N9
    // a card whose own text never says "add" is not a mana source however its `producedMana` reads --
    // which is the whole point of that rule, and a fixture that does not resemble a real card cannot
    // exercise it.
    const lib = [card({ name: "Sol Ring", producedMana: ["C"], oracleText: "{T}: Add {C}{C}." }), card({ name: "Other" })];
    const out = silenceRamp(lib, ramp);
    expect(out.silenced).toBe(1);
    expect(out.deck).toHaveLength(2);
    expect(out.deck[0].card.producedMana).toEqual([]);
    expect(out.deck[1]).toBe(lib[1]);
  });

  it("counts — and does NOT silence — a ramp card the model cannot classify", () => {
    const out = silenceRamp([card({ name: "Bad Ramp" })], ramp);
    expect(out).toMatchObject({ silenced: 0, blind: 1 });
  });

  it("never silences a LAND, because that would change the land count too", () => {
    const lib = [card({ name: "Ramp Land", typeLine: "Land", producedMana: ["G"] })];
    const out = silenceRamp(lib, ramp);
    expect(out).toMatchObject({ silenced: 0, blind: 0 });
    expect(out.deck[0]).toBe(lib[0]);
  });

  it("leaves a nonramp mana source alone — the counterfactual is about the ramp package", () => {
    const out = silenceRamp([card({ name: "Not Ramp", producedMana: ["U"] })], ramp);
    expect(out).toMatchObject({ silenced: 0, blind: 0 });
  });
});
