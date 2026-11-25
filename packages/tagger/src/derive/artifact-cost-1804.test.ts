import { describe, expect, test } from "vitest";
import { deriveAsCorpus } from "../derive-worker.js";
import fixtures from "./artifact-cost-1804.fixtures.json" with { type: "json" };

/** #1804, owner ruling 2026-11-24: a cost that gets cheaper with, or is paid with, artifacts you control is an artifact demand. The store files affinity and improvise as an inert `none` action ("Affinity for artifacts", CR 702.41a: "This spell costs {1} less to cast for each [text] you control";
 *  "Improvise", CR 702.126a: each artifact you tap pays for {1}) and drops "This ability costs {1} less to activate for each other artifact you control" (Etherium Pteramander, Tamiyo's Logbook), so none of them derived a count. Stored documents and clauses of the production corpus, 2026-11-25. */
type Fx = { source: Record<string, unknown>; canonical: unknown[]; segmentHash?: string };
const rowOf = (name: string) => {
  const f = (fixtures as unknown as Record<string, Fx>)[name]!;
  return deriveAsCorpus({ doc: { oracleId: name, name, canonical: f.canonical, segmentHash: f.segmentHash } as never, source: f.source, isToken: false });
};
const reductions = (name: string) => rowOf(name).tags.abilities.filter((a) => a.effect.kind === "cost-reduction" && a.effect.scalingSubject?.zone === "battlefield");

describe("a cost reduction per artifact you control derives a board count of artifacts", () => {
  test.each([
    ["Frogmite", "Affinity for artifacts"],
    ["Refurbished Familiar", "Affinity for artifacts"],
    ["Demonic Junker", "Affinity for artifacts"],
    ["Fen Hauler", "Improvise"],
    ["Battle at the Bridge", "Improvise"],
    ["Etherium Pteramander", "This ability costs {1} less to activate for each other artifact you control"],
    ["Tamiyo's Logbook", "This ability costs {1} less to activate for each other artifact you control"],
  ])("%s (%s)", (name, printed) => {
    expect((fixtures as unknown as Record<string, Fx>)[name]!.source.oracleText).toContain(printed);
    const [a] = reductions(name);
    expect(a, name).toBeDefined();
    expect(a!.effect.scalingSubject).toMatchObject({ type: "artifact", zone: "battlefield", control: "you" });
  });
  test("a card with no artifact cost reduction derives none (Grizzly Bears, Llanowar Elves); an affinity for another class is not ruled (Urza, Chief Artificer: artifact creatures)", () => {
    for (const n of ["Grizzly Bears", "Llanowar Elves", "Urza, Chief Artificer"]) expect(reductions(n).filter((a) => a.effect.scalingSubject?.type === "artifact" && a.effect.scalingSubject.allTypes === undefined && a.kind === "static" && n !== "Urza, Chief Artificer"), n).toEqual([]);
    expect(rowOf("Urza, Chief Artificer").tags.abilities.some((a) => a.effect.kind === "cost-reduction")).toBe(false);
  });
});
