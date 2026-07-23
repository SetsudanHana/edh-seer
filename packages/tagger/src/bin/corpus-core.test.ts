import { expect, test } from "vitest";
import { selectUntagged, renderPreamble, cardTagsFromRawAbilities } from "./corpus-core.js";
import type { CardDoc } from "@mtg/data";
import { SCHEMA_VERSION } from "../schema.js";
import { PROMPT_VERSION } from "../llm/prompt.js";

const doc = (o: Partial<CardDoc> & { _id: string }): CardDoc => ({
  name: o._id, typeLine: "Creature", oracleText: "Draw a card.", keywords: [], colors: [],
  manaValue: 1, colorIdentity: [], power: null, toughness: null,
  tags: { produces: [], cares: [] }, searchNames: [], ...o,
});

test("selectUntagged skips done ids and empty-text cards, orders by edhrecRank asc", () => {
  const cards = [
    doc({ _id: "a", edhrecRank: 100 }),
    doc({ _id: "b", edhrecRank: 5 }),
    doc({ _id: "c", edhrecRank: 5 }),           // tie with b -> _id order
    doc({ _id: "done", edhrecRank: 1 }),        // excluded: done
    doc({ _id: "empty", edhrecRank: 2, oracleText: "" }), // excluded: no text
    doc({ _id: "norank" }),                      // undefined rank -> last
  ];
  const out = selectUntagged(cards, new Set(["done"]), 10).map((c) => c._id);
  expect(out).toEqual(["b", "c", "a", "norank"]);
});

test("selectUntagged respects n", () => {
  const cards = [doc({ _id: "a", edhrecRank: 1 }), doc({ _id: "b", edhrecRank: 2 })];
  expect(selectUntagged(cards, new Set(), 1).map((c) => c._id)).toEqual(["a"]);
});

test("renderPreamble includes the system prompt and excludes the final card turn", () => {
  const p = renderPreamble(doc({ _id: "x", name: "Whatever", oracleText: "Unique-oracle-text-marker." }));
  expect(p.length).toBeGreaterThan(200);            // has the real system+few-shot content
  expect(p).not.toContain("Unique-oracle-text-marker."); // the card's own turn is dropped
});

test("cardTagsFromRawAbilities normalizes raw abilities and stamps versions + characteristics", () => {
  const card = { name: "Essence Warden", typeLine: "Creature — Elf Shaman", oracleText: "Whenever another creature enters, you gain 1 life.", keywords: [], colors: ["G"], manaValue: 1, colorIdentity: ["G"], power: "1", toughness: "1" };
  const raw = [{ kind: "triggered", trigger: { verbs: ["enters"], subject: { type: "creature", control: "you", token: null } }, effect: { kind: "lifegain", subject: { control: "you", token: null } }, emits: [{ verb: "gain-life", subject: { control: "you", token: null } }] }];
  const t = cardTagsFromRawAbilities("oid-ew", card, raw, "claude-haiku-4-5-subagent");
  expect(t.oracleId).toBe("oid-ew");
  expect(t.model).toBe("claude-haiku-4-5-subagent");
  expect(t.schemaVersion).toBe(SCHEMA_VERSION);
  expect(t.promptVersion).toBe(PROMPT_VERSION);
  expect(t.characteristics.types).toContain("creature");
  expect(t.abilities).toHaveLength(1);
  expect(t.abilities[0].effect.kind).toBe("lifegain");
});

test("cardTagsFromRawAbilities yields empty abilities for an empty raw array", () => {
  const card = { name: "Grizzly Bears", typeLine: "Creature — Bear", oracleText: "", keywords: [], colors: ["G"], manaValue: 2, colorIdentity: ["G"], power: "2", toughness: "2" };
  expect(cardTagsFromRawAbilities("oid-gb", card, [], "m").abilities).toEqual([]);
});
