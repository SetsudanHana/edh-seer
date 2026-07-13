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

test("Negation: a 'can't be sacrificed' card is not a sacrifice outlet", () => {
  const tags = extractTags(FIXTURES.guardianOfFaith);
  expect(tags.produces.has("sacrifice-event")).toBe(false);
});

test("Regression: Treasure maker still pays off an artifact payoff", () => {
  const r = synergyScore(FIXTURES.dockside, FIXTURES.fireweaver);
  expect(r.reasons.some((x) => x.tag === "artifact")).toBe(true);
});

test("Regression: token maker still triggers a creature-ETB payoff", () => {
  const r = synergyScore(FIXTURES.krenko, FIXTURES.impactTremors);
  expect(r.reasons.some((x) => x.tag === "creature-etb")).toBe(true);
});
