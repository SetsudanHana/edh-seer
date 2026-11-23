import { describe, expect, test } from "vitest";
import { deriveAsCorpus } from "../derive-worker.js";
import type { SubjectFilter } from "../schema.js";
import fixtures from "./play-permission-1275.fixtures.json" with { type: "json" };

/** #1275: "you may play lands and cast spells from your graveyard" (Magus of the Will) is a PLAY PERMISSION, not a return to the battlefield. The stored answer filed it as `put` ... `toZone: battlefield`
 *  with the object "lands and spells from your graveyard" (a spell is never put onto the battlefield from a graveyard), so derive emitted a land `enters` from the graveyard and the Ramp role read it.
 *  Card documents and stored `cardClauses` dumped from Mongo 2026-11-23 (DERIVE 585). */
type Fx = { source: Record<string, unknown>; canonical?: unknown[]; segmentHash?: string };
const rowOf = (name: string) => {
  const f = (fixtures as unknown as Record<string, Fx>)[name]!;
  return deriveAsCorpus({ doc: { oracleId: name, name, canonical: f.canonical ?? [], segmentHash: f.segmentHash } as never, source: f.source, isToken: false });
};
const emits = (name: string, verb: string): SubjectFilter[] => rowOf(name).tags.abilities.flatMap((a) => a.emits ?? []).filter((e) => e.verb === verb && e.subject.self !== true).map((e) => e.subject);

test("Magus of the Will: the land half is a land PLAY from your graveyard, and no land enters", () => {
  expect(emits("Magus of the Will", "enters").filter((s) => s.type === "land")).toEqual([]);
  const play = emits("Magus of the Will", "land-play");
  expect(play).toHaveLength(1);
  expect(play[0]).toMatchObject({ control: "you", type: "land", fromZone: "graveyard", owner: "you" });
});
test("Magus of the Will: the spell half is a cast from your graveyard, as Yawgmoth's Will's is", () => {
  expect(emits("Magus of the Will", "cast")).toEqual(emits("Yawgmoth's Will", "cast"));
});
test("Crucible of Worlds keeps its land play", () => {
  expect(emits("Crucible of Worlds", "land-play")).toHaveLength(1);
  expect(emits("Crucible of Worlds", "enters")).toEqual([]);
});
test("Splendid Reclamation keeps its land enters: a real return puts the lands onto the battlefield", () => {
  expect(emits("Splendid Reclamation", "enters").filter((s) => s.type === "land")).toHaveLength(1);
  expect(emits("Splendid Reclamation", "land-play")).toEqual([]);
});
describe.each(["Yawgmoth's Will", "Gaea's Will"])("%s: unchanged", (n) => {
  test("a land play and a cast, no enters", () => {
    expect(emits(n, "land-play")).toHaveLength(1);
    expect(emits(n, "enters")).toEqual([]);
  });
});
