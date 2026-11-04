import { expect, test } from "vitest";
import { clauseTexts, deriveCardTags, deriveInputOf, grammarClauseRecords } from "@edh-seer/tagger";
import type { Characteristics, ClauseRecord, CardTags } from "@edh-seer/tagger";
import { loadHierarchy, pairReasons } from "./index.js";
import type { DeckCard } from "./types.js";
import fixtures from "./self-exile-from-battlefield.fixtures.json" with { type: "json" };

/** #1495: "When X dies or is put into exile from the battlefield" lost its zone, so a card exiled from a GRAVEYARD fed it; and an
 *  exile OF something just put onto the battlefield (Haunted House's "Exile it") inherited the graveyard it came from, so the
 *  refusal cut true pairs. Oracle text and clause records are the corpus's own (cards.oracleText, cardClauses.canonical, DERIVE 447),
 *  in the fixtures file beside this test. */
type Fx = { typeLine: string; oracleText: string; clauses: unknown[] };
const FX = fixtures as unknown as Record<string, Fx>;
const chars = (types: string[]): Characteristics => ({
  types, subtypes: [], colors: [], identity: [], cmc: 0, power: null, toughness: null, token: false, keywords: [],
});
/** `grammar`: the printed-text reading a grammar-sourced row (Cry of the Carnarium's, in Mongo) is derived from. */
function card(name: string, grammar = false): DeckCard {
  const f = FX[name]!;
  const types = f.typeLine.split("—")[0]!.trim().toLowerCase().split(" ").filter((w) => w !== "legendary");
  const texts = clauseTexts({ oracleText: f.oracleText, keywords: [], typeLine: f.typeLine });
  const src = { oracleText: f.oracleText, keywords: [] as string[], typeLine: f.typeLine, name };
  const g = grammar ? grammarClauseRecords(src as never) : undefined;
  const tags = (g
    ? deriveCardTags(deriveInputOf(src as never, name, name, g.records, undefined, g.readings))
    : deriveCardTags({ oracleId: name, name, clauses: f.clauses as ClauseRecord[], clauseTexts: texts, characteristics: chars(types) })) as CardTags;
  return { card: { name, typeLine: f.typeLine, oracleText: f.oracleText, keywords: [], colors: [], manaValue: 0 } as unknown as DeckCard["card"], tags };
}
const H = loadHierarchy();
const bontu = card("God-Eternal Bontu");
const soulherder = card("Soulherder");
const exileTags = (a: DeckCard, b: DeckCard) => pairReasons(a, b, H).filter((r) => r.tag.startsWith("exiled"));

test("Bontu's exile trigger carries fromZone battlefield; its dies trigger is kept", () => {
  const triggers = bontu.tags!.abilities!.map((a) => a.trigger).filter(Boolean);
  const exiles = triggers.filter((t) => t!.verbs.includes("exiled"));
  expect(exiles.length).toBeGreaterThan(0);
  expect(exiles.every((t) => t!.subject.fromZone === "battlefield" && t!.subject.self === true)).toBe(true);
  expect(triggers.some((t) => t!.verbs.includes("dies") && t!.subject.self === true)).toBe(true);
});

test("a graveyard exile (Necropotence) does not feed Bontu's exile-from-the-battlefield trigger", () => {
  expect(exileTags(card("Necropotence"), bontu)).toEqual([]);
});

test("an exile of your creature that states no zone (Sword of Hearth and Home) still feeds it", () => {
  const sword = card("Sword of Hearth and Home");
  const emit = sword.tags!.abilities!.flatMap((a) => a.emits ?? []).find((e) => e.verb === "exiled" && e.subject.control === "you" && e.subject.type === "creature");
  expect(emit?.subject.fromZone).toBeUndefined();
  expect(exileTags(sword, bontu).length).toBeGreaterThan(0);
});

test.each(["Haunted House", "Kheru Lich Lord", "Cry of the Carnarium"])("%s exiles from the battlefield, so it feeds Soulherder", (name) => {
  const c = card(name, name === "Cry of the Carnarium");
  const zones = c.tags!.abilities!.flatMap((a) => a.emits ?? []).filter((e) => e.verb === "exiled").map((e) => e.subject.fromZone);
  expect(zones).toContain("battlefield");
  expect(exileTags(c, soulherder).length).toBeGreaterThan(0);
});

test.each(["Haunted House", "Kheru Lich Lord"])("%s's returned creature, exiled again, feeds Bontu", (name) => {
  expect(exileTags(card(name), bontu).length).toBeGreaterThan(0);
});

test("Séance's token copy, exiled at the next end step, is an exile from the battlefield for Soulherder", () => {
  expect(exileTags(card("Séance"), soulherder).length).toBeGreaterThan(0);
  expect(exileTags(card("Séance", true), soulherder).length).toBeGreaterThan(0);
  expect(exileTags(card("Mordor on the March", true), soulherder).length).toBeGreaterThan(0);
});
