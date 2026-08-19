import { expect, test } from "vitest";
import { computeThemeStats, UNIFORM_STATS } from "./theme-stats.js";
import type { CardTags } from "@mtg/tagger";

const doc = (abilities: CardTags["abilities"]): CardTags => ({
  oracleId: "x", schemaVersion: 1, promptVersion: 1, model: "t",
  characteristics: { types: ["creature"], subtypes: [], colors: [], identity: [], cmc: 0, power: null, toughness: null, token: false, keywords: [] },
  abilities,
});
const drawAbility: CardTags["abilities"] = [{ kind: "triggered", trigger: { verbs: ["enters"], subject: { type: "creature", control: "you", token: null } }, effect: { kind: "draw-card" } }];
const tokenAbility: CardTags["abilities"] = [{ kind: "triggered", trigger: { verbs: ["dies"], subject: { type: "creature", control: "you", token: null } }, effect: { kind: "token-generation", subject: { subtype: "saproling", control: "you", token: true } }, emits: [{ verb: "enters", subject: { subtype: "saproling", control: "you", token: true } }] }];

test("computeThemeStats counts document frequency per theme tag and total N", () => {
  const stats = computeThemeStats([doc(drawAbility), doc(drawAbility), doc(tokenAbility)]);
  expect(stats.N).toBe(3);
  // 'enters:creature' is on the two draw docs (their trigger subject) AND on all three by IMPLIED
  // ENTRY -- every one of these fixtures is a creature, and a permanent's own entry is a theme tag
  // of its card type since roadmap A4. Three, not two.
  expect(stats.counts["enters:creature"]).toBe(3);
  // the token doc's distinctive emit is rarer.
  expect(stats.counts["enters:saproling"]).toBe(1);
});

test("UNIFORM_STATS is the empty fallback", () => {
  expect(UNIFORM_STATS).toEqual({ N: 1, counts: {} });
});
