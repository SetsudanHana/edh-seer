import { expect, test } from "vitest";
import { normalizeName } from "./names.js";

test("lowercases and strips punctuation and apostrophes", () => {
  expect(normalizeName("Krenko, Mob Boss")).toBe("krenko mob boss");
  expect(normalizeName("Thassa's Oracle")).toBe("thassas oracle");
});

test("strips diacritics", () => {
  expect(normalizeName("Juzám Djinn")).toBe("juzam djinn");
});

test("collapses whitespace", () => {
  expect(normalizeName("  Sol   Ring  ")).toBe("sol ring");
});
