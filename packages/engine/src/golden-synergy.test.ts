import { expect, test } from "vitest";
import { synergyScore } from "./synergy.js";
import { extractTags } from "./tags.js";
import { FIXTURES } from "./fixtures.js";

test("Goblin tribal: chieftain + recruiter synergize on tribe:goblin", () => {
  const r = synergyScore(FIXTURES.goblinChieftain, FIXTURES.goblinRecruiter);
  expect(r.score).toBeGreaterThan(0);
  expect(r.reasons.some((x) => x.tag === "tribe:goblin")).toBe(true);
});

test("Spellslinger: Lightning Bolt + Archmage Emeritus synergize on cast:instant", () => {
  const r = synergyScore(FIXTURES.lightningBolt, FIXTURES.archmageEmeritus);
  expect(r.reasons.some((x) => x.tag === "cast:instant")).toBe(true);
});

test("Negation: negated 'sacrifice a creature' clause is not a sacrifice outlet (a real outlet still is)", () => {
  // plan case: an unrelated non-sacrifice card is not tagged
  expect(extractTags(FIXTURES.guardianOfFaith).produces.has("sacrifice-event")).toBe(false);
  // the real matcher needle "sacrifice a creature" sits inside a negated ("can't") clause,
  // so hasClause's negation-skip must keep it from being tagged as a sacrifice outlet
  expect(extractTags(FIXTURES.sacImmunity).produces.has("sacrifice-event")).toBe(false);
  // positive control: the same needle un-negated DOES produce the tag,
  // proving the needle is real and the test above is meaningful
  expect(extractTags(FIXTURES.ashnods).produces.has("sacrifice-event")).toBe(true);
});

test("Regression: Treasure maker still pays off an artifact payoff", () => {
  const r = synergyScore(FIXTURES.dockside, FIXTURES.fireweaver);
  expect(r.reasons.some((x) => x.tag === "artifact")).toBe(true);
});

test("Regression: token maker still triggers a creature-ETB payoff", () => {
  const r = synergyScore(FIXTURES.krenko, FIXTURES.impactTremors);
  expect(r.reasons.some((x) => x.tag === "creature-etb")).toBe(true);
});

test("Graveyard: self-mill + reanimator synergize on graveyard", () => {
  const r = synergyScore(FIXTURES.stitchersSupplier, FIXTURES.gravedigger);
  expect(r.score).toBeGreaterThan(0);
  expect(r.reasons.some((x) => x.tag === "graveyard")).toBe(true);
});

test("Lifegain: source + payoff synergize on lifegain", () => {
  const r = synergyScore(FIXTURES.soulWarden, FIXTURES.archangelOfThune);
  expect(r.score).toBeGreaterThan(0);
  expect(r.reasons.some((x) => x.tag === "lifegain")).toBe(true);
});

test("Blink: flicker spell + own-ETB value creature synergize on blink", () => {
  const r = synergyScore(FIXTURES.ephemerate, FIXTURES.mulldrifter);
  expect(r.score).toBeGreaterThan(0);
  expect(r.reasons.some((x) => x.tag === "blink")).toBe(true);
});

test("Enchantress: an enchantment + a cast-enchantment payoff synergize on enchantment", () => {
  const r = synergyScore(FIXTURES.wildGrowth, FIXTURES.enchantressPresence);
  expect(r.score).toBeGreaterThan(0);
  expect(r.reasons.some((x) => x.tag === "enchantment")).toBe(true);
});

test("Equipment: an Equipment + an equipment payoff synergize on equipment", () => {
  const r = synergyScore(FIXTURES.bonesplitter, FIXTURES.puresteelPaladin);
  expect(r.score).toBeGreaterThan(0);
  expect(r.reasons.some((x) => x.tag === "equipment")).toBe(true);
});

test("Counters: a Modular creature + a proliferate card synergize on +1/+1 counters", () => {
  const r = synergyScore(FIXTURES.arcboundRavager, FIXTURES.evolutionSage);
  expect(r.score).toBeGreaterThan(0);
  expect(r.reasons.some((x) => x.tag === "counter:+1/+1")).toBe(true);
});

test("Attack-matters: an attacker-trigger creature + Isshin synergize on attack-trigger", () => {
  const r = synergyScore(FIXTURES.goblinRabblemaster, FIXTURES.isshin);
  expect(r.score).toBeGreaterThan(0);
  expect(r.reasons.some((x) => x.tag === "attack-trigger")).toBe(true);
});

test("Graveyard-recursion: an Unearth creature + a self-mill card synergize on graveyard", () => {
  const r = synergyScore(FIXTURES.anathemancer, FIXTURES.stitchersSupplier);
  expect(r.score).toBeGreaterThan(0);
  expect(r.reasons.some((x) => x.tag === "graveyard")).toBe(true);
});
