import { describe, expect, test } from "vitest";
import { deriveAsCorpus } from "../derive-worker.js";
import fixtures from "./waterbend-1815.fixtures.json" with { type: "json" };

/** #1815, owner ruling 2026-11-26: waterbend is both an artifact demand (like improvise, #1804) and a creature demand. CR 701.67a: "Waterbend [cost]" means "Pay [cost]. For each generic mana in that cost, you may tap an untapped artifact or creature you control rather than pay that mana."
 *  Every card of the corpus that prints the word (29, stored documents and clauses 2026-11-26) derived no count. The card that PAYS a waterbend cost reads as a cost reduction counting artifacts you control plus creatures you control; a card that only triggers on a waterbend (Avatar Aang) or whose ward an opponent pays (The Unagi) is no demand. */
type Fx = { source: Record<string, unknown>; canonical: unknown[]; segmentHash?: string };
const F = fixtures as unknown as Record<string, Fx>;
const rowOf = (name: string) => deriveAsCorpus({ doc: { oracleId: name, name, canonical: F[name]!.canonical, segmentHash: F[name]!.segmentHash } as never, source: F[name]!.source, isToken: false });
const reductions = (name: string) => rowOf(name).tags.abilities.filter((a) => a.effect.kind === "cost-reduction" && a.effect.costOf === "waterbend");
const NOT_OWN_COST = ["Avatar Aang // Aang, Master of Elements", "The Unagi of Kyoshi Island"];
const ALL = Object.keys(F).filter((n) => /waterbend/i.test(String(F[n]!.source.oracleText)));

describe("a waterbend cost derives a count of artifacts you control plus creatures you control", () => {
  test("the corpus has 29 waterbend cards", () => { expect(ALL.length).toBe(29); });
  test.each(ALL.filter((n) => !NOT_OWN_COST.includes(n)))("%s", (name) => {
    const [a, ...rest] = reductions(name);
    expect(rest, `${name}: one demand, however many waterbend costs it prints`).toEqual([]);
    expect(a, name).toBeDefined();
    expect(a!.effect.scalingSubject).toMatchObject({ type: "artifact", zone: "battlefield", control: "you" });
    expect(a!.effect.scalingAlso).toMatchObject([{ type: "creature", zone: "battlefield", control: "you" }]);
  });
  test.each(NOT_OWN_COST)("%s pays no waterbend cost: no demand", (name) => {
    expect(reductions(name)).toEqual([]);
  });
  test("a card with no waterbend derives none (Sol Ring, Grizzly Bears)", () => {
    for (const n of ["Sol Ring", "Grizzly Bears"]) expect(reductions(n), n).toEqual([]);
  });
  test("the card's own abilities are kept beside the count (Katara, Water Tribe's Hope still makes her Ally token)", () => {
    expect(rowOf("Katara, Water Tribe's Hope").tags.abilities.map((a) => a.effect.kind)).toEqual(["token-generation", "cost-reduction"]);
  });
});
