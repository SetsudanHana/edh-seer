import { expect, test } from "vitest";
import { deckSubtypeCounts, resolveChosenTypes } from "./chosen-type.js";
import type { CardTags } from "@mtg/tagger";

const chars = (subtypes: string[]) => ({
  types: ["creature"], subtypes, colors: [], identity: [], cmc: 1,
  power: null, toughness: null, token: false, keywords: [],
});
const tagsWith = (subtypes: string[], abilities: CardTags["abilities"] = []): CardTags => ({
  oracleId: "x", schemaVersion: 1, promptVersion: 1, model: "t",
  characteristics: chars(subtypes), abilities,
});

test("deckSubtypeCounts tallies subtypes across all deck cards", () => {
  const counts = deckSubtypeCounts([
    { card: {} as never, tags: tagsWith(["wizard"]) },
    { card: {} as never, tags: tagsWith(["wizard", "human"]) },
    { card: {} as never, tags: null },
  ]);
  expect(counts.get("wizard")).toBe(2);
  expect(counts.get("human")).toBe(1);
});

test("resolveChosenTypes substitutes the deck's top subtype and drops chosenType", () => {
  const tags = tagsWith([], [
    {
      kind: "triggered",
      trigger: { verbs: ["enters"], subject: { type: "creature", control: "you", token: null, chosenType: true } },
      effect: { kind: "draw-card" },
    },
  ]);
  const counts = new Map([["wizard", 5], ["human", 2]]);
  const resolved = resolveChosenTypes(tags, counts);
  const subj = resolved.abilities[0].trigger!.subject;
  expect(subj.subtype).toBe("wizard");
  expect(subj.chosenType).toBeUndefined();
});

test("unresolvable chosenType (no deck subtypes) yields a subtype that matches nothing", () => {
  const tags = tagsWith([], [
    { kind: "static", effect: { kind: "pump", subject: { control: "you", token: null, chosenType: true } } },
  ]);
  const resolved = resolveChosenTypes(tags, new Map());
  expect(resolved.abilities[0].effect.subject!.subtype).toBe("__none__");
  expect(resolved.abilities[0].effect.subject!.chosenType).toBeUndefined();
});
