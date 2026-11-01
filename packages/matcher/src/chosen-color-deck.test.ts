import { expect, test } from "vitest";
import { analyzeDeckStructured } from "./analyze.js";
import { characteristicsSubject, pairReasons } from "./edges.js";
import type { CardTags } from "@edh-seer/tagger";
import type { DeckCard, Hierarchy } from "./types.js";

// #1360 round 3: a REAL colourless permanent has no colour list on its producer subject, so the "has a colour" guard never saw it.
// Characteristics are the corpus's (2026-11-01): Caged Sun and Heraldic Banner are colourless artifacts, Canoptek Spyder and
// Metallic Mimic colourless artifact creatures, Shard of the Nightbringer a black creature. The ability is Caged Sun's stored row.
const H: Hierarchy = { creature: ["creature"] };
const card = (name: string, types: string[], colors: string[], abilities: CardTags["abilities"] = []): DeckCard => ({
  card: { name, typeLine: types.join(" "), oracleText: "", keywords: [], colors, colorIdentity: colors, manaValue: 0 } as unknown as DeckCard["card"],
  tags: {
    oracleId: name, schemaVersion: 1, promptVersion: 1, model: "t",
    characteristics: { types, subtypes: [], colors, identity: colors, cmc: 0, power: "1", toughness: "1", token: false, keywords: [] },
    abilities,
  } as CardTags,
});
const pump = (subject: object): CardTags["abilities"] => [{
  kind: "static", effect: { kind: "pump", subject }, amount: "+1/+1", clause: 2, repeats: "continuous",
}] as never;
const sunSubject = { control: "you", token: null, type: "creature", scope: "all", chosenColor: true };
const sun = card("Caged Sun", ["artifact"], [], pump(sunSubject));
const banner = card("Heraldic Banner", ["artifact"], [], pump(sunSubject));
const spyder = card("Canoptek Spyder", ["artifact", "creature"], []);
const mimic = card("Metallic Mimic", ["artifact", "creature"], []);
const shard = card("Shard of the Nightbringer", ["creature"], ["B"]);
const stats = (a: DeckCard, b: DeckCard) => pairReasons(a, b, H).filter((r) => /bigger stats/.test(r.text));

test("a colourless permanent's subject keeps its printed empty colour list", () => {
  expect(characteristicsSubject(spyder.tags!).colors).toEqual([]);
  expect(characteristicsSubject(shard.tags!).colors).toEqual(["B"]);
});

test("pair isolation: Caged Sun and Heraldic Banner pump a black creature and not a colourless one", () => {
  expect(stats(sun, shard).length).toBeGreaterThan(0);
  expect(stats(sun, spyder)).toEqual([]);
  expect(stats(banner, mimic)).toEqual([]);
});

test("a deck pasted with no commander: Caged Sun does not pump Canoptek Spyder", () => {
  const report = analyzeDeckStructured([sun, spyder, shard], undefined, H);
  const has = (a: string, b: string) => report.edges.some((e) => [e.a, e.b].sort().join("|") === [a, b].sort().join("|") && e.reasons.some((r) => /bigger stats/.test(r.text)));
  expect(has("Caged Sun", "Shard of the Nightbringer")).toBe(true);
  expect(has("Caged Sun", "Canoptek Spyder")).toBe(false);
});
