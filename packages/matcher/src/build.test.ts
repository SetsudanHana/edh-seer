import { expect, test } from "vitest";
import { detectBuildCategories, computeBuild, rolesByCard, doubleDutyRating, DOUBLE_DUTY_MULT } from "./build.js";
import type { DeckCard } from "./types.js";
import type { CardTags } from "@mtg/tagger";

/** Minimal DeckCard: oracleText + typeLine drive the heuristics; abilities drive ramp/draw. */
const mk = (
  name: string,
  oracleText: string,
  typeLine = "Creature",
  abilities: CardTags["abilities"] = [],
): DeckCard => ({
  card: { name, typeLine, oracleText, keywords: [], colors: [], manaValue: 0 } as never,
  tags: {
    oracleId: name, schemaVersion: 1, promptVersion: 1, model: "t",
    characteristics: { types: [typeLine.toLowerCase()], subtypes: [], colors: [], identity: [], cmc: 0, power: null, toughness: null, token: false, keywords: [] },
    abilities,
  },
});

const rampAbility: CardTags["abilities"] = [{ kind: "static", effect: { kind: "mana-generation" } }];
const drawAbility: CardTags["abilities"] = [{ kind: "triggered", trigger: { verbs: ["enters"], subject: { type: "creature", control: "you", token: null } }, effect: { kind: "draw-card" } }];

test("ramp/draw come from structured effect kinds; lands from typeline", () => {
  const m = detectBuildCategories([
    mk("Sol Ring", "Add {C}{C}.", "Artifact", rampAbility),
    mk("Divination", "Draw two cards.", "Sorcery", drawAbility),
    mk("Forest", "", "Basic Land — Forest"),
  ]);
  expect(m.get("ramp")).toEqual(new Set(["Sol Ring"]));
  expect(m.get("draw")).toEqual(new Set(["Divination"]));
  expect(m.get("lands")).toEqual(new Set(["Forest"]));
});

test("targeted removal is detected from oracle text (Swords/Counterspell gap)", () => {
  const m = detectBuildCategories([
    mk("Swords to Plowshares", "Exile target creature. Its controller gains life equal to its power.", "Instant"),
    mk("Counterspell", "Counter target spell.", "Instant"),
    mk("Beast Within", "Destroy target permanent. Its controller creates a 3/3 green Beast creature token.", "Instant"),
  ]);
  expect(m.get("targetedRemoval")).toEqual(new Set(["Swords to Plowshares", "Counterspell", "Beast Within"]));
});

test("board wipe is distinguished from targeted removal (wipe wins, not double-counted)", () => {
  const m = detectBuildCategories([
    mk("Wrath of God", "Destroy all creatures. They can't be regenerated.", "Sorcery"),
  ]);
  expect(m.get("boardWipe")).toEqual(new Set(["Wrath of God"]));
  expect(m.get("targetedRemoval")?.has("Wrath of God")).toBeFalsy();
});

test("protection is detected; a land-fetch is ramp not a tutor", () => {
  const m = detectBuildCategories([
    mk("Heroic Intervention", "Permanents you control gain hexproof and indestructible until end of turn.", "Instant"),
    mk("Rampant Growth", "Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.", "Sorcery"),
    mk("Demonic Tutor", "Search your library for a card, put that card into your hand, then shuffle.", "Sorcery"),
  ]);
  expect(m.get("protection")).toEqual(new Set(["Heroic Intervention"]));
  expect(m.get("tutor")).toEqual(new Set(["Demonic Tutor"]));
  expect(m.get("tutor")?.has("Rampant Growth")).toBeFalsy();
});

