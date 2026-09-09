import { expect, test } from "vitest";
import { concordance, narrowestWidth, productEdgeWeight, rateOf, reachOf, specificityOf, widthOf } from "./magnitude-core.js";
import type { CardTags } from "@edh-seer/tagger";

const tags = (abilities: CardTags["abilities"]): CardTags => ({
  oracleId: "x", schemaVersion: 1, promptVersion: 1, model: "t",
  characteristics: { types: ["creature"], subtypes: [], colors: [], identity: [], cmc: 0, power: null, toughness: null, token: false, keywords: [] },
  abilities,
} as unknown as CardTags);

test("a demand's width is read off the tag's class", () => {
  expect(widthOf("enters:goblin")).toBe("narrow");
  expect(widthOf("dies:artifact")).toBe("type");
  expect(widthOf("enters:creature")).toBe("wide");
  expect(widthOf("static:pump")).toBeUndefined();
  expect(narrowestWidth(["enters:creature", "enters:goblin", "static:pump"])).toBe("narrow");
  expect(narrowestWidth(["static:pump"])).toBeUndefined();
});

test("specificity floors a whole-deck class and rewards a subtype", () => {
  expect(specificityOf("enters:any")).toBe(0.05);
  expect(specificityOf("enters:creature")).toBe(0.44);
  expect(specificityOf("dies:artifact")).toBe(0.89);
  expect(specificityOf("enters:goblin")).toBe(0.98);
});

test("rate reads the producer's repeats and amount; an implied event is once", () => {
  const engine = tags([{ kind: "triggered", repeats: "per-cycle", amount: "2", effect: { kind: "token-generation" }, emits: [{ verb: "create-token", subject: { control: "you", token: true } }] }] as never);
  expect(rateOf(engine, "create-token:goblin")).toBe(8);
  expect(rateOf(engine, "enters:creature")).toBe(1); // no authored enters: the card's own entry, once
  expect(rateOf(null, "enters:creature")).toBe(1);
});

test("reach reads the consumer's effect scope; a static consumer reaches 1", () => {
  const each = tags([{ kind: "triggered", trigger: { verbs: ["enters"], subject: { control: "you", token: null, type: "creature" } }, effect: { kind: "damage", subject: { control: "opp", token: null, scope: "each" } } }] as never);
  expect(reachOf(each, "enters:creature")).toBe(3);
  const draw = tags([{ kind: "triggered", trigger: { verbs: ["enters"], subject: { control: "you", token: null } }, amount: "2", effect: { kind: "draw-card" } }] as never);
  expect(reachOf(draw, "enters:creature")).toBe(2);
  expect(reachOf(tags([]), "enters:creature")).toBe(1);
});

test("the product tells an engine from a body where today's weight cannot", () => {
  const consumer = tags([{ kind: "triggered", trigger: { verbs: ["enters"], subject: { control: "you", token: null, type: "creature" } }, effect: { kind: "damage", subject: { control: "opp", token: null, scope: "each" } } }] as never);
  const body = tags([]);
  const engine = tags([{ kind: "triggered", repeats: "per-cycle", effect: { kind: "token-generation" }, emits: [{ verb: "enters", subject: { control: "you", token: true, type: "creature" } }] }] as never);
  const reason = { tag: "enters:creature", text: "", effectKind: "damage", producer: "P", consumer: "C" };
  const ctx = (producer: CardTags) => ({ kinds: { damage: 0.2 }, producer, consumer, axis: new Map([["enters:creature", 1]]) });
  const wBody = productEdgeWeight([reason], ctx(body));
  const wEngine = productEdgeWeight([reason], ctx(engine));
  expect(wEngine / wBody).toBe(4);
  expect(wBody).toBeCloseTo(0.2 * 1 * 3 * 0.44 * 2.5, 6);
});

test("concordance counts the owner's ordered pairs an engine ordering agrees with", () => {
  expect(concordance([1, 2, 3], [9, 5, 1])).toEqual({ agree: 3, pairs: 3 });
  expect(concordance([1, 2, 3], [1, 5, 9])).toEqual({ agree: 0, pairs: 3 });
  expect(concordance([1, 1, 2], [5, 5, 1])).toEqual({ agree: 2, pairs: 2 }); // owner tie skipped
  expect(concordance([1, 2, 3], [5, 5, 1])).toEqual({ agree: 2.5, pairs: 3 }); // engine tie = half
});
