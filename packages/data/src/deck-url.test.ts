import { expect, test } from "vitest";
import { deckSourceOf, isArchidektUrl, isMoxfieldUrl } from "./deck-url.js";

test("accepts real Moxfield deck URLs", () => {
  expect(isMoxfieldUrl("https://moxfield.com/decks/abc123")).toBe(true);
  expect(isMoxfieldUrl("https://www.moxfield.com/decks/abc123")).toBe(true);
});

test("rejects hosts that merely CONTAIN the string, which the old substring test accepted", () => {
  expect(isMoxfieldUrl("https://moxfield.com.example.invalid/decks/x")).toBe(false);
  expect(isMoxfieldUrl("https://evil.invalid/?q=moxfield.com")).toBe(false);
  expect(isMoxfieldUrl("https://notmoxfield.com/decks/x")).toBe(false);
});

test("a local file path is not a URL, so it takes the file branch", () => {
  expect(isMoxfieldUrl("decks/my-deck.txt")).toBe(false);
  expect(isMoxfieldUrl("/abs/path/moxfield.com.txt")).toBe(false);
});

test("the same host rule covers Archidekt", () => {
  expect(isArchidektUrl("https://archidekt.com/decks/26039486/teysa")).toBe(true);
  expect(isArchidektUrl("https://www.archidekt.com/decks/26039486")).toBe(true);
  expect(isArchidektUrl("https://archidekt.com.example.invalid/decks/x")).toBe(false);
  expect(isArchidektUrl("https://moxfield.com/decks/x")).toBe(false);
  expect(isMoxfieldUrl("https://archidekt.com/decks/x")).toBe(false);
});

test("deckSourceOf names the site and the id, or refuses", () => {
  expect(deckSourceOf("https://www.moxfield.com/decks/AbC-123")).toEqual({
    source: "moxfield",
    id: "AbC-123",
  });
  expect(deckSourceOf("  https://archidekt.com/decks/26039486/teysa  ")).toEqual({
    source: "archidekt",
    id: "26039486",
  });
  // A decklist is not a URL, and that is the whole discrimination the caller needs.
  expect(deckSourceOf("1 Sol Ring\n1 Mountain")).toBeNull();
  expect(deckSourceOf("https://moxfield.com.example.invalid/decks/x")).toBeNull();
  // The right host with nothing usable after it is a refusal, not a guess.
  expect(deckSourceOf("https://archidekt.com/decks/not-a-number")).toBeNull();
});
