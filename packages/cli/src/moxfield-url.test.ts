import { expect, test } from "vitest";
import { isMoxfieldUrl } from "./moxfield-url.js";

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
