import { expect, test } from "vitest";
import { extractTags } from "./tags.js";
import { FIXTURES } from "./fixtures.js";

test("Krenko produces tokens (and creature-etb)", () => {
  const t = extractTags(FIXTURES.krenko);
  expect(t.produces.has("token")).toBe(true);
  expect(t.produces.has("creature-etb")).toBe(true);
});

test("Impact Tremors cares about creature-etb", () => {
  const t = extractTags(FIXTURES.impactTremors);
  expect(t.cares.has("creature-etb")).toBe(true);
});

test("Ashnod's Altar is a sacrifice outlet: produces sacrifice-event and mana, cares about fodder", () => {
  const t = extractTags(FIXTURES.ashnods);
  expect(t.produces.has("sacrifice-event")).toBe(true);
  expect(t.produces.has("mana")).toBe(true);
  expect(t.cares.has("sacrifice-fodder")).toBe(true);
});

test("Blood Artist cares about creature-death", () => {
  const t = extractTags(FIXTURES.bloodArtist);
  expect(t.cares.has("creature-death")).toBe(true);
});

test("Cultivate is ramp and produces land-etb + mana", () => {
  const t = extractTags(FIXTURES.cultivate);
  expect(t.produces.has("ramp")).toBe(true);
  expect(t.produces.has("land-etb")).toBe(true);
});

test("Lotus Cobra cares about land-etb (landfall)", () => {
  const t = extractTags(FIXTURES.lotusCobra);
  expect(t.cares.has("land-etb")).toBe(true);
});

test("Swords to Plowshares is removal", () => {
  const t = extractTags(FIXTURES.swordsToPlowshares);
  expect(t.produces.has("removal")).toBe(true);
});

test("Divination is card-draw", () => {
  const t = extractTags(FIXTURES.divination);
  expect(t.produces.has("card-draw")).toBe(true);
});
