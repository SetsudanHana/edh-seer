import { expect, test } from "vitest";
import { deriveAbilities } from "./derive.js";

/** A PHASE-OUT THE MODEL FILED AS A `put` (#1266, owner ruling 2026-11-12: a land can carry Protection). Talon Gates of Madara's stored clause (normalizeVersion 12) is
 *  `put` / "up to one target creature" with no zones, so derive wrote no `phases-out` emit. The clause text is the card's printed line (Mongo `cards`, 2026-11-12). */
const TALON = "When this land enters, up to one target creature phases out.";
const talon = (verb: string, text = TALON) => deriveAbilities([
  { id: 1, abilityType: "triggered", trigger: { event: "enters", subject: "this land", control: "you" }, actions: [{ verb, object: "up to one target creature", fromZone: null, toZone: null, amount: null, optional: true }] },
], "Talon Gates of Madara", { 1: text }, undefined, text).abilities;
const verbs = (abilities: ReturnType<typeof talon>): string[] => abilities.flatMap((a) => (a.emits ?? []).map((e) => e.verb));

test("a `put` with no zones, in a clause that prints 'phases out' and no put, is a phase-out", () => {
  expect(verbs(talon("put"))).toEqual(["phases-out"]);
  // The emit's subject is the target creature, not the card.
  const emit = talon("put").flatMap((a) => a.emits ?? []).find((e) => e.verb === "phases-out")!;
  expect(emit.subject.scope).toBe("target");
  expect(emit.subject.self).toBeUndefined();
});

test("the same verb read right, and a real put, are left alone", () => {
  expect(verbs(talon("phase-out"))).toEqual(["phases-out"]);
  // A real `put` (a counter, a card onto the battlefield) names its own word, or a zone: not rewritten.
  const counter = deriveAbilities([
    { id: 1, abilityType: "triggered", trigger: { event: "enters", subject: "this creature", control: "you" }, actions: [{ verb: "put", object: "a +1/+1 counter on target creature", fromZone: null, toZone: null, amount: null, optional: false }] },
  ], "Writ", { 1: "When this creature enters, put a +1/+1 counter on target creature. Then target creature phases out." }, undefined, "When this creature enters, put a +1/+1 counter on target creature. Then target creature phases out.").abilities;
  expect(verbs(counter)).not.toContain("phases-out");
});
