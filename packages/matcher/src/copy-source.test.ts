import { describe, expect, test } from "vitest";
import { deriveCardTags, deriveInputOf, grammarClauseRecords } from "@edh-seer/tagger";
import type { CardTags } from "@edh-seer/tagger";
import { loadHierarchy, pairReasons } from "./index.js";
import type { DeckCard } from "./types.js";
import fixtures from "./copy-source.fixtures.json" with { type: "json" };

/** #1648: a copier's SOURCE restriction ("from an artifact source", "an ability of an artifact", "of a Chandra planeswalker", "of equipped creature")
 *  is a fact about the ability's source, derived into `effect.subject.abilityOf`; the copy-ability pass read `subject.type`, which no copier carries, so every
 *  activated or triggered ability paired with every copier. Oracle text, type line and colours are the corpus's own (cards.*, DERIVE 530) in the fixtures
 *  file beside this test; every card here derives from its printed text (clauseSource "grammar"). */
type Fx = { typeLine: string; oracleText: string; colors: string[]; colorIdentity: string[]; manaValue: number; power: string | null; toughness: string | null; keywords: string[]; loyalty?: string };
const FX = fixtures as unknown as Record<string, Fx>;
function card(name: string): DeckCard {
  const f = FX[name]!;
  const src = { ...f, name };
  const g = grammarClauseRecords(src as never);
  const tags = deriveCardTags(deriveInputOf(src as never, name, name, g.records, undefined, g.readings)) as CardTags;
  return { card: { name, typeLine: f.typeLine, oracleText: f.oracleText, keywords: f.keywords, colors: f.colors, manaValue: f.manaValue } as unknown as DeckCard["card"], tags };
}
const H = loadHierarchy();
const copies = (copier: string, source: string): string[] => pairReasons(card(copier), card(source), H).map((r) => r.tag).filter((t) => t.startsWith("copies:"));
const copySubject = (name: string) => card(name).tags!.abilities.find((a) => a.effect.kind === "copy-ability")!.effect.subject!;

const SOURCES = ["Mistrise Village", "Vexing Shusher", "Prodigal Sorcerer", "Chandra's Regulator", "Chandra, Torch of Defiance", "Ugin, the Spirit Dragon"];
const reached = (copier: string): string[] => SOURCES.filter((s) => copies(copier, s).length > 0);

describe("derive: the source restriction lands in subject.abilityOf", () => {
  test("a trigger's 'an ability of an artifact' (Kurkesh) and 'a loyalty ability of a Chandra planeswalker' (Chandra's Regulator)", () => {
    expect(copySubject("Kurkesh, Onakke Ancient").abilityOf).toEqual({ control: "any", type: "artifact" });
    expect(copySubject("Chandra's Regulator").abilityOf).toEqual({ control: "any", type: "planeswalker", subtype: "chandra" });
  });
  test("a host restriction (the Bracers, Rowan's Talent) is the status `equipped` / `enchanted`", () => {
    expect(copySubject("Illusionist's Bracers").abilityOf?.status).toEqual(["equipped"]);
    expect(copySubject("Battlemage's Bracers").abilityOf?.status).toEqual(["equipped"]);
    expect(copySubject("Rowan's Talent").abilityOf?.status).toEqual(["enchanted"]);
  });
  test("an unrestricted copier derives no abilityOf (Rings of Brighthearth, Gogo)", () => {
    expect(copySubject("Rings of Brighthearth").abilityOf).toBeUndefined();
    expect(copySubject("Gogo, Master of Mimicry").abilityOf).toBeUndefined();
  });
});

describe("match: a copier pairs only with a source its own text allows", () => {
  test("Kurkesh: an artifact's activated ability, never a land's or a creature's", () => {
    expect(reached("Kurkesh, Onakke Ancient")).toEqual(["Chandra's Regulator"]);
  });
  test("Tawnos and Scientist Supreme (artifact source; activated or triggered)", () => {
    expect(reached("Tawnos, Urza's Apprentice")).toEqual(["Chandra's Regulator"]);
    expect(reached("Scientist Supreme of A.I.M.")).toEqual(["Chandra's Regulator"]);
  });
  test("Echo (creature source) and Abstruse Archaic (colorless source)", () => {
    expect(reached("Echo, Perceptive Prodigy")).toEqual(["Vexing Shusher", "Prodigal Sorcerer"]);
    expect(reached("Abstruse Archaic")).toEqual(["Mistrise Village", "Ugin, the Spirit Dragon"]);
  });
  test("The Peregrine Dynamo: another LEGENDARY source", () => {
    expect(reached("The Peregrine Dynamo")).toEqual(["Chandra's Regulator", "Chandra, Torch of Defiance", "Ugin, the Spirit Dragon"]);
  });
  test("Weaver of Harmony: an enchantment source (Rowan's Talent triggers; no source here activates)", () => {
    expect(copies("Weaver of Harmony", "Rowan's Talent")).toEqual(["copies:triggered"]);
    expect(reached("Weaver of Harmony")).toEqual([]);
  });
  test("Chandra's Regulator: a loyalty ability of a CHANDRA, not of Ugin", () => {
    expect(reached("Chandra's Regulator")).toEqual(["Chandra, Torch of Defiance"]);
  });
  test("host-only copiers (the Bracers, Rowan's Talent) reach no arbitrary source", () => {
    expect(reached("Illusionist's Bracers")).toEqual([]);
    expect(reached("Battlemage's Bracers")).toEqual([]);
    expect(reached("Rowan's Talent")).toEqual([]);
  });
  test("an unrestricted copier still reaches every non-mana source (Rings of Brighthearth: activated; Gogo: both kinds)", () => {
    expect(reached("Rings of Brighthearth")).toEqual(["Mistrise Village", "Vexing Shusher", "Prodigal Sorcerer", "Chandra's Regulator", "Chandra, Torch of Defiance", "Ugin, the Spirit Dragon"]);
    expect(reached("Gogo, Master of Mimicry")).toEqual(reached("Rings of Brighthearth"));
    expect(copies("Rings of Brighthearth", "Sol Ring")).toEqual([]);
  });
});
