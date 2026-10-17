import { expect, test } from "vitest";
import { ARTIFACT_TOKEN_KINDS, tokenKindsWith } from "./token-kinds.js";

// #1268 F9: pins what each of the three readers sees, so a kind added to the table moves a named set on purpose.
test("fodder is exactly food, treasure, clue, blood, gold (Map and Junk stay out: a CEILING, not a ruling)", () => {
  expect([...tokenKindsWith("fodder")].sort()).toEqual(["blood", "clue", "food", "gold", "treasure"]);
});

test("resource kinds are the archetypes RESOURCE_TOKENS list", () => {
  expect([...tokenKindsWith("resource")].sort()).toEqual([
    "aura", "blood", "clue", "food", "gold", "heartwood", "incubator", "junk", "lander", "map", "mutagen",
    "powerstone", "role", "treasure", "vibranium",
  ]);
});

test("replaced kinds are the creation-replacement name list", () => {
  expect([...tokenKindsWith("replaced")].sort()).toEqual([
    "blood", "clue", "eldrazi", "food", "gold", "incubator", "junk", "lander", "map", "mutagen", "powerstone",
    "role", "scion", "shard", "spawn", "treasure",
  ]);
});

test("every kind carries at least one flag", () => {
  for (const [name, k] of Object.entries(ARTIFACT_TOKEN_KINDS)) expect(Object.keys(k).length, name).toBeGreaterThan(0);
});
