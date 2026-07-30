import { expect, test } from "vitest";
import { SEED_IMPACT_WEIGHTS } from "@mtg/engine";
import type { CardTags } from "@mtg/tagger";
import { computeCardBuckets } from "./buckets.js";

const tags = (abilities: CardTags["abilities"]): CardTags => ({
  oracleId: "t",
  schemaVersion: 1,
  promptVersion: 1,
  model: "t",
  characteristics: {
    types: [], subtypes: [], colors: [], identity: [], cmc: 0,
    power: null, toughness: null, token: false, keywords: [],
  },
  abilities,
});

test("draw-card qualifies for consistency only", () => {
  const t = tags([{
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { control: "you", token: null } },
    effect: { kind: "draw-card" },
  }]);
  const b = computeCardBuckets(t, SEED_IMPACT_WEIGHTS);
  expect(b.consistency).toBeGreaterThan(0);
  expect(b.efficiency).toBe(0);
  expect(b["win-condition"]).toBe(0);
});

test("mana-generation qualifies for efficiency only", () => {
  const t = tags([{ kind: "static", effect: { kind: "mana-generation" } }]);
  const b = computeCardBuckets(t, SEED_IMPACT_WEIGHTS);
  expect(b.efficiency).toBeGreaterThan(0);
  expect(b.consistency).toBe(0);
  expect(b["win-condition"]).toBe(0);
});

test("damage qualifies for win-condition only", () => {
  const t = tags([{
    kind: "on-cast",
    effect: { kind: "damage", subject: { control: "opp", token: null } },
  }]);
  const b = computeCardBuckets(t, SEED_IMPACT_WEIGHTS);
  expect(b["win-condition"]).toBeGreaterThan(0);
  expect(b.consistency).toBe(0);
  expect(b.efficiency).toBe(0);
});

test("repeatable counter-placement qualifies for win-condition (voltron engine)", () => {
  const t = tags([{
    kind: "triggered",
    trigger: { verbs: ["attacks"], subject: { control: "you", token: null } },
    effect: { kind: "counter-placement", subject: { control: "you", token: null } },
  }]);
  const b = computeCardBuckets(t, SEED_IMPACT_WEIGHTS);
  expect(b["win-condition"]).toBeGreaterThan(0);
});

test("one-shot fixed counter-placement does NOT qualify for win-condition", () => {
  const t = tags([{
    kind: "on-cast",
    effect: { kind: "counter-placement", subject: { control: "you", token: null } },
  }]);
  const b = computeCardBuckets(t, SEED_IMPACT_WEIGHTS);
  expect(b["win-condition"]).toBe(0);
});

test("one-shot counter-placement WITH non-fixed scaling still qualifies", () => {
  const t = tags([{
    kind: "on-cast",
    effect: { kind: "counter-placement", subject: { control: "you", token: null }, scaling: "per-creature" },
  }]);
  const b = computeCardBuckets(t, SEED_IMPACT_WEIGHTS);
  expect(b["win-condition"]).toBeGreaterThan(0);
});

test("an unmapped effect kind (pump) contributes to no bucket", () => {
  const t = tags([{
    kind: "static",
    effect: { kind: "pump", subject: { control: "you", token: null } },
  }]);
  const b = computeCardBuckets(t, SEED_IMPACT_WEIGHTS);
  expect(b).toEqual({ consistency: 0, efficiency: 0, "win-condition": 0 });
});
