import { expect, test } from "vitest";
import { VERB_VOCAB, VERB_ALIASES, SCHEMA_VERSION, SCALING_BASES, SCALING_ALIASES, EFFECT_KINDS } from "./schema.js";

test("VERB_VOCAB is a closed, unique verb list", () => {
  // A COUNT RATCHET: every engine verb is a matching surface, so growing this list must be a
  // decision rather than a side effect. 23 -> 24 on 2026-08-15 for `dice-rolled` (CR 706), the
  // only member of today's vocabulary work that earned an ENGINE verb rather than just a clause
  // word — 162 corpus cards instruct a roll and 7 trigger on one, and without a verb the supply
  // could not reach them. Coin flips (CR 705) were REFUSED the same day: 81 cards flip and zero
  // trigger on another card's flip.
  expect(VERB_VOCAB).toHaveLength(24);
  expect(VERB_VOCAB).toContain("enters");
  expect(VERB_VOCAB).toContain("create-token");
  expect(VERB_VOCAB).toContain("land-play");
  expect(VERB_VOCAB).toContain("dice-rolled");
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

test("phase/step triggers have their own verbs", () => {
  // Without these the vocabulary had nowhere to put "at the beginning of your upkeep", so a
  // 46-card audit found Nut Collector, Sen Triplets and Crystalline Giant all tagged `enters` —
  // which forms false edges with every ETB payoff in the deck.
  expect(VERB_VOCAB).toContain("upkeep");
  expect(VERB_VOCAB).toContain("begin-combat");
  expect(VERB_VOCAB).toContain("end-step");
});

test("common phase-trigger spellings alias onto the canonical verbs", () => {
  expect(VERB_ALIASES["beginning-of-upkeep"]).toBe("upkeep");
  expect(VERB_ALIASES["beginning-of-combat"]).toBe("begin-combat");
  expect(VERB_ALIASES["end-of-turn"]).toBe("end-step");
});
