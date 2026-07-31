import { expect, test } from "vitest";
import type { Reason } from "@mtg/engine";
import { EFFECT_KINDS, VERB_VOCAB } from "@mtg/tagger";
import {
  MECHANISM_CATEGORIES,
  CATEGORY_MATCH,
  categoryMatches,
  groupEdgesByArchetype,
  MECHANISM_LABELS,
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

test("groupEdgesByArchetype: an edge matching one category lands in exactly that group", () => {
  const edges = [{ a: "Blood Artist", b: "Fling", reasons: [reason({ effectKind: "forced-sacrifice" })] }];
  const groups = groupEdgesByArchetype(edges);
  expect(groups).toHaveLength(1);
  expect(groups[0].category).toBe("aristocrats");
  expect(groups[0].label).toBe("Aristocrats");
  expect(groups[0].cards).toEqual(["Blood Artist", "Fling"]);
  expect(groups[0].pairs).toEqual([{ a: "Blood Artist", b: "Fling", reasons: edges[0].reasons }]);
});

test("groupEdgesByArchetype: an edge matching two categories appears in both groups", () => {
  const edges = [{ a: "A", b: "B", reasons: [reason({ tag: "create-token:any" }), reason({ effectKind: "forced-sacrifice" })] }];
  const groups = groupEdgesByArchetype(edges);
  const categories = groups.map((g) => g.category).sort();
  expect(categories).toEqual(["aristocrats", "tokens-go-wide"]);
});

test("groupEdgesByArchetype: an edge matching no category lands in 'other', sorted last", () => {
  const bigGroup = { a: "X", b: "Y", reasons: [reason({ effectKind: "drain" })] };
  const noMatch = { a: "P", b: "Q", reasons: [reason({ tag: "enters:artifact" })] };
  const groups = groupEdgesByArchetype([bigGroup, noMatch]);
  expect(groups[groups.length - 1].category).toBe("other");
  expect(groups[groups.length - 1].label).toBe("Other synergies");
  expect(groups[groups.length - 1].cards).toEqual(["P", "Q"]);
});

test("groupEdgesByArchetype: groups sort by member card count descending", () => {
  const edges = [
    { a: "A", b: "B", reasons: [reason({ effectKind: "drain" })] },
    { a: "C", b: "D", reasons: [reason({ tag: "create-token:any" })] },
    { a: "E", b: "F", reasons: [reason({ effectKind: "drain" })] },
  ];
  const groups = groupEdgesByArchetype(edges);
  expect(groups[0].category).toBe("aristocrats");
  expect(groups[0].cards).toHaveLength(4);
});

test("every MechanismCategory has a MECHANISM_LABELS entry", () => {
  for (const c of MECHANISM_CATEGORIES) {
    expect(typeof MECHANISM_LABELS[c as MechanismCategory]).toBe("string");
    expect(MECHANISM_LABELS[c as MechanismCategory].length).toBeGreaterThan(0);
  }
});
