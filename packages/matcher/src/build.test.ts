import { expect, test } from "vitest";
import { detectBuildCategories } from "./build.js";
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