// 10 ramp + 10 draw + 10 removal + 3 wipes + 36 lands = a "complete" goodstuff shell.
const completeShell = (): DeckCard[] => {
  const cards: DeckCard[] = [];
  for (let i = 0; i < 10; i++) cards.push(mk(`Rock ${i}`, "Add {C}.", "Artifact", rampAbility));
  for (let i = 0; i < 10; i++) cards.push(mk(`Draw ${i}`, "Draw a card.", "Sorcery", drawAbility));
  for (let i = 0; i < 10; i++) cards.push(mk(`Kill ${i}`, "Destroy target creature.", "Instant"));
  for (let i = 0; i < 3; i++) cards.push(mk(`Wipe ${i}`, "Destroy all creatures.", "Sorcery"));
  for (let i = 0; i < 36; i++) cards.push(mk(`Land ${i}`, "", "Basic Land — Forest"));
  return cards;
};

test("a complete goodstuff shell scores near 5", () => {
  const { buildScore } = computeBuild(completeShell(), "goodstuff");
  expect(buildScore).toBeGreaterThan(4.5);
});

test("an empty pile scores near 0 and suggests the big gaps", () => {
  const { buildScore, suggestions } = computeBuild([mk("Lonely", "Vanilla.", "Creature")], "goodstuff");
  expect(buildScore).toBeLessThan(1);
  expect(suggestions.length).toBeGreaterThan(0);
  expect(suggestions.some((s) => /Ramp 0\/10/.test(s))).toBe(true);
});

test("archetype deltas shift targets: Voltron wants fewer wipes, more protection", () => {
  const cards = [mk("Shield", "Permanents you control gain indestructible.", "Instant")];
  const voltron = computeBuild(cards, "voltron").buildCategories;
  const goodstuff = computeBuild(cards, "goodstuff").buildCategories;
  const t = (c: { category: string; target: number }[], k: string) => c.find((x) => x.category === k)!.target;
  expect(t(voltron, "boardWipe")).toBeLessThan(t(goodstuff, "boardWipe"));
  expect(t(voltron, "protection")).toBeGreaterThan(t(goodstuff, "protection"));
});

test("a zero-target category is neutral: it neither scores nor appears as a gap", () => {
  // goodstuff protection/tutor targets are 0 → a deck with none of them isn't penalized for it.
  const { suggestions } = computeBuild(completeShell(), "goodstuff");
  expect(suggestions.some((s) => /Protection|Tutor/i.test(s))).toBe(false);
});

test("land count is two-sided: heavy flood is flagged, not rewarded", () => {
  const flood = completeShell().concat(Array.from({ length: 12 }, (_, i) => mk(`Extra Land ${i}`, "", "Land")));
  const { suggestions } = computeBuild(flood, "goodstuff"); // 48 lands
  expect(suggestions.some((s) => /Lands 48/.test(s))).toBe(true);
});

test("lands counts copies, not distinct names (basics don't collapse to 1)", () => {
  const deck = Array.from({ length: 24 }, () => mk("Swamp", "", "Basic Land — Swamp"))
    .concat([mk("Sol Ring", "Add {C}{C}.", "Artifact", rampAbility)]);
  const { buildCategories, suggestions } = computeBuild(deck, "goodstuff");
  const lands = buildCategories.find((c) => c.category === "lands")!;
  expect(lands.count).toBe(24);
  expect(suggestions.some((s) => /Lands 1 —/.test(s))).toBe(false);
});

test("rolesByCard inverts category membership into per-card role lists", () => {
  const members = new Map<import("./build.js").BuildCategory, Set<string>>([
    ["ramp", new Set(["Sol Ring", "Llanowar Elves"])],
    ["draw", new Set(["Sol Ring"])], // a card in two categories
  ]);
  const roles = rolesByCard(members);
  expect(new Set(roles.get("Sol Ring"))).toEqual(new Set(["ramp", "draw"]));
  expect(roles.get("Llanowar Elves")).toEqual(["ramp"]);
  expect(roles.get("Nonexistent")).toBeUndefined();
});

test("doubleDutyRating applies a bounded premium capped at 5", () => {
  expect(doubleDutyRating(3)).toBeCloseTo(3 * DOUBLE_DUTY_MULT);
  expect(doubleDutyRating(4.5)).toBe(5); // capped, never dwarfs the scale
  expect(doubleDutyRating(0)).toBe(0);
});
