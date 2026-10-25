import { expect, test } from "vitest";
import type { DeckCard } from "./types.js";
import { commanderPlayable, hasPage, isCommander, isLandPoolMember } from "./partners-core.js";

// OWNER 2026-10-25: an unreleased spoiler card is previewed -- Scryfall says not_legal everywhere
// until release, and every reader that gates on raw legality must see it as legal.
const dc = (typeLine: string, card: Record<string, unknown>): DeckCard => ({
  card: { name: "X", typeLine, oracleText: "", keywords: [], colors: [], manaValue: 3, colorIdentity: [], power: "2", toughness: "2", ...card },
  tags: null,
} as unknown as DeckCard);
const NOT_LEGAL = { legalities: { commander: "not_legal", vintage: "not_legal" }, commanderLegality: "not_legal" };

test("an upcoming legendary creature is a commander and playable", () => {
  const d = dc("Legendary Creature — Human", { ...NOT_LEGAL, upcoming: "2026-11-13", commanderLegality: "legal" });
  expect(isCommander(d)).toBe(true);
  expect(commanderPlayable(d)).toBe(true);
});

test("a not_legal card that is not upcoming is neither", () => {
  const d = dc("Legendary Creature — Human", NOT_LEGAL);
  expect(isCommander(d)).toBe(false);
  expect(commanderPlayable(d)).toBe(false);
});

test("an ordinary legal legendary creature is still a commander", () => {
  expect(isCommander(dc("Legendary Creature — Human", { legalities: { commander: "legal" }, commanderLegality: "legal" }))).toBe(true);
});

test("an upcoming card gets a page; an all-not_legal card does not", () => {
  expect(hasPage({ legalities: { commander: "not_legal", modern: "not_legal" }, upcoming: "2026-11-13" })).toBe(true);
  expect(hasPage({ legalities: { commander: "not_legal", modern: "not_legal" } })).toBe(false);
  expect(hasPage({ legalities: { commander: "banned", modern: "not_legal" } })).toBe(true);
  expect(hasPage({})).toBe(true);
});

test("the land pool takes an upcoming land, not a not_legal or banned one", () => {
  const land = (extra: Record<string, unknown>) => ({ typeLine: "Land", ...extra });
  expect(isLandPoolMember(land({ legalities: { commander: "not_legal" }, upcoming: "2026-11-13" }))).toBe(true);
  expect(isLandPoolMember(land({ legalities: { commander: "not_legal" } }))).toBe(false);
  expect(isLandPoolMember(land({ legalities: { commander: "banned" } }))).toBe(false);
  expect(isLandPoolMember(land({ legalities: { commander: "legal" } }))).toBe(true);
  expect(isLandPoolMember({ typeLine: "Creature — Elf", legalities: { commander: "legal" } })).toBe(false);
});
