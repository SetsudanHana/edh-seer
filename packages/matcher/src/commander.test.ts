import { expect, test } from "vitest";
import type { CardTags, SubjectFilter } from "@mtg/tagger";
import { commanderMatches, markCommander } from "./commander.js";

const sub = (o: Partial<SubjectFilter> = {}): SubjectFilter => ({ control: "you", token: null, ...o });

test("a consumer demanding a commander is satisfied only by a designated one", () => {
  // Kediss, Emberclaw Familiar: "whenever a commander you control deals combat damage".
  expect(commanderMatches(sub({ commander: true }), sub({ commander: true }))).toBe(true);
  expect(commanderMatches(sub(), sub({ commander: true }))).toBe(false);
  // A consumer that does not ask is unaffected — the same asymmetry legendary and basic have.
  expect(commanderMatches(sub(), sub())).toBe(true);
  expect(commanderMatches(sub({ commander: true }), sub())).toBe(true);
});

const tagsWith = (emit: SubjectFilter): CardTags => ({
  oracleId: "x", schemaVersion: 1, promptVersion: 0, model: "derived",
  characteristics: { types: ["creature"], subtypes: [], colors: [], identity: [], cmc: 3,
    power: "2", toughness: "2", token: false, keywords: [] },
  abilities: [{
    kind: "triggered" as const,
    trigger: { verbs: ["attacks" as const], subject: sub({ type: "creature" }) },
    effect: { kind: "damage" as const },
    emits: [{ verb: "combat-damage" as const, subject: emit }],
  }],
});

test("the stamp marks a card's own EMITS, never what it watches", () => {
  // An emit is what the card supplies; a trigger subject is what it looks for. Stamping the trigger
  // would make a commander-matters card demand that the SUPPLIER be a commander too.
  const out = markCommander(tagsWith(sub({ type: "creature", self: true })));
  expect(out.abilities[0].emits?.[0].subject.commander).toBe(true);
  expect(out.abilities[0].trigger?.subject.commander).toBeUndefined();
});

test("an emit describing some OTHER object is not stamped", () => {
  // An emit subject says what the event HAPPENS TO, not who caused it. Y'shtola Rhul returns "target
  // creature you control" — the creature that enters is not a commander, and saying so is a false
  // sentence that two identity checks in edges.ts read as a filter against the consumer's printed
  // characteristics: Bellowing Crier's own ETB stopped being blinkable because a Frog is no commander.
  // 158 of the 71 decks' 164 commander emits are this shape; only 6 name the commander itself.
  const out = markCommander(tagsWith(sub({ type: "creature" })));
  expect(out.abilities[0].emits?.[0].subject.commander).toBeUndefined();
});
