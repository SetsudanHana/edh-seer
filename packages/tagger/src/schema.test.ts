import { expect, test } from "vitest";
import { VERB_VOCAB, SCHEMA_VERSION, SCALING_BASES, SCALING_ALIASES } from "./schema.js";

test("verb vocabulary is the closed 17-verb list", () => {
  expect(VERB_VOCAB).toHaveLength(19);
  expect(VERB_VOCAB).toContain("enters");
  expect(VERB_VOCAB).toContain("create-token");
  expect(VERB_VOCAB).toContain("land-play");
  expect(new Set(VERB_VOCAB).size).toBe(VERB_VOCAB.length);
});

test("schema version starts at 1", () => {
  expect(SCHEMA_VERSION).toBe(1);
});

test("SCALING_BASES is the 8-member closed vocab with fixed first", () => {
  expect(SCALING_BASES).toEqual([
    "fixed", "per-creature", "per-permanent", "per-graveyard",
    "per-cast-or-spell", "x-cost", "per-opponent", "unbounded",
  ]);
});

test("every SCALING_ALIASES target is a canonical SCALING_BASES member", () => {
  const bases = new Set<string>(SCALING_BASES);
  for (const [alias, target] of Object.entries(SCALING_ALIASES)) {
    expect(bases, `alias "${alias}" -> "${target}" not a base`).toContain(target);
    expect(bases.has(alias), `alias "${alias}" collides with a base`).toBe(false);
  }
});
