import { describe, expect, test } from "vitest";
import { parseSubject } from "./subject.js";
import { deriveAsCorpus } from "../derive-worker.js";
import fixtures from "./restricted-permanents.fixtures.json" with { type: "json" };

/** #1557 -- A RESTRICTED PERMANENT SUBJECT IS NOT "ALL PERMANENTS", AND A PER-OPPONENT CHOICE IS NOT A MASS.
 *  Card documents and stored `cardClauses` dumped from Mongo (DERIVE 467 tree, 2026-11-06): `restricted-permanents.fixtures.json`. */
type Fx = { source: Record<string, unknown>; canonical?: unknown[]; segmentHash?: string };
const rowOf = (name: string) => {
  const f = (fixtures as unknown as Record<string, Fx>)[name]!;
  return deriveAsCorpus({ doc: { oracleId: name, name, canonical: f.canonical ?? [], segmentHash: f.segmentHash } as never, source: f.source, isToken: false });
};
const emits = (name: string, verb: string) => rowOf(name).tags.abilities.flatMap((a) => a.emits ?? []).filter((e) => e.verb === verb);

describe("a per-opponent choice is one permanent each, not a mass", () => {
  test("Ultimate Magic: Meteor: the chosen artifact or land has no mass scope", () => {
    for (const verb of ["dies", "exiled"]) {
      const e = emits("Ultimate Magic: Meteor", verb);
      expect(e.length).toBeGreaterThan(0);
      for (const x of e) { expect(x.subject.scope).toBeUndefined(); expect(x.subject.selection).toBe("chosen"); }
    }
  });
  test("Sadistic Shell Game and Tunnel of Love: the chosen creatures are not every creature", () => {
    expect(emits("Sadistic Shell Game", "dies").map((e) => e.subject.scope)).toEqual([undefined]);
    expect(emits("Tunnel of Love", "exiled").map((e) => e.subject.scope)).toEqual([undefined]);
  });
  test("CONTROL: Apocalypse's all permanents stay a mass", () => {
    expect(emits("Apocalypse", "exiled").map((e) => [e.subject.type, e.subject.scope, e.subject.selection])).toContainEqual(["permanent", "all", undefined]);
  });
});

describe("a restricted permanent subject says so", () => {
  test("Wash Out: the colour of your choice", () => {
    expect(emits("Wash Out", "leaves").map((e) => e.subject.chosenColor)).toEqual([true]);
  });
  test("All Is Dust: colored permanents", () => {
    expect(emits("All Is Dust", "dies").map((e) => e.subject.colorCount)).toEqual(["colored"]);
  });
  test("Razia's Purification: all but the three chosen", () => {
    expect(emits("Razia's Purification", "dies").map((e) => e.subject.selection)).toEqual(["all-but"]);
  });
  test("Mount Doom: creatures other than the two chosen", () => {
    expect(emits("Mount Doom", "dies").filter((e) => e.subject.type === "creature").map((e) => e.subject.selection)).toEqual(["all-but"]);
  });
  test("Council's Judgment: the permanents with the most votes", () => {
    expect(emits("Council's Judgment", "exiled").map((e) => e.subject.selection)).toEqual(["votes"]);
  });
  test("End Hostilities: permanents attached to creatures", () => {
    const e = emits("End Hostilities", "dies").filter((x) => x.subject.type === "permanent");
    expect(e.map((x) => x.subject.selection)).toEqual(["attached-to"]);
  });
  test("Liliana of the Veil: the pile of their choice", () => {
    const e = emits("Liliana of the Veil", "dies").filter((x) => x.subject.type === "permanent");
    expect(e.map((x) => x.subject.selection)).toEqual(["pile"]);
  });
});

