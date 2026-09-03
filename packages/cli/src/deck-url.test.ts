import { expect, test } from "vitest";
import { isArchidektUrl, isMoxfieldUrl } from "./deck-url.js";

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
