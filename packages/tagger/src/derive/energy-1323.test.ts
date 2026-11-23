/** Energy (CR 107.14: {E} is one energy counter; to pay {E} a player removes one) in every wording the corpus prints (#1323).
 *  EVERY CARD HERE IS REAL INPUT: `energy.fixtures.json` holds the card document and the clause records derive used,
 *  dumped from Mongo by `research/energy/dump-energy-fixtures.mts`. */
import { describe, expect, it } from "vitest";
import { deriveInputOf } from "../derive-input.js";
import { deriveCardTags } from "./derive.js";
import { isEnergyObject } from "./effect-kind.js";
import { energyReading, energyRewrite } from "./verb-words.js";
import type { CardTags } from "../schema.js";
import fixtures from "./energy.fixtures.json" with { type: "json" };

const tagsOf = (name: string): CardTags => {
  const fx = (fixtures as unknown as Record<string, { card: Record<string, unknown> & { _id: string; name: string }; clauses: never[] }>)[name]!;
  expect(fx, `fixture for ${name}`).toBeDefined();
  return deriveCardTags(deriveInputOf(fx.card as never, fx.card._id, fx.card.name, fx.clauses));
};
/** The energy emits of a card, by verb: how many abilities carry one. */
const energy = (name: string, verb: "counter-added" | "counter-removed"): number =>
  tagsOf(name).abilities.reduce((n, a) => n + (a.emits ?? []).filter((e) => e.verb === verb && (e.subject as { counter?: string } | undefined)?.counter === "energy").length, 0);
const emitsOf = (name: string, verb: string): number => tagsOf(name).abilities.reduce((n, a) => n + (a.emits ?? []).filter((e) => e.verb === verb).length, 0);
const manaAbilities = (name: string): number => tagsOf(name).abilities.filter((a) => a.effect.kind === "mana-generation").length;

describe("isEnergyObject: every printed energy form, and no mana", () => {
  it("reads the bare symbol, repeated, with a count or an amount, and the word", () => {
    for (const o of ["E", "{E}", "{E}{E}{E}", "E E E", "one energy", "energy", "energy counters", "1 energy counter", "X {E}", "eight {E}", "six {E}", "that many {E}",
      "an amount of {E}", "energy equal to the number of creatures you control", "{E} for each creature attacking you"]) expect(isEnergyObject(o), o).toBe(true);
  });
  it("refuses mana and everything else", () => {
    for (const o of ["", "{G}", "{C}{C}", "one mana of any color", "X mana", "two mana", "an emblem", "you", "energy shield", "a creature with energy in its name", "{E}{G}", "one mana of any color or {E}"]) expect(isEnergyObject(o), o).toBe(false);
  });
  it("is linear on a long run of spaces or braces (CodeQL js/polynomial-redos)", () => {
    const t0 = performance.now();
    for (const t of [" ".repeat(40_000), `${" ".repeat(40_000)}x`, "{".repeat(20_000), "{E}".repeat(10_000), "energy ".repeat(8_000), `eight ${" ".repeat(40_000)}z`]) isEnergyObject(t);
    expect(performance.now() - t0).toBeLessThan(500);
  });
});

describe("an energy gain the model filed as mana or life, in a wording the symbol test missed (#1323)", () => {
  it("Roil Cartographer ('one energy'), Peema Trailblazer ('energy'), Scurry of Gremlins ('energy equal to the number of creatures you control') gain energy", () => {
    for (const n of ["Roil Cartographer", "Peema Trailblazer", "Scurry of Gremlins"]) {
      expect(energy(n, "counter-added"), n).toBe(1);
      expect(manaAbilities(n), `${n} is no mana source`).toBe(0);
    }
  });
  it("the seven 'you get {E}' cards #1321 dropped from gain-life gain energy and gain no life", () => {
    for (const n of ["Aether Hub", "Conversion Apparatus", "HELIOS One", "Brotherhood Scribe", "Wrath of the Skies", "Solar Transformer", "Deadlock Trap"]) {
      expect(energy(n, "counter-added"), n).toBe(1);
      expect(emitsOf(n, "gain-life"), `${n} gains no life`).toBe(0);
    }
  });
  it("Aetherworks Marvel's 'you get {E}' (filed add-mana 'energy') is an energy gain, not a mana ability", () => {
    expect(energy("Aetherworks Marvel", "counter-added")).toBe(1);
    expect(manaAbilities("Aetherworks Marvel")).toBe(0);
  });
});

