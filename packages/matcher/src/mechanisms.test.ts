import { expect, test } from "vitest";
import type { Reason } from "@mtg/engine";
import { EFFECT_KINDS, VERB_VOCAB } from "@mtg/tagger";
import { CATEGORY_MATCH, MECHANISM_CATEGORIES, MECHANISM_LABELS, categoryDefines, categoryMatches, groupEdgesByArchetype, type MechanismCategory } from "./mechanisms.js";

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

// AN EDGE STILL JOINS EVERY CATEGORY IT MATCHES — what changed is that a group saying nothing the
// bigger one has not already said is dropped before it reaches the reader. With a single edge the
// two groups are the SAME pair under two headings, which is the duplication the dedupe exists for.
test("groupEdgesByArchetype: a group that is a near-duplicate of a bigger one is dropped", () => {
  const edges = [{ a: "A", b: "B", reasons: [reason({ tag: "create-token:any" }), reason({ effectKind: "forced-sacrifice" })] }];
  const groups = groupEdgesByArchetype(edges);
  expect(groups).toHaveLength(1);
  expect(["aristocrats", "tokens-go-wide"]).toContain(groups[0].category);
});

test("groupEdgesByArchetype: a category with pairs of its own survives beside a bigger group", () => {
  const edges = [
    { a: "A", b: "B", reasons: [reason({ effectKind: "drain" })] },
    { a: "C", b: "D", reasons: [reason({ effectKind: "drain" })] },
    { a: "E", b: "F", reasons: [reason({ effectKind: "drain" })] },
    // Two pairs the aristocrats group never sees: 2 of 3 shared is under the 0.9 bar.
    { a: "G", b: "H", reasons: [reason({ tag: "create-token:any" })] },
    { a: "I", b: "J", reasons: [reason({ tag: "create-token:any" })] },
    { a: "A", b: "B", reasons: [reason({ tag: "create-token:any" }), reason({ effectKind: "drain" })] },
  ];
  const categories = groupEdgesByArchetype(edges).map((g) => g.category).sort();
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

// SORTED BY PAIRS, NOT CARDS. Card count is what a group reaches; pairs are what it claims, and on
// a real deck four groups read "70 cards" while their pair counts ran 334 to 440.
test("groupEdgesByArchetype: groups sort by pair count descending", () => {
  const edges = [
    { a: "A", b: "B", reasons: [reason({ effectKind: "drain" })] },
    { a: "C", b: "D", reasons: [reason({ tag: "create-token:any" })] },
    { a: "E", b: "F", reasons: [reason({ tag: "create-token:any" })] },
    { a: "G", b: "H", reasons: [reason({ tag: "create-token:any" })] },
  ];
  const groups = groupEdgesByArchetype(edges);
  expect(groups[0].category).toBe("tokens-go-wide");
  expect(groups[0].pairs).toHaveLength(3);
  expect(groups[1].category).toBe("aristocrats");
});

test("every MechanismCategory has a MECHANISM_LABELS entry", () => {
  for (const c of MECHANISM_CATEGORIES) {
    expect(typeof MECHANISM_LABELS[c as MechanismCategory]).toBe("string");
    expect(MECHANISM_LABELS[c as MechanismCategory].length).toBeGreaterThan(0);
  }
});

test("a fetchland's top-manipulation reason is not a Graveyard Matters claim", () => {
  // ROADMAP G3, and the guard is against a RE-ADD: `top-manipulation` covers search, scry, surveil
  // and mill together, so with it in the table every tutor and every fetchland was a graveyard
  // card -- 7,301 pairs over 70 of the 71 calibration decks, against 4,095 over 63 without it, and
  // a Walls deck led its report with "Graveyard Matters". Mill is the one member with a real
  // graveyard claim and the kind cannot separate it from a fetchland.
  expect(categoryMatches(reason({ effectKind: "top-manipulation" }), "graveyard-matters")).toBe(false);
  expect(categoryMatches(reason({ effectKind: "graveyard-recursion" }), "graveyard-matters")).toBe(true);
});

// J3 (2026-08-25): `pump` IS TOO BROAD TO CARRY VOLTRON, and `counter-placement` is not. The group
// covered 27 of 71 decks and 2,780 pairs on decks that are plainly not voltron; dropping `pump`
// alone takes it to 4 decks and 76 pairs, so that one kind carried 2,704 of them.
test("an anthem does not join voltron, and a constellation counter still does", () => {
  const reason = (tag: string, effectKind?: string): Reason =>
    ({ tag, text: "", repeatability: "static", ...(effectKind ? { effectKind } : {}) } as Reason);

  // THE DEFINING HALF IS UNTOUCHED — an Equipment or an Aura entering really is the signal.
  expect(categoryDefines(reason("enters:equipment"), "voltron-auras")).toBe(true);
  expect(categoryDefines(reason("enters:aura"), "voltron-auras")).toBe(true);

  // A bare anthem is `static:pump` on any creature in any deck, and it used to join.
  expect(categoryMatches(reason("static:pump", "pump"), "voltron-auras")).toBe(false);

  // The four gold pairs the compass holds: All That Glitters and friends reach Setessan Champion on
  // `enters:enchantment` + `counter-placement`. Dropping this kind too was measured and cost all
  // four — the ratchet said so rather than any argument.
  expect(categoryMatches(reason("enters:enchantment", "counter-placement"), "voltron-auras")).toBe(true);
  // …but a supporting kind alone never DEFINES the group, which is what stops one Equipment holding
  // a category up for a whole deck.
  expect(categoryDefines(reason("enters:enchantment", "counter-placement"), "voltron-auras")).toBe(false);
});
