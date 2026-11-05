import { describe, expect, test } from "vitest";
import { deriveRow } from "../derive-worker.js";
import { grammarClauseRecords } from "../grammar/clause-record.js";
import fixtures from "./name-subtype.fixtures.json" with { type: "json" };

/** #1518 -- A SELF SUBJECT NEVER TAKES A SUBTYPE FROM WORDS OF THE CARD'S NAME. Source documents and stored `cardClauses.canonical`
 *  dumped from Mongo (DERIVE 454 tree, 2026-11-05): `name-subtype.fixtures.json`. */
type Fx = { source: Record<string, unknown>; canonical: unknown[] };
const fx = (name: string) => (fixtures as Record<string, Fx>)[name]!;
const rowOf = (name: string) => deriveRow({ doc: { oracleId: name, name, canonical: fx(name).canonical } as never, source: fx(name).source, isToken: false });
const grammarRowOf = (name: string) => deriveRow({ doc: { oracleId: name, name, canonical: grammarClauseRecords(fx(name).source as never).records } as never, source: fx(name).source, isToken: false });
const selfSubtypes = (row: ReturnType<typeof rowOf>) =>
  row.tags.abilities.flatMap((a) => a.emits ?? []).filter((e) => e.subject.self === true && e.subject.subtype !== undefined).map((e) => `${e.verb}:${String(e.subject.subtype)}`);

describe("a self emit named by the card's name carries no subtype the card lacks", () => {
  test.each([
    ["Gerrard, Weatherlight Hero", "hero"],
    ["Turtles in Time", "turtle"],
    ["Stone of Erech", "stone"],
    ["Bob, Reluctant HYDRA Agent", "hydra"],
    ["Urza's Sylex", "urza's"],
  ])("%s (stored model clauses): no `%s`", (name, word) => {
    expect(selfSubtypes(rowOf(name)).filter((s) => s.endsWith(`:${word}`))).toEqual([]);
  });
  test.each(["Gerrard, Weatherlight Hero", "Turtles in Time", "Stone of Erech", "Bob, Reluctant HYDRA Agent", "Urza's Sylex", "The Beast, Deathless Prince"])(
    "%s (grammar path): no subtype from the name", (name) => {
      expect(selfSubtypes(grammarRowOf(name))).toEqual([]);
    });
  test("the type read off the name goes too: the Sylex is no land, the Stone Brain is the artifact it exiles", () => {
    const exile = (name: string) => rowOf(name).tags.abilities.flatMap((a) => a.emits ?? []).filter((e) => e.verb === "exiled" && e.subject.self === true).map((e) => e.subject.type);
    expect(exile("Urza's Sylex")).toEqual(["artifact"]);
    expect(exile("The Stone Brain")).toEqual(["artifact"]);
  });
  test("kept: The Locust God is a God, and its own leave still says so", () => {
    expect(selfSubtypes(rowOf("The Locust God"))).toContain("leaves:god");
  });
});