describe("an energy payment the model filed as mana (#1323)", () => {
  it("Blaster Hulk gets {E}{E} and pays eight {E}: one counter-added, one counter-removed", () => {
    expect(energy("Blaster Hulk", "counter-added")).toBe(1);
    expect(energy("Blaster Hulk", "counter-removed")).toBe(1);
    expect(manaAbilities("Blaster Hulk")).toBe(0);
  });
});

describe("what does not move", () => {
  it("Harnessed Lightning ('you get {E}{E}{E}, then you may pay any amount of {E}') keeps its one energy gain", () => {
    expect(energy("Harnessed Lightning", "counter-added")).toBe(1);
  });
  it("Decoction Module and Territorial Gorger keep their energy reading", () => {
    expect(energy("Decoction Module", "counter-added")).toBe(1);
    expect(energy("Territorial Gorger", "counter-added")).toBe(0);
  });
  it("Guide of Souls still gains its real life", () => {
    expect(emitsOf("Guide of Souls", "gain-life")).toBe(1);
  });
});

describe("energyReading: gain, pay, or not energy", () => {
  it("a get is a gain and a pay is a pay, read off the words in front of the object", () => {
    const hulk = "Whenever this creature attacks, you get {E}{E}, then you may pay eight {E}. When you do, this creature deals 8 damage divided as you choose among up to eight targets.";
    expect(energyReading({ verb: "add-mana", object: "{E}{E}" }, hulk)).toBe("gain");
    expect(energyReading({ verb: "add-mana", object: "eight {E}" }, hulk)).toBe("pay");
    expect(energyReading({ verb: "add-mana", object: "one energy" }, "Whenever a land you control enters, you get {E}.")).toBe("gain");
  });
  it("a gain-life whose clause says no gain and no life but 'you get {E}' is a gain; 'you get an emblem' and a real life gain are not energy", () => {
    expect(energyReading({ verb: "gain-life", object: "you" }, "{3}, {T}: You get {E}{E}{E}.")).toBe("gain");
    expect(energyReading({ verb: "gain-life", object: "you" }, "You get an emblem with \"Creatures you control get +1/+1.\"")).toBeUndefined();
    expect(energyReading({ verb: "gain-life", object: "you" }, "You gain 3 life and get {E}.")).toBeUndefined();
    expect(energyReading({ verb: "gain-life", object: "3 life" }, "You gain 3 life.")).toBeUndefined();
  });
  it("mana and other verbs are not energy", () => {
    expect(energyReading({ verb: "add-mana", object: "one mana of any color" }, "{T}, Pay {E}: Add one mana of any color.")).toBeUndefined();
    expect(energyReading({ verb: "draw", object: "{E}" }, "Draw {E}.")).toBeUndefined();
  });
  it("only a gain filed as life, or a payment, is rewritten", () => {
    expect(energyRewrite({ verb: "add-mana", object: "one energy" }, "you get {E}")).toBeUndefined();
    expect(energyRewrite({ verb: "gain-life", object: "you" }, "You get {E}{E}.")).toMatchObject({ verb: "add-mana", object: "{E}" });
    expect(energyRewrite({ verb: "add-mana", object: "six {E}" }, "You may pay six {E}.")).toMatchObject({ verb: "remove-counter", object: "energy" });
  });
  it("is linear on a long run of spaces", () => {
    const t0 = performance.now();
    energyReading({ verb: "add-mana", object: "eight {E}" }, `${" ".repeat(40_000)}pay eight {E}${" ".repeat(40_000)}`);
    energyReading({ verb: "gain-life", object: "you" }, `get ${" ".repeat(40_000)}x`);
    expect(performance.now() - t0).toBeLessThan(500);
  });
});
