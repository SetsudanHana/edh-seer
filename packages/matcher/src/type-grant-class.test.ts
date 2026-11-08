import { expect, test } from "vitest";
import { deriveCardTags, deriveInputOf } from "@edh-seer/tagger";
import type { CardTags, ClauseRecord } from "@edh-seer/tagger";
import { loadHierarchy, pairReasons } from "./index.js";
import type { DeckCard } from "./types.js";
import fixtures from "./fixtures/type-grant-class.json" with { type: "json" };

/** #1568, owner ruling 2026-11-08: a type grant over a WHOLE NON-CREATURE class ("artifacts you control are Foods / Clues / Equipment in addition to their other types") pairs with the cards that USE the granted
 *  type, not with every artifact that merely receives it. Creature classes (Maskwood Nexus) stay literal. Stored documents and clauses dumped from Mongo 2026-11-08. */
const F = fixtures as unknown as Record<string, { source: Record<string, unknown> & { _id: string }; canonical: ClauseRecord[] }>;
const dc = (name: string): DeckCard => ({
  card: F[name]!.source as unknown as DeckCard["card"],
  tags: deriveCardTags(deriveInputOf(F[name]!.source as never, name, name, F[name]!.canonical)) as CardTags,
});
const grant = (p: string, c: string) => pairReasons(dc(p), dc(c), loadHierarchy()).filter((r) => r.tag === "static:type-grant" && r.producer === p && r.consumer === c);

test("the granted type is stamped on the type-grant: food, clue, equipment", () => {
  for (const [n, t] of [["Gourmand's Talent", "food"], ["Ragost, Deft Gastronaut", "food"], ["Senator Peacock", "clue"], ["Dan Lewis", "equipment"]] as const) {
    expect(dc(n).tags!.abilities.find((a) => a.effect.kind === "type-grant")?.grantsType, n).toBe(t);
  }
});

test("Gourmand's Talent pairs with no artifact that merely receives Food: not Sol Ring", () => {
  expect(grant("Gourmand's Talent", "Sol Ring")).toEqual([]);
  expect(grant("Senator Peacock", "Sol Ring")).toEqual([]);
  expect(grant("Dan Lewis", "Sol Ring")).toEqual([]);
});

test("Gourmand's Talent and Ragost pair with a card that uses Food", () => {
  for (const c of ["Peregrin Took", "Gilded Goose"]) {
    expect(grant("Gourmand's Talent", c), c).not.toEqual([]);
    expect(grant("Ragost, Deft Gastronaut", c), c).not.toEqual([]);
  }
  // ...and not with a card that uses Clues only
  expect(grant("Gourmand's Talent", "Tireless Tracker")).toEqual([]);
});

test("Senator Peacock pairs with a Clue payoff, Dan Lewis with an Equipment payoff", () => {
  expect(grant("Senator Peacock", "Tireless Tracker")).not.toEqual([]);
  expect(grant("Dan Lewis", "Stoneforge Mystic")).not.toEqual([]);
  expect(grant("Senator Peacock", "Peregrin Took")).toEqual([]);
});

test("a creature class stays literal: Maskwood Nexus still pairs with Grizzly Bears", () => {
  expect(grant("Maskwood Nexus", "Grizzly Bears")).not.toEqual([]);
});
