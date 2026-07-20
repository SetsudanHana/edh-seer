import { expect, test } from "vitest";
import { deckSubtypeCounts, resolveChosenTypes } from "./chosen-type.js";
import type { CardTags } from "@mtg/tagger";
import type { Hierarchy } from "./types.js";

const chars = (subtypes: string[]) => ({
  types: ["creature"], subtypes, colors: [], identity: [], cmc: 1,
  power: null, toughness: null, token: false, keywords: [],
});
const tagsWith = (subtypes: string[], abilities: CardTags["abilities"] = []): CardTags => ({
  oracleId: "x", schemaVersion: 1, promptVersion: 1, model: "t",
  characteristics: chars(subtypes), abilities,
});

const NO_HIERARCHY: Hierarchy = {};

test("deckSubtypeCounts tallies subtypes across all deck cards", () => {
  const counts = deckSubtypeCounts([
    { card: {} as never, tags: tagsWith(["wizard"]) },
    { card: {} as never, tags: tagsWith(["wizard", "human"]) },
    { card: {} as never, tags: null },
  ]);
  expect(counts.get("wizard")).toBe(2);
  expect(counts.get("human")).toBe(1);
});

test("resolveChosenTypes substitutes the deck's top subtype and drops chosenType (no type constraint)", () => {
  const tags = tagsWith([], [
    {
      kind: "triggered",
      trigger: { verbs: ["enters"], subject: { control: "you", token: null, chosenType: true } },
      effect: { kind: "draw-card" },
    },
  ]);
  const counts = new Map([["wizard", 5], ["human", 2]]);
  const resolved = resolveChosenTypes(tags, counts, NO_HIERARCHY);
  const subj = resolved.abilities[0].trigger!.subject;
  expect(subj.subtype).toBe("wizard");
  expect(subj.chosenType).toBeUndefined();
});

test("unresolvable chosenType (no deck subtypes) yields a subtype that matches nothing", () => {
  const tags = tagsWith([], [
    { kind: "static", effect: { kind: "pump", subject: { control: "you", token: null, chosenType: true } } },
  ]);
  const resolved = resolveChosenTypes(tags, new Map(), NO_HIERARCHY);
  expect(resolved.abilities[0].effect.subject!.subtype).toBe("__none__");
  expect(resolved.abilities[0].effect.subject!.chosenType).toBeUndefined();
});

test("chosenType with a type constraint picks the top subtype among legal types, not the global top", () => {
  const hierarchy: Hierarchy = { wizard: ["creature"], zombie: ["creature"], treasure: ["artifact"] };
  const tags = tagsWith([], [
    {
      kind: "triggered",
      trigger: { verbs: ["enters"], subject: { type: "creature", control: "you", token: null, chosenType: true } },
      effect: { kind: "draw-card" },
    },
  ]);
  // treasure is the global top by far, but it's not a creature subtype.
  const counts = new Map([["treasure", 10], ["wizard", 3], ["zombie", 1]]);
  const resolved = resolveChosenTypes(tags, counts, hierarchy);
  const subj = resolved.abilities[0].trigger!.subject;
  expect(subj.subtype).toBe("wizard");
  expect(subj.chosenType).toBeUndefined();
});

test("chosenType with a type constraint and no legal candidate resolves to the match-nothing sentinel", () => {
  const hierarchy: Hierarchy = { treasure: ["artifact"] };
  const tags = tagsWith([], [
    {
      kind: "triggered",
      trigger: { verbs: ["enters"], subject: { type: "creature", control: "you", token: null, chosenType: true } },
      effect: { kind: "draw-card" },
    },
  ]);
  // Deck has plenty of subtypes, but none of them imply "creature".
  const counts = new Map([["treasure", 10]]);
  const resolved = resolveChosenTypes(tags, counts, hierarchy);
  const subj = resolved.abilities[0].trigger!.subject;
  expect(subj.subtype).toBe("__none__");
  expect(subj.chosenType).toBeUndefined();
});

test("chosenType with an OR type constraint (string[]) considers subtypes legal for any listed type", () => {
  const hierarchy: Hierarchy = { wizard: ["creature"], treasure: ["artifact"] };
  const tags = tagsWith([], [
    {
      kind: "static",
      effect: {
        kind: "pump",
        subject: { type: ["artifact", "creature"], control: "you", token: null, chosenType: true },
      },
    },
  ]);
  const counts = new Map([["treasure", 2], ["wizard", 1]]);
  const resolved = resolveChosenTypes(tags, counts, hierarchy);
  expect(resolved.abilities[0].effect.subject!.subtype).toBe("treasure");
});
