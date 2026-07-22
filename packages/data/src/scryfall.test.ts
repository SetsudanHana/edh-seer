import { expect, test } from "vitest";
import { normalizeScryfallCard, NON_GAMEPLAY_LAYOUTS } from "./scryfall.js";

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

test("rejects every non-gameplay layout", () => {
  for (const layout of NON_GAMEPLAY_LAYOUTS) {
    const n = normalizeScryfallCard({
      oracle_id: "junk",
      name: "Jetmir, Nexus of Revels // Jetmir, Nexus of Revels",
      type_line: "Card // Card",
      layout,
    });
    expect(n, `layout ${layout} should be rejected`).toBeNull();
  }
});

test("keeps a real transform DFC (gameplay layout)", () => {
  const n = normalizeScryfallCard({
    oracle_id: "real-dfc",
    name: "Front // Back",
    type_line: "Creature — Werewolf // Creature — Werewolf",
    layout: "transform",
    card_faces: [
      { oracle_text: "Front text", colors: ["R"] },
      { oracle_text: "Back text", colors: ["G"] },
    ],
  });
  expect(n).not.toBeNull();
  expect(n!.card.oracleText).toBe("Front text\n//\nBack text");
});

test("keeps a card with no layout field (defaults to gameplay)", () => {
  const n = normalizeScryfallCard({
    oracle_id: "no-layout",
    name: "Grizzly Bears",
    type_line: "Creature — Bear",
    oracle_text: "",
  });
  expect(n).not.toBeNull();
});

test("NON_GAMEPLAY_LAYOUTS contains exactly the five reject layouts", () => {
  expect([...NON_GAMEPLAY_LAYOUTS].sort()).toEqual(
    ["art_series", "double_faced_token", "emblem", "reversible_card", "token"],
  );
});
