import { expect, test } from "vitest";
import { parseDecklistSections } from "./sections.js";

test("splits a Commander section from the deck", () => {
  const text = [
    "Commander",
    "1 Krenko, Mob Boss",
    "",
    "Deck",
    "1 Sol Ring",
    "1 Impact Tremors",
  ].join("\n");
  expect(parseDecklistSections(text)).toEqual({
    commanders: ["Krenko, Mob Boss"],
    deck: ["Sol Ring", "Impact Tremors"],
  });
});

test("supports two commanders (Partner) and drops a Sideboard section", () => {
  const text = [
    "Commanders",
    "1 Tymna the Weaver",
    "1 Thrasios, Triton Hero",
    "",
    "1 Sol Ring",
    "",
    "Sideboard",
    "1 Not In Deck",
  ].join("\n");
  const out = parseDecklistSections(text);
  expect(out.commanders).toEqual(["Tymna the Weaver", "Thrasios, Triton Hero"]);
  expect(out.deck).toEqual(["Sol Ring"]);
});

test("no Commander header → everything is deck, commanders empty", () => {
  const text = "1 Sol Ring\n1 Krenko, Mob Boss";
  expect(parseDecklistSections(text)).toEqual({
    commanders: [],
    deck: ["Sol Ring", "Krenko, Mob Boss"],
  });
});

test("expands quantities in the deck section (basics counted by copy)", () => {
  const { deck } = parseDecklistSections("2 Forest\n1 Sol Ring");
  expect(deck).toEqual(["Forest", "Forest", "Sol Ring"]);
});

// THE HEADERLESS CONVENTION. Requiring a "Commander" header meant `commanders` came back empty for
// all 71 calibration decks, so SubjectFilter.commander shipped with a producer side that could never
// fire. Measured over those files: 67 have a one-card first block, 4 have two (partner pairs), none
// has three or more.
test("a headerless list reads its first block as the commander", () => {
  const s = parseDecklistSections("1 Kratos, God of War\n\n30 Mountain\n1 Sol Ring");
  expect(s.commanders).toEqual(["Kratos, God of War"]);
  expect(s.deck).toContain("Sol Ring");
  expect(s.deck).not.toContain("Kratos, God of War");
});

test("two cards before the blank line are a partner pair", () => {
  const s = parseDecklistSections("1 Kediss, Emberclaw Familiar\n1 Kratos, God of War\n\n1 Sol Ring");
  expect(s.commanders).toEqual(["Kediss, Emberclaw Familiar", "Kratos, God of War"]);
});

test("an explicit header always wins over the convention", () => {
  const s = parseDecklistSections("Commander\n1 Kratos, God of War\n\nDeck\n1 Sol Ring");
  expect(s.commanders).toEqual(["Kratos, God of War"]);
  expect(s.deck).toEqual(["Sol Ring"]);
});

test("an ordinary list is NOT reinterpreted", () => {
  // Three cards before the blank is a decklist that happens to have one, not a commander block —
  // guessing there would mislabel two real deck cards.
  const three = parseDecklistSections("1 Sol Ring\n1 Mana Crypt\n1 Mox Diamond\n\n1 Forest");
  expect(three.commanders).toEqual([]);
  // No blank line at all: nothing to split on.
  expect(parseDecklistSections("1 Sol Ring\n1 Forest").commanders).toEqual([]);
});
