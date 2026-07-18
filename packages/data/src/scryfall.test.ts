import { expect, test } from "vitest";
import { normalizeScryfallCard } from "./scryfall.js";

test("normalizes a standard card", () => {
  const n = normalizeScryfallCard({
    oracle_id: "abc",
    name: "Krenko, Mob Boss",
    type_line: "Legendary Creature — Goblin Warrior",
    oracle_text: "Tap: Create tokens.",
    keywords: [],
    colors: ["R"],
    cmc: 4,
  });
  expect(n).not.toBeNull();
  expect(n!.oracleId).toBe("abc");
  expect(n!.card.name).toBe("Krenko, Mob Boss");
  expect(n!.card.manaValue).toBe(4);
  expect(n!.faceNames).toEqual([]);
});

test("joins DFC faces and merges face colors when top-level fields are absent", () => {
  const n = normalizeScryfallCard({
    oracle_id: "dfc",
    name: "Front // Back",
    type_line: "Creature — Werewolf // Creature — Werewolf",
    keywords: [],
    card_faces: [
      { oracle_text: "Front text", colors: ["R"] },
      { oracle_text: "Back text", colors: ["G"] },
    ],
  });
  expect(n!.card.oracleText).toBe("Front text\n//\nBack text");
  expect(n!.card.colors.sort()).toEqual(["G", "R"]);
  expect(n!.faceNames).toEqual(["Front", "Back"]);
});

test("treats empty oracle text as valid empty string", () => {
  const n = normalizeScryfallCard({
    oracle_id: "vanilla",
    name: "Grizzly Bears",
    type_line: "Creature — Bear",
    colors: ["G"],
    cmc: 2,
  });
  expect(n!.card.oracleText).toBe("");
});

test("skips records missing required fields", () => {
  expect(normalizeScryfallCard({ name: "No id or type" })).toBeNull();
  expect(normalizeScryfallCard({ oracle_id: "x", type_line: "y" })).toBeNull();
});

test("normalize captures color identity, power, toughness", () => {
  const n = normalizeScryfallCard({
    oracle_id: "abc",
    name: "Inalla, Archmage Ritualist",
    type_line: "Legendary Creature — Human Wizard",
    oracle_text: "…",
    colors: ["U", "B", "R"],
    color_identity: ["B", "R", "U"],
    power: "4",
    toughness: "5",
    cmc: 5,
  });
  expect(n).not.toBeNull();
  expect(n!.card.colorIdentity).toEqual(["B", "R", "U"]);
  expect(n!.card.power).toBe("4");
  expect(n!.card.toughness).toBe("5");
});

test("normalize leaves power/toughness null for non-creatures", () => {
  const n = normalizeScryfallCard({
    oracle_id: "def",
    name: "Kindred Discovery",
    type_line: "Enchantment",
    oracle_text: "…",
    colors: ["U"],
    color_identity: ["U"],
    cmc: 5,
  });
  expect(n!.card.power).toBeNull();
  expect(n!.card.toughness).toBeNull();
  expect(n!.card.colorIdentity).toEqual(["U"]);
});
