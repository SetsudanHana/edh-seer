import { expect, test } from "vitest";
import type { Reason } from "@edh-seer/engine";
import type { Ability, CardTags } from "@edh-seer/tagger";
import type { DeckCard } from "./types.js";
import { magnitudeOf, mergeMagnitude, routeMagnitude, scalesNoun } from "./edge-magnitude.js";

const card = (name: string, abilities: Partial<Ability>[], over: Partial<CardTags["characteristics"]> = {}): DeckCard => ({
  card: { name, typeLine: "", oracleText: "", keywords: [], colors: [], manaValue: 0 },
  tags: { oracleId: name, schemaVersion: 1, promptVersion: 0, model: "derived", abilities,
    characteristics: { types: [], subtypes: [], supertypes: [], keywords: [], colors: [], manaValue: 0, token: false, ...over } },
} as unknown as DeckCard);
const reason = (tag: string, over: Partial<Reason> = {}): Reason => ({ tag, text: "", producer: "P", consumer: "C", ...over } as Reason);

test("a relation family carries no magnitude", () => {
  expect(magnitudeOf(reason("static:pump"), card("P", []), card("C", []))).toBeUndefined();
  expect(magnitudeOf(reason("tutor:creature"), card("P", []), card("C", []))).toBeUndefined();
});

test("an implied event is the 1–1 default and is omitted; a flash card's own entry is instant", () => {
  const c = card("C", [{ kind: "triggered", effect: { kind: "damage" } }]);
  expect(magnitudeOf(reason("enters:creature", { consumerAbility: 0 }), card("P", []), c)).toBeUndefined();
  expect(magnitudeOf(reason("enters:creature", { consumerAbility: 0 }), card("P", [], { keywords: ["Flash"] }), c))
    .toEqual({ floor: 1, ceiling: 1, instant: true });
  // A derived side-event of a flash card (its death, a graveyard fill) has no timing of its own.
  expect(magnitudeOf(reason("dies:creature", { consumerAbility: 0 }), card("P", [], { keywords: ["Flash"] }), c)).toBeUndefined();
});

test("a counter relation pointing at no ability is not an event count (counter presence / cost channels)", () => {
  expect(magnitudeOf(reason("counter-added:creature"), card("P", [], { keywords: ["Flash"] }), card("C", []))).toBeUndefined();
});

test("an authored count is carried, with instant speed from the emit", () => {
  const p = card("P", [{ kind: "on-cast", effect: { kind: "token-generation" }, count: { floor: 0, ceiling: null, scalesWith: "mana" },
    emits: [{ verb: "enters", subject: { control: "you", token: true }, instantSpeed: true }] }]);
  expect(magnitudeOf(reason("enters:creature", { producerAbility: 0 }), p, card("C", [])))
    .toEqual({ floor: 0, ceiling: null, scalesWith: "mana", instant: true });
});

test("no recorded count is 1–1 and flagged", () => {
  const p = card("P", [{ kind: "triggered", effect: { kind: "" }, emits: [{ verb: "dies", subject: { control: "you", token: null } }] }]);
  expect(magnitudeOf(reason("dies:creature", { producerAbility: 0 }), p, card("C", []))).toEqual({ floor: 1, ceiling: 1, unknown: true });
});

test("a batched consumer caps the count at one per use (Grand Crescendo -> Welcoming Vampire)", () => {
  const p = card("P", [{ kind: "on-cast", effect: { kind: "token-generation" }, count: { floor: 0, ceiling: null, scalesWith: "mana" } }]);
  const c = card("C", [{ kind: "triggered", effect: { kind: "draw-card" }, trigger: { verbs: ["enters"], subject: { control: "you", token: null }, batched: true } }]);
  expect(magnitudeOf(reason("enters:creature", { producerAbility: 0, consumerAbility: 0 }), p, c)).toEqual({ floor: 0, ceiling: 1, batched: true });
});

test("a replacement repeating the improved count reads the IMPROVED ability; with none it is unknown", () => {
  const rep = card("R", [{ kind: "triggered", replacement: true, effect: { kind: "mill" }, count: { floor: 1, ceiling: 1, sameAsImproved: true } }]);
  const improved = card("C", [{ kind: "activated", effect: { kind: "mill" }, count: { floor: 3, ceiling: 3 } }]);
  expect(magnitudeOf(reason("mill:any", { producerAbility: 0, consumerAbility: 0 }), rep, improved)).toEqual({ floor: 3, ceiling: 3 });
  const bare = card("C", [{ kind: "activated", effect: { kind: "mill" } }]);
  expect(magnitudeOf(reason("mill:any", { producerAbility: 0, consumerAbility: 0 }), rep, bare)).toEqual({ floor: 1, ceiling: 1, unknown: true });
});

test("the ability index reads the node it is given (a face node's own list)", () => {
  // A back-face node whose tags were filtered to that face: index 0 is the face's first ability.
  const face = card("Back", [{ kind: "activated", effect: { kind: "token-generation" }, count: { floor: 2, ceiling: 2 } }]);
  expect(magnitudeOf(reason("enters:creature", { producerAbility: 0 }), face, card("C", []))).toEqual({ floor: 2, ceiling: 2 });
});

test("merge keeps the larger ceiling (unbounded wins), then the larger floor, and instant from either", () => {
  expect(mergeMagnitude({ floor: 2, ceiling: 2 }, { floor: 0, ceiling: null, scalesWith: "mana" })).toEqual({ floor: 0, ceiling: null, scalesWith: "mana" });
  expect(mergeMagnitude({ floor: 1, ceiling: 3 }, { floor: 2, ceiling: 3, instant: true })).toEqual({ floor: 2, ceiling: 3, instant: true });
  expect(mergeMagnitude(undefined, { floor: 2, ceiling: 2 })).toEqual({ floor: 2, ceiling: 2 });
  expect(mergeMagnitude(undefined, undefined)).toBeUndefined();
});

test("a route multiplies its hops; unbounded absorbs; a batched hop caps at one", () => {
  expect(routeMagnitude([{ floor: 2, ceiling: 2 }, undefined])).toEqual({ floor: 2, ceiling: 2 });
  expect(routeMagnitude([{ floor: 0, ceiling: null, scalesWith: "mana" }, undefined])).toEqual({ floor: 0, ceiling: null, scalesWith: "mana" });
  expect(routeMagnitude([{ floor: 2, ceiling: 2 }, { floor: 1, ceiling: 1, batched: true }])).toEqual({ floor: 1, ceiling: 1, batched: true });
  expect(routeMagnitude([undefined, undefined])).toBeUndefined();
});

test("scalesNoun names the class with its controller", () => {
  expect(scalesNoun("mana")).toBe("mana");
  expect(scalesNoun({ type: "land", control: "you", token: null })).toBe("land you control");
  expect(scalesNoun({ type: "creature", control: "any", token: null })).toBe("creature");
});
