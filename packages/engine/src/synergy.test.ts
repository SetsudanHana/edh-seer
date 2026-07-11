import { expect, test } from "vitest";
import { synergyScore } from "./synergy.js";
import { FIXTURES } from "./fixtures.js";

test("Krenko + Impact Tremors synergize via creature-etb (tokens entering)", () => {
  const r = synergyScore(FIXTURES.krenko, FIXTURES.impactTremors);
  expect(r.score).toBeGreaterThan(0);
  const tags = r.reasons.map((x) => x.tag);
  expect(tags).toContain("creature-etb");
  // Reason is human-readable and names both cards.
  const reason = r.reasons.find((x) => x.tag === "creature-etb")!;
  expect(reason.text).toContain("Krenko, Mob Boss");
  expect(reason.text).toContain("Impact Tremors");
});

test("Dockside + Reckless Fireweaver synergize via artifact", () => {
  const r = synergyScore(FIXTURES.dockside, FIXTURES.fireweaver);
  expect(r.reasons.map((x) => x.tag)).toContain("artifact");
});

test("two unrelated cards score 0 with no reasons", () => {
  const r = synergyScore(FIXTURES.divination, FIXTURES.swordsToPlowshares);
  expect(r.score).toBe(0);
  expect(r.reasons).toEqual([]);
});
