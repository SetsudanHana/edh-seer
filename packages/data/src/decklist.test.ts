import { expect, test } from "vitest";
import { parseDecklistText } from "./decklist.js";

test("parses names, stripping leading quantities", () => {
  const names = parseDecklistText("1 Krenko, Mob Boss\n1x Sol Ring\nImpact Tremors");
  expect(names).toEqual(["Krenko, Mob Boss", "Sol Ring", "Impact Tremors"]);
});

test("ignores comments and blank lines", () => {
  const names = parseDecklistText("# Commander\n\n1 Sol Ring\n// sideboard\n");
  expect(names).toEqual(["Sol Ring"]);
});

test("strips trailing set/collector annotations", () => {
  const names = parseDecklistText("1 Sol Ring (C21) 263\n1 Arcane Signet [LTC]");
  expect(names).toEqual(["Sol Ring", "Arcane Signet"]);
});

test("expands leading quantities into repeated names", () => {
  const names = parseDecklistText("5 Forest\n1 Sol Ring\n2x Mountain");
  expect(names).toEqual(["Forest", "Forest", "Forest", "Forest", "Forest", "Sol Ring", "Mountain", "Mountain"]);
});
