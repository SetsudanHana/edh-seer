import { expect, test } from "vitest";
import fixtures from "./same-job.fixtures.json" with { type: "json" };
import labelCards from "./same-job.labels.cards.json" with { type: "json" };
import labelSet from "./same-job.labels.json" with { type: "json" };
import { ingredients, rolesOfCard } from "./quality.js";
import { effectsOf, groupKey, sameGroup, sameJob } from "./same-job.js";
import type { DeckCard } from "./types.js";

/** Cards as the corpus derives them (tags read 2026-10-02). */
const card = (name: keyof typeof fixtures) => fixtures[name] as unknown as DeckCard;

test("one shared role label is not the same job: taking an opponent out is not giving yourself hexproof", () => {
  const reproach = card("Teferi's Reproach");
  const calm = card("Blossoming Calm");
  expect(rolesOfCard(reproach)).toContain("protection");
  expect(rolesOfCard(calm)).toContain("protection");
  expect([...effectsOf(reproach, "protection")]).not.toEqual([...effectsOf(calm, "protection")]);
  expect(sameJob(reproach, calm, "protection")).toBe(false);
});

test("protecting you is not protecting your permanents, though both read as a bare keyword grant", () => {
  const calm = card("Blossoming Calm");
  const heroic = card("Heroic Intervention");
  expect(effectsOf(calm, "protection")).toContain("protects|you");
  expect(effectsOf(heroic, "protection")).toContain("protects|permanents");
  expect(sameJob(heroic, calm, "protection")).toBe(false);
  // THE GRANT'S KEYWORDS ARE PART OF THE KEY (S-T1, 2026-10-06): read from the grammar, so the card
  // is the same job as itself and still not Blossoming Calm.
  expect(groupKey(heroic, "protection")).toMatch(/hexproof/);
  expect(sameJob(heroic, heroic, "protection")).toBe(true);
});

/** THE GROUP KEY IS THE JOB (S-T2): a readable card is the same job as itself, and the parts the
 *  stored tags lost -- a condition, a limit on what it hits -- keep cards apart. */
test("a card read completely is in its own group", () => {
  const signet = card("Arcane Signet");
  expect(groupKey(signet, "ramp")).not.toBeNull();
  expect(sameJob(signet, signet, "ramp")).toBe(true);
});

test("a removal spell whose victim puts a permanent onto the battlefield gives the opponent something back", () => {
  expect(ingredients(card("Wild Magic Surge"), "targetedRemoval").drawback).toBe(1);
  expect(ingredients(card("Stroke of Midnight"), "targetedRemoval").drawback).toBe(1);
});

test("a Game Changer is in a rock's group though not its job: Mana Vault does not untap, Mox Diamond costs a land", () => {
  const signet = card("Arcane Signet");
  for (const gc of [card("Mana Vault"), card("Mox Diamond")]) {
    expect(sameJob(signet, gc, "ramp")).toBe(false);
    expect(sameGroup(signet, gc, "ramp")).toBe(true);
  }
  expect(sameJob(card("Painful Truths"), card("Rhystic Study"), "draw")).toBe(false);
  expect(sameGroup(card("Painful Truths"), card("Rhystic Study"), "draw")).toBe(true);
});

test("the group still keeps the kind of job: taking an opponent out is not giving yourself hexproof, and removal is not ramp", () => {
  expect(sameGroup(card("Teferi's Reproach"), card("Blossoming Calm"), "protection")).toBe(false);
  expect(sameGroup(card("Stroke of Midnight"), card("Mana Vault"), "ramp")).toBe(false);
});

test("trading a land for a land is not ramp: Crop Rotation is not in Cultivate's group", () => {
  expect(rolesOfCard(card("Crop Rotation"))).toContain("ramp");
  expect(sameGroup(card("Cultivate"), card("Crop Rotation"), "ramp")).toBe(false);
});

/** G1, THE SAME-JOB GATE, IN THE SUITE (S-T2, docs/plans/2026-10-04-same-job-review.md): over the
 *  owner's second reading of the labelled pairs, at least 90% of the pairs `sameJob` puts together
 *  are labelled same, and no pair labelled different is put together. Measured 2026-10-06: 9 of 10
 *  together are same, 0 different (the old rules: 11 of 61, 39 different). Cards as the static build
 *  resolves them (`research/matcher/dump-same-job-label-cards.ts`). A ratchet both ways: the purity
 *  floor, and the count of same pairs found may not fall below what is banked. */
test("G1: the pairs the group key puts together are the owner's same pairs", () => {
  const labels = labelSet.pairs as { role: string; out: string; in: string; label: string; excluded?: boolean }[];
  const cards = labelCards as unknown as Record<string, DeckCard>;
  const live = labels.filter((p) => !p.excluded);
  const together = live.filter((p) => sameJob(cards[p.out]!, cards[p.in]!, p.role as never));
  const same = together.filter((p) => p.label === "same").length;
  expect(together.filter((p) => p.label === "different").map((p) => `${p.out} -> ${p.in}`)).toEqual([]);
  expect(same / together.length).toBeGreaterThanOrEqual(0.9);
  expect(same).toBeGreaterThanOrEqual(9);
});
