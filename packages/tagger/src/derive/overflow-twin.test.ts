import { describe, expect, test } from "vitest";
import { deriveAsCorpus } from "../derive-worker.js";
import fixtures from "./overflow-twin.fixtures.json" with { type: "json" };

/** #1699: A TEXTLESS OVERFLOW RECORD THAT ONLY RESTATES ITS COVERING CLAUSE IS FOLDED, NOT DERIVED A SECOND TIME. "Whenever X enters or attacks, ..." is one sentence; the grammar (Janice Rand) and the model (Haazda Vigilante,
 *  Queen's Bay Paladin, Sun Titan) both write the `attacks` limb as a second record with no text of its own, which derive read again: the attack trigger fired twice (the issue counted 4 rows with the twin in clause 2; the same
 *  shape sits in clause 3 behind a keyword line, Sun Titan). The twin is read WITHOUT the sentence's own reading, so it says LESS than its covering clause ({control: any} where the covering ability says you / the commander / a target
 *  creature, no amount, no count): `identicalTwinOf` folded only an exact copy, so every one of these stayed. A twin that says everything the covering ability says is dropped; one that says MORE stays.
 *  Fixtures: card documents and stored `cardClauses` dumped from Mongo 2026-11-21 (DERIVE 562); derived as derive-corpus derives them (`deriveAsCorpus`). */
type Fx = { source: Record<string, unknown>; canonical?: unknown[]; segmentHash?: string };
const rowOf = (name: string) => {
  const f = (fixtures as unknown as Record<string, Fx>)[name]!;
  return deriveAsCorpus({ doc: { oracleId: name, name, canonical: f.canonical ?? [], segmentHash: f.segmentHash } as never, source: f.source, isToken: false });
};
const abilitiesOf = (name: string, verb: string) => rowOf(name).tags.abilities.filter((a) => a.trigger?.verbs.includes(verb as never));
/** [enters, attacks] ability counts. */
const counts = (name: string) => [abilitiesOf(name, "enters").length, abilitiesOf(name, "attacks").length];

describe("an 'enters or attacks' sentence derives one attacks ability per effect, not one per record", () => {
  test.each([
    ["Janice Rand, Essential Aide", [2, 2]], // grammar: the counter and the land ramp, once each per trigger
    ["Haazda Vigilante", [1, 1]], // model, clause 2 duplicates clause 1
    ["Queen's Bay Paladin", [3, 3]], // return, finality counter, life loss
    ["Sun Titan", [1, 1]], // the same shape in clause 3 behind the Vigilance line
  ])("%s -> enters/attacks %j", (name, want) => expect(counts(name)).toEqual(want));
  test("Janice's surviving counter is the covering clause's: on the commander, not on 'any'", () => {
    const counters = abilitiesOf("Janice Rand, Essential Aide", "attacks").flatMap((a) => a.emits ?? []).filter((e) => e.verb === "counter-added");
    expect(counters.length).toBe(1);
    expect(counters[0]!.subject.commander).toBe(true);
  });
  test("the surviving abilities all belong to the covering clause", () => {
    for (const n of ["Janice Rand, Essential Aide", "Haazda Vigilante", "Queen's Bay Paladin"]) expect(new Set(abilitiesOf(n, "attacks").map((a) => a.clause))).toEqual(new Set([1]));
  });
});

describe("CONTROLS: a twin that says more than its covering clause stays", () => {
  // Mage Hunter's clause 2 loses life for `opp`, where the covering ability's reading is `any`.
  test("Mage Hunter keeps its opp lose-life twin", () => {
    const c = abilitiesOf("Mage Hunter", "copy").flatMap((a) => a.emits ?? []).filter((e) => e.verb === "lose-life");
    expect(c.map((e) => e.subject.control).sort()).toEqual(["any", "opp"]);
  });
  // Dwalin's clause 3 counts its counters ("scalesWith") where the covering clause says 1: a different count, not a poorer one.
  test("Dwalin keeps the twin whose count differs", () => expect(counts("Dwalin, Weaponmaster")[1]).toBe(2));
  // Spitting Slug's "blocks or becomes blocked" twin is the "Otherwise" branch (gate "you decline") and the covering clause's is not gated.
  test("Spitting Slug keeps the gated twin", () => expect(rowOf("Spitting Slug").tags.abilities.some((a) => a.gate?.kind === "unknown" && a.gate.otherwise === true)).toBe(true));
});
