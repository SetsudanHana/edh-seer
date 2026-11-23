import { describe, expect, test } from "vitest";
import { deriveAsCorpus } from "@edh-seer/tagger/derive-worker";
import type { CardTags } from "@edh-seer/tagger";
import { loadHierarchy, pairReasons } from "./index.js";
import type { DeckCard } from "./types.js";
import fixtures from "./fixtures/anyof-branch-1764.json" with { type: "json" };

/** #1764: AN `anyOf` TRIGGER TAGS ITS REASON BY THE BRANCH THE PRODUCER MEETS, not by the first branch. Canoptek Spyder hears "another nontoken artifact creature or Vehicle you control enters": a Vehicle's own
 *  entering (Esika's Chariot) met the second branch and was still tagged `enters:creature`. Cards and stored `cardClauses` dumped from Mongo 2026-11-23 (DERIVE 591), derived as derive-corpus derives them. */
type Fx = { source: Record<string, unknown>; canonical?: unknown[]; segmentHash?: string };
const F = fixtures as unknown as Record<string, Fx>;
const H = loadHierarchy();
const dc = (name: string): DeckCard => {
  const f = F[name]!;
  const tags: CardTags = deriveAsCorpus({ doc: { oracleId: name, name, canonical: f.canonical ?? [], segmentHash: f.segmentHash } as never, source: f.source, isToken: false }).tags;
  return { card: { _id: name, ...f.source } as unknown as DeckCard["card"], tags };
};
/** The `enters:` tags of the reasons where `producer`'s own entering feeds `consumer`. */
const entersTags = (producer: string, consumer: string): string[] =>
  pairReasons(dc(producer), dc(consumer), H).filter((r) => r.producer === producer && r.consumer === consumer && r.tag.startsWith("enters:") && r.text.startsWith(`When ${producer} enters`)).map((r) => r.tag);

describe("an anyOf trigger is tagged by the branch the producer meets (#1764)", () => {
  test("Esika's Chariot (a Vehicle) -> Canoptek Spyder: enters:vehicle, not enters:creature", () => {
    expect(entersTags("Esika's Chariot", "Canoptek Spyder")).toEqual(["enters:vehicle"]);
  });
  test("Solemn Simulacrum (an artifact creature) -> Canoptek Spyder keeps enters:creature, the first branch", () => {
    expect(entersTags("Solemn Simulacrum", "Canoptek Spyder")).toEqual(["enters:creature"]);
  });
  test("a non-Vehicle anyOf: Saheeli, Radiant Creator (an Artificer, no artifact) -> Era of Innovation's 'artifact or Artificer' is enters:artificer", () => {
    expect(entersTags("Saheeli, Radiant Creator", "Era of Innovation")).toEqual(["enters:artificer"]);
  });
  test("a non-anyOf trigger is unchanged: Solemn Simulacrum -> Soul Warden is enters:creature", () => {
    expect(entersTags("Solemn Simulacrum", "Soul Warden")).toEqual(["enters:creature"]);
  });
  // Two emits meeting two branches (Mizzix's Mastery casts a sorcery and an instant-or-sorcery) say one thing: one row, as before the branch keying.
  test("Mizzix's Mastery -> Rockslide Sorcerer: its cast is one reason, not one per branch", () => {
    const rows = pairReasons(dc("Mizzix's Mastery"), dc("Rockslide Sorcerer"), H)
      .filter((r) => r.producer === "Mizzix's Mastery" && r.text.startsWith("When Mizzix's Mastery is cast"));
    expect(rows.map((r) => r.tag)).toEqual([rows[0]!.tag]);
    expect(rows.length).toBe(1);
  });
});