describe("the COMPLEMENT of a choice stays the mass (the first measure lost 12 true wipes)", () => {
  test.each([
    ["Divine Reckoning", "dies"], ["Consuming Tide", "leaves"], ["Stick Together", "dies"], ["The Eternal Wanderer", "dies"], ["Winnowing", "dies"],
    ["Unstable Glyphbridge // Sandswirl Wanderglyph", "dies"], ["Harsh Mercy", "dies"], ["Expel the Interlopers", "dies"], ["Sculpted Sunburst", "exiled"], ["Planar Overlay", "leaves"], ["Bend or Break", "dies"],
  ])("%s: the %s emit keeps a mass scope", (name, verb) => {
    expect(emits(name, verb).some((e) => e.subject.scope === "all" || e.subject.scope === "each")).toBe(true);
  });
  test.each([["Call to the Void", "dies"], ["Druid of Purification", "dies"], ["Grenzo's Rebuttal", "dies"], ["The Horus Heresy", "dies"]])("%s: `chosen this way` is the picked set, not a mass", (name, verb) => {
    expect(emits(name, verb).map((e) => e.subject.scope)).not.toContain("all");
    expect(emits(name, verb).map((e) => e.subject.scope)).not.toContain("each");
  });
});

describe("the marker stays off what it is not", () => {
  test("Teferi: the tap of the chosen permanents is still a taps emit", () => {
    expect(emits("Teferi, Who Slows the Sunset", "taps").map((e) => [e.subject.control, e.subject.type, e.subject.selection])).toEqual([["opp", "permanent", "chosen"]]);
  });
  test("Hew the Entwood, Mist of Stagnation, Patriarch's Bidding keep the mass they read before (`chosen this way` of an any-number / a type)", () => {
    expect(rowOf("Patriarch's Bidding").tags.abilities.flatMap((a) => a.emits ?? []).every((e) => e.subject.selection === undefined)).toBe(true);
  });
  test("`all but 1 of that damage` and `all but the bottom card` are not a set", () => {
    expect(rowOf("Temple Altisaur").tags.abilities.flatMap((a) => a.emits ?? []).every((e) => e.subject.selection === undefined)).toBe(true);
    expect(rowOf("Kindred Dominance").tags.abilities.flatMap((a) => a.emits ?? []).every((e) => e.subject.selection === undefined)).toBe(true);
  });
});

describe("a number picked by a player, and an exception list, are marked too (the second measure: 15 of 21 new stax cards were these)", () => {
  const sel = (name: string, verb: string) => emits(name, verb).filter((e) => [e.subject.type].flat().includes("permanent")).map((e) => e.subject.selection);
  test.each([
    ["Pox Plague", "dies", "chosen"], ["Earth-Cult Elemental", "dies", "chosen"], ["Greater Harvester", "dies", "chosen"], ["Nicol Bolas, Planeswalker", "dies", "chosen"], ["Archfiend of Spite", "dies", "chosen"], ["Curse of the Cabal", "dies", "chosen"], ["Balancing Act", "dies", "chosen"],
    ["Bane of Bala Ged", "exiled", "chosen"], ["Scourglass", "dies", "all-but"], ["Cyclone Summoner", "leaves", "all-but"], ["Liliana, Dreadhorde General", "dies", "all-but"],
  ])("%s: the %s emit is selection %s", (name, verb, want) => {
    expect(sel(name, verb)).toContain(want);
  });
  test.each([["Apocalypse", "exiled"], ["Worldfire", "exiled"], ["Dimensional Breach", "exiled"], ["Bearer of the Heavens", "dies"], ["Thieves' Auction", "exiled"], ["Worldpurge", "leaves"]])("CONTROL: %s (%s) stays unmarked", (name, verb) => {
    expect(sel(name, verb)).toEqual(expect.arrayContaining([undefined]));
  });
});

describe("a stat or a token count compared to a number is no pick (the triage read 15 such phrases as `chosen`)", () => {
  test.each([
    "each nonland permanent with mana value less than or equal to the number of time counters on ~",
    "a number of Food tokens equal to the number of opponents you have",
    "all creatures with toughness less than or equal to the number of Islands you control",
  ])("%s", (phrase) => {
    expect(parseSubject(phrase).selection).toBeUndefined();
  });
  test("CONTROL: permanents they control equal to the number the fewest controls is a pick", () => {
    expect(parseSubject("permanents they control equal to the number of permanents controlled by the player who controls the fewest").selection).toBe("chosen");
  });
});
