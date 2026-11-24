import { describe, expect, test } from "vitest";
import { deriveAsCorpus } from "../derive-worker.js";
import { CREATURE_SUBTYPES } from "./subtypes.js";
import fixtures from "./distinct-types-1785.fixtures.json" with { type: "json" };

/** #1785 -- THE GRAMMAR TELLS A COUNT OF DISTINCT TYPES FROM A PLAIN COUNT. Card documents and stored `cardClauses` (null for a card the grammar reads completely) dumped from the production Mongo, DERIVE 593 tree, 2026-11-24:
 *  `distinct-types-1785.fixtures.json`. The scales partner of a creature-type count stays the changelings and a graveyard count keeps its class (owner rulings, #1680): the distinct unit is carried BESIDE them. */
type Fx = { source: Record<string, unknown>; canonical?: unknown[]; segmentHash?: string };
const rowOf = (name: string) => {
  const f = (fixtures as unknown as Record<string, Fx>)[name]!;
  return deriveAsCorpus({ doc: { oracleId: name, name, canonical: f.canonical ?? [], segmentHash: f.segmentHash } as never, source: f.source, isToken: false }).tags;
};
const effects = (name: string) => rowOf(name).abilities.filter((a) => a.effect.distinctCount !== undefined);
const counted = (name: string) => effects(name).map((a) => a.effect.distinctCount);

describe("a creature-type count on the battlefield carries its unit", () => {
  test.each(["Infinite Diversity", "Saavik, Stoic Student", "Captain Jonathan Archer", "Jean-Luc, Mon Capitaine", "Starfleet Academy"])("%s", (name) => {
    expect(counted(name).length, name).toBeGreaterThan(0);
    for (const d of counted(name)) expect(d).toMatchObject({ counts: "creature-type", class: { type: "creature", zone: "battlefield" } });
  });
  test("Valiant Changeling keeps the changeling scales partner AND carries the unit", () => {
    const a = rowOf("Valiant Changeling").abilities.find((x) => x.effect.distinctCount !== undefined)!;
    expect(a.effect.distinctCount).toMatchObject({ counts: "creature-type", class: { type: "creature", control: "you", zone: "battlefield" } });
    expect(a.effect.scalingSubject).toMatchObject({ keyword: ["changeling"], control: "you" });
    expect(a.effect.scaling).toBe("per-creature");
  });
  test("the 'non-Borg' class is not a scales partner (unchanged) but is the unit's class", () => {
    const a = rowOf("Infinite Diversity").abilities.find((x) => x.effect.distinctCount !== undefined)!;
    expect(a.effect.scalingSubject).toBeUndefined();
    expect(a.effect.distinctCount!.class.notSubtype).toEqual(["borg"]);
  });
  // CEILING (reported, not built): the grammar derives no count for Hoshi Sato (the X sits in a "where X is" the `put` actions never carry) and nothing at all for You and Ooze Army?; Sarek's "for every five" is not a COUNTED phrase.
  test("a card that names no creature-type count carries none", () => {
    for (const n of ["Grizzly Bears", "Changeling Outcast", "Mistform Ultimus", "Maskwood Nexus", "Nael, Avizoa Aeronaut"]) expect(counted(n), n).toEqual([]);
  });
});

describe("a graveyard card-type count carries the unit and keeps its class", () => {
  test.each([["Tarmogoyf", "any"], ["Nethergoyf", "you"], ["Emrakul, the Promised End", "you"], ["Nighthawk Scavenger", "opp"], ["Altar of the Goyf", "any"]])("%s counts %s graveyards", (name, control) => {
    const a = rowOf(name).abilities.find((x) => x.effect.distinctCount !== undefined)!;
    expect(a, name).toBeDefined();
    expect(a.effect.distinctCount).toMatchObject({ counts: "type", class: { zone: "graveyard", control } });
    expect(a.effect.scalingSubject).toMatchObject({ zone: "graveyard", control });
  });
  test("Subgoyf counts subtypes, not card types", () => expect(counted("Subgoyf")).toEqual([]));
  test("a battlefield card-type count is unchanged (Loot)", () => expect(counted("Loot, the Key to Everything")).toMatchObject([{ counts: "type", class: { zone: "battlefield", control: "you" } }]));
});

describe("a delirium-style threshold records the types it counts", () => {
  test.each(["Dragon's Rage Channeler", "Traverse the Ulvenwald"])("%s", (name) => {
    const gated = rowOf(name).abilities.filter((a) => a.threshold?.atLeast === 4);
    expect(gated.length, name).toBeGreaterThan(0);
    for (const a of gated) {
      expect(a.thresholdDistinct, name).toMatchObject({ counts: "type", class: { zone: "graveyard", control: "you" } });
      // a diversity count is not a fill demand: the board-count subject stays unset
      expect(a.thresholdSubject, name).toBeUndefined();
    }
  });
  test("a count over cards that are not in a graveyard or on a board states no unit (Keen-Eyed Curator, Baba Lysaga)", () => {
    for (const n of ["Keen-Eyed Curator", "Baba Lysaga, Night Witch"]) for (const a of rowOf(n).abilities) expect(a.thresholdDistinct, n).toBeUndefined();
  });
  test("a threshold with no distinct count states none (Nael: basic land types)", () => {
    for (const a of rowOf("Nael, Avizoa Aeronaut").abilities) expect(a.thresholdDistinct).toBeUndefined();
  });
});

describe("a card that is every creature type without the Changeling keyword has every creature subtype", () => {
  test.each(["Mistform Ultimus", "Dr. Julius Jumblemorph"])("%s", (name) => {
    const t = rowOf(name).characteristics;
    expect(t.keywords).not.toContain("changeling");
    expect(t.subtypes).toEqual(expect.arrayContaining([...CREATURE_SUBTYPES]));
    expect(t.subtypes.length).toBeGreaterThan(CREATURE_SUBTYPES.length - 1);
  });
  test("a grant to OTHER permanents is not the card's own type line (Maskwood Nexus, Runed Stalactite)", () => {
    for (const n of ["Maskwood Nexus", "Runed Stalactite"]) expect(rowOf(n).characteristics.subtypes.length, n).toBeLessThan(5);
  });
  test("a card with one creature type keeps one (Grizzly Bears)", () => expect(rowOf("Grizzly Bears").characteristics.subtypes).toEqual(["bear"]));
});
