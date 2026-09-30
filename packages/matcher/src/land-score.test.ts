import { expect, test } from "vitest";
import type { Card } from "@edh-seer/engine";
import { basicsFloor, betterLand, landFacts, neededColours } from "./land-score.js";
import type { DeckCard } from "./types.js";

const dc = (name: string, typeLine: string, oracleText: string, producedMana: string[] = [], kinds: string[] = [], manaCost?: string): DeckCard => ({
  card: { name, typeLine, oracleText, keywords: [], colors: [], manaValue: 0, producedMana, ...(manaCost ? { manaCost } : {}) } as Card,
  tags: { abilities: kinds.map((k) => ({ kind: "activated", effect: { kind: k } })) } as unknown as DeckCard["tags"],
});

const shrine = dc("Godless Shrine", "Land — Plains Swamp", "({T}: Add {W} or {B}.)\nAs Godless Shrine enters, you may pay 2 life. If you don't, it enters tapped.", ["W", "B"]);
const barrens = dc("Scoured Barrens", "Land", "Scoured Barrens enters tapped.\nWhen Scoured Barrens enters, you gain 1 life.\n{T}: Add {W} or {B}.", ["W", "B"], ["lifegain", "mana-generation"]);
const plains = dc("Plains", "Basic Land — Plains", "({T}: Add {W}.)", ["W"]);
const locthwain = dc("Castle Locthwain", "Legendary Land", "Castle Locthwain enters tapped unless you control a Swamp.\n{T}: Add {B}.\n{1}{B}{B}, {T}: Draw a card, then you lose life equal to the number of cards in your hand.", ["B"], ["mana-generation", "draw-card"]);
const temple = dc("Temple of Silence", "Land", "Temple of Silence enters tapped.\nWhen Temple of Silence enters, scry 1.\n{T}: Add {W} or {B}.", ["W", "B"], ["scry", "mana-generation"]);
const tower = dc("Command Tower", "Land", "{T}: Add one mana of any color in your commander's color identity.", ["W", "U", "B", "R", "G"], ["mana-generation"]);
const spells = [dc("Swords to Plowshares", "Instant", "", [], [], "{W}"), dc("Doom Blade", "Instant", "", [], [], "{1}{B}")];
const needed = neededColours([...spells, shrine]);

test("the needed colours are the deck's spells' pips, never a land's", () => {
  expect([...needed].sort()).toEqual(["B", "W"]);
});

test("a shock land never enters tapped; a gain land always; a check land some turns", () => {
  expect(landFacts(shrine, needed, []).tapped).toBe(0);
  expect(landFacts(barrens, needed, []).tapped).toBe(2);
  expect(landFacts(locthwain, needed, []).tapped).toBe(1);
});

test("colours count only when the deck asks for them", () => {
  expect(landFacts(tower, needed, []).colours).toEqual(["W", "B"]);
});

test("the shock land is strictly better than the gain land: the life was for entering tapped", () => {
  expect(landFacts(barrens, needed, []).utility).toEqual([]);
  expect(betterLand(landFacts(barrens, needed, []), landFacts(shrine, needed, []))).toEqual({ ok: true, untapped: true, colours: [] });
  expect(betterLand(landFacts(temple, needed, []), landFacts(shrine, needed, [])).ok).toBe(true);
});

test("a dual is strictly better than a basic on colour, and never the other way round", () => {
  expect(betterLand(landFacts(plains, needed, []), landFacts(shrine, needed, []))).toEqual({ ok: true, untapped: false, colours: ["B"] });
  expect(betterLand(landFacts(shrine, needed, []), landFacts(plains, needed, [])).ok).toBe(false);
});

test("a land that does something else is never cut for one that does not", () => {
  expect(landFacts(locthwain, needed, []).utility).toContain("draw-card");
  expect(betterLand(landFacts(locthwain, needed, []), landFacts(shrine, needed, [])).ok).toBe(false);
});

test("a tapped land is never better than an untapped one, whatever its colours", () => {
  expect(betterLand(landFacts(plains, needed, []), landFacts(barrens, needed, [])).ok).toBe(false);
});

test("the basics floor is what the deck's own cards search for", () => {
  const landscape = dc("Myriad Landscape", "Land", "Myriad Landscape enters tapped.\n{T}: Add {C}.\n{2}, {T}, Sacrifice Myriad Landscape: Search your library for up to two basic land cards that share a land type, put them onto the battlefield tapped, then shuffle.", ["C"]);
  const wilds = dc("Evolving Wilds", "Land", "{T}, Sacrifice Evolving Wilds: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.");
  expect(basicsFloor([landscape, wilds, plains, shrine])).toBe(3);
  expect(basicsFloor([shrine, plains])).toBe(0);
});
