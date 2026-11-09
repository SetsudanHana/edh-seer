import { describe, expect, test } from "vitest";
import { clauseFacesWithTwins, twinClauseOf } from "./derive-input.js";
import { deriveAsCorpus } from "./derive-worker.js";
import { segment } from "./segment.js";
import type { ClauseRecord } from "./canonicalize.js";
import fixtures from "./clause-alignment.fixtures.json" with { type: "json" };

/** #1577 part 4: A TEXTLESS TWIN (a stored clause id the segmenter lacks) TAKES THE FACE OF THE CLAUSE IT WAS PRINTED IN. The model splits "Whenever a creature dies or a creature card is put into a graveyard from a library, each opponent loses 1 life"
 *  (Dreadhound) into two records and numbers the second 3, where `segment()` has one clause 2; derive folds such a twin (derive.ts `textless`), so its id stays, but the face map had no entry for it and a BACK-face twin read as the front face's.
 *  Card documents and stored `cardClauses` dumped from Mongo 2026-11-09 (DERIVE 481). */
type Fx = { source: { oracleText: string; keywords?: string[]; typeLine?: string; faces?: unknown[] }; canonical: ClauseRecord[]; segmentHash?: string };
const F = fixtures as unknown as Record<string, Fx>;
const twins = (name: string): [number, number][] => {
  const { source, canonical } = F[name]!;
  return [...twinClauseOf(canonical, segment(source.oracleText, source.keywords ?? [], source.typeLine ?? ""))];
};

describe("twinClauseOf: the clause a record with an unknown id was printed in", () => {
  test.each([
    ["Dreadhound", [[3, 2]]],
    ["Kindred Discovery", [[3, 2]]],
    ["Kaya's Ghostform", [[3, 2]]],
    ["Fear of Sleep Paralysis", [[4, 2]]],
    ["Sapphire Dragon // Psionic Pulse", [[4, 2]]],
    ["Elemental Expressionist", [[3, 2]]],
    ["Visage of Dread // Dread Osseosaur", [[5, 4]]],
  ])("%s", (name, expected) => {
    expect(twins(name)).toEqual(expected);
  });
  test.each(["Goldspan Dragon", "Ultima, Origin of Oblivion", "Phantasmal Image", "Dragonhawk, Fate's Tempest", "Professor Onyx", "Lumbering Worldwagon", "Supernatural Stamina", "Urza's Saga"])(
    "CONTROL: %s (every id the segmenter has, a shared id, or a pinned split id) moves nothing", (name) => {
      expect(twins(name)).toEqual([]);
    });
});

describe("the face map carries the twin", () => {
  test("Visage of Dread: the back face's attacks twin is on face 1, as its enters half", () => {
    const { source, canonical } = F["Visage of Dread // Dread Osseosaur"]!;
    const faces = clauseFacesWithTwins(source, canonical);
    expect(faces[4]).toBe(1);
    expect(faces[5]).toBe(1);
  });
  test("a front-face twin stays on the front face", () => {
    const { source, canonical } = F["Dreadhound"]!;
    expect(clauseFacesWithTwins(source, canonical)[3]).toBeUndefined();
  });
  // Visage of Dread's and Tetzin's twins are folded into their partner (no ability of their own), so only the face map is checked there; Ludevic's twin keeps an ability.
  test.each(["Ludevic, Necrogenius // Olag, Ludevic's Hubris"])("%s: no back-face ability is left on the front face", (name) => {
    const f = F[name]!;
    const row = deriveAsCorpus({ doc: { oracleId: name, name, canonical: f.canonical, segmentHash: f.segmentHash } as never, source: f.source, isToken: false });
    const backClauses = new Set(segment(f.source.oracleText, f.source.keywords ?? [], f.source.typeLine ?? "").filter((c) => (c.face ?? 0) > 0).map((c) => c.id));
    const twinIds = new Set(twins(name).filter(([, to]) => backClauses.has(to)).map(([id]) => id));
    const twinAbilities = row.tags.abilities.filter((a) => a.clause !== undefined && twinIds.has(Number(a.clause)));
    expect(twinAbilities.length).toBeGreaterThan(0);
    expect(twinAbilities.every((a) => (a.face ?? 0) > 0)).toBe(true);
  });
});
