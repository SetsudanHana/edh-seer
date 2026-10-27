import { expect, test } from "vitest";
import { identityGradient, identityKey, identityLabel, NEUTRAL_IDENTITY } from "./color-identity.js";

/** `identityColor()` and its tests are gone with v2 — nothing needs a single solid colour for an
 *  identity now that the accent is fixed and the header no longer follows the deck. The gradient
 *  tests below carry the cases that still have a caller (`DeckIdentity`), rewritten to name their
 *  own colours instead of asserting against the deleted function. */

const MANA = { W: "#ddd6c4", U: "#6ba0f5", B: "#7e7a85", R: "#d9544f", G: "#55a86a" } as const;

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

test("identityGradient always returns a linear-gradient, even for 0-1 colors", () => {
  // Always a valid background-image value — no bare-hex special case for callers.
  const pattern = /^linear-gradient\(90deg, .+\)$/;
  expect(identityGradient([])).toMatch(pattern);
  expect(identityGradient([])).toContain(NEUTRAL_IDENTITY);
  expect(identityGradient(["G"])).toMatch(pattern);
  expect(identityGradient(["G"])).toContain(MANA.G);
  const gradient = identityGradient(["W", "U"]);
  expect(gradient).toMatch(pattern);
  expect(gradient).toContain(MANA.W);
  expect(gradient).toContain(MANA.U);
});

test("identityGradient is order-independent and lists colors in WUBRG order", () => {
  expect(identityGradient(["U", "W"])).toBe(identityGradient(["W", "U"]));
  const gradient = identityGradient(["U", "W"]);
  expect(gradient.indexOf(MANA.W)).toBeLessThan(gradient.indexOf(MANA.U));
});

test("every identity colour is drawn from the design system's mana ramp", () => {
  // The point of the ramp: these five are tuned for the violet ground, not derived from a hue
  // wheel. The old anchor system put BLACK at hue 275 — the ladder's own hue — so a mono-black
  // identity drew as substrate. Black is now a true neutral grey, and this test fails if some
  // future edit reintroduces a violet for it.
  for (const [letter, hex] of Object.entries(MANA)) {
    expect(identityGradient([letter])).toContain(hex);
  }
  expect(MANA.B).toBe("#7e7a85");
});

test("distinct mono colors stay distinguishable from one another", () => {
  const swatches = new Set(["W", "U", "B", "R", "G"].map((c) => identityGradient([c])));
  expect(swatches.size).toBe(5);
});
