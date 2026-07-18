import { expect, test } from "vitest";
import { scoreCard, aggregate } from "./score.js";
import type { CardTags } from "./schema.js";

function tags(over: Partial<CardTags>): CardTags {
  return {
    oracleId: "o", schemaVersion: 1, promptVersion: 1, model: "m",
    characteristics: {
      types: ["creature"], subtypes: ["wizard"], colors: ["U"], identity: ["U"],
      cmc: 2, power: "1", toughness: "1", token: false, keywords: [],
    },
    abilities: [],
    ...over,
  };
}

const ability = {
  kind: "triggered" as const,
  trigger: { verbs: ["enters" as const], subject: { subtype: "wizard", control: "you" as const, token: false } },
  effect: { kind: "draw-card" },
};

test("identical tags: chars exact, perfect ability score", () => {
  const g = tags({ abilities: [ability] });
  const s = scoreCard(g, g);
  expect(s.charsExact).toBe(true);
  expect(s.abilityTP).toBe(1);
  expect(s.abilityFP).toBe(0);
  expect(s.abilityFN).toBe(0);
});

test("chars mismatch flagged", () => {
  const gold = tags({});
  const pred = tags({ characteristics: { ...gold.characteristics, subtypes: ["human"] } });
  expect(scoreCard(pred, gold).charsExact).toBe(false);
});

test("missing predicted ability is a false negative", () => {
  const gold = tags({ abilities: [ability] });
  const pred = tags({ abilities: [] });
  const s = scoreCard(pred, gold);
  expect(s.abilityFN).toBe(1);
  expect(s.abilityTP).toBe(0);
});

test("extra predicted ability is a false positive", () => {
  const gold = tags({ abilities: [] });
  const pred = tags({ abilities: [ability] });
  expect(scoreCard(pred, gold).abilityFP).toBe(1);
});

test("duplicate gold abilities canonicalizing to the same key count as one TP", () => {
  // Gold has two structurally-identical abilities (same kind, trigger verbs/subject,
  // effect.kind) that canonicalize to the same abilityKey, plus one distinct unmatched
  // ability. goldSet dedupes to 2 distinct keys; predSet matches only one of them.
  // Old (array-loop) TP counting would double-count the duplicate as TP=2; the
  // set-based fix must count it once: TP=1, FN=1.
  const other = {
    kind: "triggered" as const,
    trigger: { verbs: ["attacks" as const], subject: { subtype: "wizard", control: "you" as const, token: false } },
    effect: { kind: "draw-card" },
  };
  const gold = tags({ abilities: [ability, { ...ability }, other] });
  const pred = tags({ abilities: [ability] });
  const s = scoreCard(pred, gold);
  expect(s.abilityTP).toBe(1);
  expect(s.abilityFN).toBe(1);
});

test("aggregate computes precision, recall, f1", () => {
  const r = aggregate([
    { oracleId: "a", charsExact: true, abilityTP: 1, abilityFP: 0, abilityFN: 0 },
    { oracleId: "b", charsExact: false, abilityTP: 1, abilityFP: 1, abilityFN: 1 },
  ]);
  expect(r.charsExactRate).toBe(0.5);
  expect(r.precision).toBeCloseTo(2 / 3);
  expect(r.recall).toBeCloseTo(2 / 3);
  expect(r.f1).toBeCloseTo(2 / 3);
});
