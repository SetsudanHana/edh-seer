import { expect, test } from "vitest";
import { identityColor, identityGradient, identityKey, identityLabel, NEUTRAL_ACCENT } from "./color-identity.js";

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

test("identityColor for a multicolor identity is always one of its real constituent colors", () => {
  // Regression: an earlier circular-mean-of-hues approach could land on a totally
  // unrelated color — WU (Azorius) rendered as Green's own hue by coincidence.
  expect(identityColor(["W", "U"])).toBe(identityColor(["W"])); // Azorius -> White, not Green
  expect(identityColor(["U", "R"])).toBe(identityColor(["U"])); // Izzet -> Blue
  expect(identityColor(["B", "G"])).toBe(identityColor(["B"])); // Golgari -> Black, not "basically Blue"
});

test("identityGradient returns a solid color for 0-1 colors, a gradient for 2+", () => {
  expect(identityGradient([])).toBe(NEUTRAL_ACCENT);
  expect(identityGradient(["G"])).toBe(identityColor(["G"]));
  const gradient = identityGradient(["W", "U"]);
  expect(gradient).toMatch(/^linear-gradient\(90deg, .+\)$/);
  expect(gradient).toContain(identityColor(["W"]));
  expect(gradient).toContain(identityColor(["U"]));
});

test("identityGradient is order-independent and lists colors in WUBRG order", () => {
  expect(identityGradient(["U", "W"])).toBe(identityGradient(["W", "U"]));
  const gradient = identityGradient(["U", "W"]);
  expect(gradient.indexOf(identityColor(["W"]))).toBeLessThan(gradient.indexOf(identityColor(["U"])));
});
