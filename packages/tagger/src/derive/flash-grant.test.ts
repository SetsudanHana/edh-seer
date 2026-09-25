import { expect, test } from "vitest";
import { deriveAbilities } from "./derive.js";

/** A FLASH GRANT IS A PERMISSION, NOT A CAST (overview persona rounds 2026-09-25: the skeptic's Najal
 *  claim, and High Fae Trickster -- a creature -- feeding Harmonic Prodigy's noncreature-only prowess).
 *  "You may cast spells as though they had flash" derived as an authored `cast` emit, so the card read
 *  as casting every spell. It changes WHEN you may cast; it causes no cast. Real clause shapes from
 *  `cardClauses`, 2026-09-26. */
test("'cast ... as though they had flash' emits no cast", () => {
  const trickster = "You may cast spells as though they had flash.";
  const hft = deriveAbilities([{ id: 3, abilityType: "static", actions: [{ verb: "cast", object: "spells", optional: true }] }],
    "High Fae Trickster", { 3: trickster }, undefined, trickster).abilities;
  expect(hft.flatMap((a) => a.emits ?? []).filter((e) => e.verb === "cast")).toEqual([]);
  const najal = "You may cast sorcery spells as though they had flash.";
  const nj = deriveAbilities([{ id: 1, abilityType: "static", actions: [{ verb: "cast", object: "sorcery spells", optional: true }] }],
    "Najal, the Storm Runner", { 1: najal }, undefined, najal).abilities;
  expect(nj.flatMap((a) => a.emits ?? []).filter((e) => e.verb === "cast")).toEqual([]);
});
