import { expect, test } from "vitest";
import { identityColor, identityKey, identityLabel, NEUTRAL_ACCENT } from "./color-identity.js";

test("identityKey sorts into canonical WUBRG order regardless of input order", () => {
  expect(identityKey(["R", "U"])).toBe("UR");
  expect(identityKey(["G", "W", "B"])).toBe("WBG");
});

test("identityKey dedupes repeated colors", () => {
  expect(identityKey(["U", "U", "R"])).toBe("UR");
});

test("identityLabel resolves mono, guild, shard, four-color, and five-color names", () => {
  expect(identityLabel([])).toBe("Colorless");
  expect(identityLabel(["G"])).toBe("Green");
  expect(identityLabel(["U", "R"])).toBe("Izzet");
  expect(identityLabel(["B", "R", "G"])).toBe("Jund");
  expect(identityLabel(["W", "U", "B", "G"])).toBe("Witch-Maw");
  expect(identityLabel(["W", "U", "B", "R", "G"])).toBe("Five-Color");
});

test("identityColor falls back to the neutral old-gold accent for colorless", () => {
  expect(identityColor([])).toBe(NEUTRAL_ACCENT);
});

test("identityColor returns a valid hex color for every identity", () => {
  const hexPattern = /^#[0-9a-f]{6}$/;
  expect(identityColor(["W"])).toMatch(hexPattern);
  expect(identityColor(["W", "U", "B", "R", "G"])).toMatch(hexPattern);
});

test("identityColor is stable regardless of input color order", () => {
  expect(identityColor(["R", "G", "B"])).toBe(identityColor(["B", "R", "G"]));
});

test("distinct mono colors resolve to distinct accent colors", () => {
  const colors = new Set(["W", "U", "B", "R", "G"].map((c) => identityColor([c])));
  expect(colors.size).toBe(5);
});
