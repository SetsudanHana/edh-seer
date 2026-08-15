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

test("the stamp marks a card's own EMITS, never what it watches", () => {
  // An emit is what the card supplies; a trigger subject is what it looks for. Stamping the trigger
  // would make a commander-matters card demand that the SUPPLIER be a commander too.
  const tags = {
    oracleId: "x", schemaVersion: 1, promptVersion: 0, model: "derived",
    characteristics: { types: ["creature"], subtypes: [], colors: [], identity: [], cmc: 3,
      power: "2", toughness: "2", token: false, keywords: [] },
    abilities: [{
      kind: "triggered" as const,
      trigger: { verbs: ["attacks" as const], subject: sub({ type: "creature" }) },
      effect: { kind: "damage" as const },
      emits: [{ verb: "combat-damage" as const, subject: sub({ type: "creature" }) }],
    }],
  } satisfies CardTags;
  const out = markCommander(tags);
  expect(out.abilities[0].emits?.[0].subject.commander).toBe(true);
  expect(out.abilities[0].trigger?.subject.commander).toBeUndefined();
});
