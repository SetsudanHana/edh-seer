import { expect, test } from "vitest";
import type { Reason } from "@mtg/engine";
import { EFFECT_KINDS, VERB_VOCAB } from "@mtg/tagger";
import {
  MECHANISM_CATEGORIES,
  CATEGORY_MATCH,
  categoryMatches,
  type MechanismCategory,
} from "./mechanisms.js";

const reason = (over: Partial<Reason>): Reason => ({ tag: "", text: "", ...over });

test("categoryMatches is true when reason.effectKind is in the category's effectKinds", () => {
  expect(categoryMatches(reason({ effectKind: "drain" }), "aristocrats")).toBe(true);
});

test("categoryMatches is true when reason.tag is in the category's tags", () => {
  expect(categoryMatches(reason({ tag: "attacks:creature" }), "attack-matters")).toBe(true);
});

test("categoryMatches is false when neither tag nor effectKind is accepted", () => {
  expect(categoryMatches(reason({ tag: "enters:artifact", effectKind: "mana-generation" }), "aristocrats"))
    .toBe(false);
});

test("every category has at least one accepted tag or effectKind", () => {
  for (const c of MECHANISM_CATEGORIES) {
    const e = CATEGORY_MATCH[c as MechanismCategory];
    expect((e.tags?.length ?? 0) + (e.effectKinds?.length ?? 0)).toBeGreaterThan(0);
  }
});

test("every effectKind referenced by CATEGORY_MATCH is a real EFFECT_KINDS member", () => {
  const kinds = new Set<string>(EFFECT_KINDS);
  for (const c of MECHANISM_CATEGORIES) {
    for (const k of CATEGORY_MATCH[c as MechanismCategory].effectKinds ?? []) {
      expect(kinds.has(k)).toBe(true);
    }
  }
});

test("every tag referenced by CATEGORY_MATCH has a valid verb prefix", () => {
  const verbs = new Set<string>(VERB_VOCAB);
  for (const c of MECHANISM_CATEGORIES) {
    for (const t of CATEGORY_MATCH[c as MechanismCategory].tags ?? []) {
      const prefix = t.split(":")[0];
      if (prefix === "static") continue; // matcher static-edge convention, not a verb
      expect(verbs.has(prefix)).toBe(true);
    }
  }
});

test("no kindred/tribal category exists (dropped per design)", () => {
  expect(MECHANISM_CATEGORIES).not.toContain("tribal");
  expect(MECHANISM_CATEGORIES).not.toContain("kindred");
});

test("mill-self accepts the enters-graveyard linking tag", () => {
  expect(categoryMatches({ tag: "enters-graveyard:creature", text: "" } as never, "mill-self")).toBe(true);
});

test("counters-plus1 accepts the proliferate linking tag", () => {
  expect(categoryMatches({ tag: "proliferate:any", text: "" } as never, "counters-plus1")).toBe(true);
});

test("categoryMatches requires hasStatPredicate for power-matters even when the tag matches", () => {
  expect(categoryMatches(reason({ tag: "enters:creature", hasStatPredicate: true }), "power-matters")).toBe(true);
  expect(categoryMatches(reason({ tag: "enters:creature", hasStatPredicate: false }), "power-matters")).toBe(false);
  expect(categoryMatches(reason({ tag: "enters:creature" }), "power-matters")).toBe(false);
});

test("categoryMatches requires hasStatPredicate for toughness-matters even when the tag matches", () => {
  expect(categoryMatches(reason({ tag: "static:damage-multiplier", hasStatPredicate: true }), "toughness-matters")).toBe(true);
  expect(categoryMatches(reason({ tag: "static:damage-multiplier" }), "toughness-matters")).toBe(false);
});

test("categoryMatches does not require hasStatPredicate for categories without the flag", () => {
  expect(categoryMatches(reason({ effectKind: "drain" }), "aristocrats")).toBe(true);
});
