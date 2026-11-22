import { describe, expect, test } from "vitest";
import { deriveAsCorpus, deriveGrammarOnly } from "../derive-worker.js";
import { grammarClauseRecords } from "../grammar/clause-record.js";
import type { SubjectFilter } from "../schema.js";
import fixtures from "./own-entry.fixtures.json" with { type: "json" };

/** #1737 review round: `putsOwnCard` stamps `owner: you` on a put out of your own zone, and nowhere else. Production fixtures: card documents and stored `cardClauses.canonical`, dumped from Mongo 2026-11-22 (DERIVE 574 first round). */
type Fx = { source: Record<string, unknown>; canonical: unknown[]; segmentHash?: string };
const F = fixtures as unknown as Record<string, Fx>;
const rowOf = (name: string) => deriveAsCorpus({ doc: { oracleId: name, name, canonical: F[name]!.canonical, segmentHash: F[name]!.segmentHash } as never, source: F[name]!.source, isToken: false });
const puts = (name: string): SubjectFilter[] => rowOf(name).tags.abilities.flatMap((a) => a.emits ?? []).filter((e) => e.verb === "enters" && e.subject.self !== true).map((e) => e.subject);
const JOURNEY = "Journey to Eternity // Atzal, Cave of Eternity";

describe("a pointer is licensed only by its own clause", () => {
  test("Journey to Eternity: the creature that died (it can be stolen) carries no owner; Atzal's own put from your graveyard does", () => {
    const [dies, atzal] = puts(JOURNEY);
    expect(dies!.ref).toBe("trigger");
    expect(dies!.owner).toBeUndefined();
    expect(atzal!.owner).toBe("you");
  });
  test.each(["Stitch Together", "Revivify"])("%s: 'that card / those cards from your graveyard' names the zone in its own clause: still yours", (name) => {
    for (const s of puts(name)) expect(s.owner).toBe("you");
  });
});
describe("the search a put follows names whose library it is", () => {
  test("Tempt with Discovery: the opponent's put out of THEIR library is unstamped, your two are yours", () => {
    expect(puts("Tempt with Discovery").map((s) => s.owner)).toEqual(["you", undefined, "you"]);
  });
});
describe("a put the model stored with no origin, after a search of your library", () => {
  test.each(["Eldritch Evolution", "Doubling Chant"])("%s: the stored put has no fromZone and says owner you", (name) => {
    const rows = puts(name);
    expect(rows.length).toBeGreaterThan(0);
    for (const s of rows) { expect(s.fromZone).toBeUndefined(); expect(s.owner).toBe("you"); }
  });
  test("Bog Glider: the grammar's reading (fromZone library) and the stored answer's (no origin) both say owner you", () => {
    const f = F["Bog Glider"]!;
    const g = grammarClauseRecords(f.source as never);
    expect(g.complete).toBe(true);
    const grammar = deriveGrammarOnly(f.source, "Bog Glider", "Bog Glider", g).abilities.flatMap((a) => a.emits ?? []).filter((e) => e.verb === "enters").map((e) => e.subject);
    const stored = deriveAsCorpus({ doc: { oracleId: "x", name: "Bog Glider", canonical: f.canonical, segmentHash: "stale" } as never, source: f.source, isToken: false }).tags.abilities.flatMap((a) => a.emits ?? []).filter((e) => e.verb === "enters").map((e) => e.subject);
    expect(grammar.map((s) => s.owner)).toEqual(["you"]);
    expect(stored.map((s) => s.owner)).toEqual(["you"]);
  });
});
describe("See the Unwritten: both puts take the one library the card names", () => {
  test("the Ferocious 'two creature cards instead' put is stamped like the first, so the two events stay one when equal", () => {
    expect(puts("See the Unwritten").map((s) => s.owner)).toEqual(["you", "you"]);
  });
});
