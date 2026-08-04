import { expect, test } from "vitest";
import { VERB_VOCAB, SCHEMA_VERSION, SCALING_BASES, SCALING_ALIASES, EFFECT_KINDS } from "./schema.js";

test("VERB_VOCAB is a closed, unique verb list", () => {
  expect(VERB_VOCAB).toHaveLength(20);
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

test("graveyard hate and extra combat are expressible", () => {
  // Kalitas and Stone of Erech exile an opponent's dying creatures — they deny a graveyard, they
  // do not recur from one. Filed as graveyard-recursion today, which inverts them into the
  // graveyard theme they exist to attack.
  expect(EFFECT_KINDS).toContain("graveyard-hate");
  // Karlach grants an additional combat phase: surplus attack events, the same shape as a
  // fetchland's surplus land-ETB.
  expect(EFFECT_KINDS).toContain("extra-combat");
});
