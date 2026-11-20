import { expect, test } from "vitest";
import { SEED_IMPACT_WEIGHTS } from "@edh-seer/engine";
import type { CardTags } from "@edh-seer/tagger";
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

// #721 (owner 2026-11-17): self-mill and surveil are in no bucket; an opponent mill is a win condition; an either-side mill is a win condition too and is not consistency.
const millAbility = (control: "you" | "opp" | "any"): CardTags["abilities"] => [{
  kind: "on-cast", effect: { kind: "mill", subject: { control, token: null } },
  emits: [{ verb: "mill", subject: { control, token: null } }],
}];
test("self-mill contributes to no bucket (#721)", () => {
  const b = computeCardBuckets(tags(millAbility("you")), SEED_IMPACT_WEIGHTS);
  expect(b).toEqual({ consistency: 0, efficiency: 0, "win-condition": 0 });
});
test("surveil contributes to no bucket (#721)", () => {
  const b = computeCardBuckets(tags([{ kind: "on-cast", effect: { kind: "surveil" } }]), SEED_IMPACT_WEIGHTS);
  expect(b).toEqual({ consistency: 0, efficiency: 0, "win-condition": 0 });
});
test("an opponent mill is a win condition and not consistency (#721)", () => {
  const b = computeCardBuckets(tags(millAbility("opp")), SEED_IMPACT_WEIGHTS);
  expect(b["win-condition"]).toBeGreaterThan(0);
  expect(b.consistency).toBe(0);
});
test("an either-side mill (target player, each player) is a win condition and not consistency (#721)", () => {
  const b = computeCardBuckets(tags(millAbility("any")), SEED_IMPACT_WEIGHTS);
  expect(b["win-condition"]).toBeGreaterThan(0);
  expect(b.consistency).toBe(0);
});
test("a mill whose milled player derive left unread is in no bucket (#721)", () => {
  const b = computeCardBuckets(tags([{ kind: "static", effect: { kind: "mill" } }]), SEED_IMPACT_WEIGHTS);
  expect(b).toEqual({ consistency: 0, efficiency: 0, "win-condition": 0 });
});
test("the effect subject and the emit are joined, so a misread emit does not hide an `any` mill (Mesmeric Orb: 'that permanent's controller mills')", () => {
  const b = computeCardBuckets(tags([{
    kind: "triggered", trigger: { verbs: ["untaps"], subject: { control: "any", token: null, type: "permanent" } },
    effect: { kind: "mill", subject: { control: "any", token: null, type: "permanent" } },
    emits: [{ verb: "mill", subject: { control: "you", token: null } }],
  }]), SEED_IMPACT_WEIGHTS);
  expect(b["win-condition"]).toBeGreaterThan(0);
  expect(b.consistency).toBe(0);
});
test.each(["scry", "search", "top-set"])("%s stays in consistency (#721)", (kind) => {
  const b = computeCardBuckets(tags([{ kind: "on-cast", effect: { kind } }]), SEED_IMPACT_WEIGHTS);
  expect(b.consistency).toBeGreaterThan(0);
  expect(b["win-condition"]).toBe(0);
});

// #1662: an optional mill is still the controller's choice whichever library it empties, so one that reaches an opponent stays a win condition; an optional self-mill stays in no bucket.
test("an optional either-side mill is still a win condition, an optional self-mill in no bucket (#1662)", () => {
  const opt = (control: "you" | "any") => millAbility(control).map((a) => ({ ...a, optional: true as const }));
  const any = computeCardBuckets(tags(opt("any")), SEED_IMPACT_WEIGHTS);
  expect(any["win-condition"]).toBeGreaterThan(0);
  const you = computeCardBuckets(tags(opt("you")), SEED_IMPACT_WEIGHTS);
  expect(you).toEqual({ consistency: 0, efficiency: 0, "win-condition": 0 });
});
