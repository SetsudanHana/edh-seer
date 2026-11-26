import { expect, test } from "vitest";
import { deriveCardTags, deriveInputOf, grammarClauseRecords } from "@edh-seer/tagger";
import type { CardTags, ClauseRecord } from "@edh-seer/tagger";
import { loadHierarchy, pairReasons } from "./index.js";
import { fodderDemandsOf } from "./partners-core.js";
import type { DeckCard } from "./types.js";
import fixtures from "./fixtures/permanent-sacrifice-1814.json" with { type: "json" };

/** #1814, owner ruling 2026-11-26: "sacrifice (another) nonland permanent" is whole-deck, like Claws of Gix's "Sacrifice a permanent". No type-narrowed fodder: only tokens and recursive (undying / persist) cards are fodder, under the same key and tag as a lone
 *  "permanent" outlet (`fodder|-|permanent|-`, `fodder:permanent`). A nonland outlet reads a land token as no fodder (a land is not a nonland permanent). Stored documents and clauses of the production corpus, 2026-11-26. */
type Fx = { source: Record<string, unknown> & { _id: string }; canonical: ClauseRecord[] | null };
const F = fixtures as unknown as Record<string, Fx>;
const dc = (name: string): DeckCard => {
  const src = F[name]!.source;
  const g = F[name]!.canonical === null ? grammarClauseRecords(src as never) : undefined;
  return { card: src as unknown as DeckCard["card"], tags: deriveCardTags(deriveInputOf(src as never, name, name, g ? g.records : F[name]!.canonical!, undefined, g?.readings)) as CardTags };
};
const treasure = (): DeckCard => ({ card: { name: "Treasure", typeLine: "Token Artifact — Treasure", oracleText: "", keywords: [], colors: [], manaValue: 0 }, tags: F["__treasure"] as unknown as CardTags, isToken: true });
const fodder = (p: DeckCard, c: DeckCard) => pairReasons(p, c, loadHierarchy()).filter((r) => r.tag.startsWith("fodder:") && r.consumer === c.card.name && r.producer === p.card.name).map((r) => r.tag);
const NONLAND = ["Gluttonous Troll", "Bolas's Citadel", "Rite of Oblivion", "Magmaw", "Rottenmouth Viper", "Fatal Grudge", "Dreamshaper Shaman"];

test("the cards print a nonland permanent, and Claws of Gix a permanent", () => {
  expect(String(F["Gluttonous Troll"]!.source.oracleText)).toContain("Sacrifice another nonland permanent:");
  expect(String(F["Claws of Gix"]!.source.oracleText)).toContain("Sacrifice a permanent:");
});

test.each(NONLAND)("%s asks for the key a lone permanent outlet asks for", (n) => {
  expect(fodderDemandsOf(dc(n)).map((k) => k.key), n).toEqual(fodderDemandsOf(dc("Claws of Gix")).map((k) => k.key));
  expect(fodderDemandsOf(dc(n)).map((k) => k.tag), n).toEqual(["fodder:permanent"]);
});

test.each(["Claws of Gix", ...NONLAND])("%s: an artifact is no fodder (whole deck), a token and an undying or persist creature are, all as fodder:permanent", (n) => {
  expect(fodder(dc("Sol Ring"), dc(n)), `${n} <- Sol Ring`).toEqual([]);
  expect(fodder(treasure(), dc(n)), `${n} <- Treasure`).toEqual(["fodder:permanent"]);
  expect(fodder(dc("Young Wolf"), dc(n)), `${n} <- Young Wolf`).toEqual(["fodder:permanent"]);
  expect(fodder(dc("Kitchen Finks"), dc(n)), `${n} <- Kitchen Finks`).toEqual(["fodder:permanent"]);
});

test("an edict or victim's choice is still no cost of yours: Pir's Whim and Maarika ask for nothing", () => {
  expect(fodderDemandsOf(dc("Pir's Whim"))).toEqual([]);
  expect(fodderDemandsOf(dc("Maarika, Brutal Gladiator"))).toEqual([]);
});
