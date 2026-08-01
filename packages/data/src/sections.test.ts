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
