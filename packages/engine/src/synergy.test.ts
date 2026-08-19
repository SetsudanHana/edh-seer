import { expect, test } from "vitest";
import { synergyScore, dedupeReasonsByText } from "./synergy.js";
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

// ONE TRIGGER WITH A CHAIN OF EFFECTS IS ONE SENTENCE TO A READER, and the reason OBJECTS survive on
// purpose: `effectKind` is load-bearing for archetype detection, so Archon of Cruelty's six must not
// be merged. The dedupe belongs at the reader. Measured: Bontu's Monument printed "triggers on a
// creature being cast" three times for each of three partners in the CLI -- nine rows where three
// belong -- while the graph wire had deduped since it shipped.
test("dedupeReasonsByText keeps the FIRST of each sentence and drops the repeats", () => {
  const r = (text: string, effectKind: string) => ({ tag: "cast:creature", text, effectKind });
  const out = dedupeReasonsByText([
    r("Bontu's Monument triggers on a creature being cast; Burakos supplies it", "drain"),
    r("Bontu's Monument triggers on a creature being cast; Burakos supplies it", "lifegain"),
    r("Bontu's Monument triggers on a creature being cast; Burakos supplies it", "player-life-loss"),
    r("Bontu's Monument reduces what Burakos costs", "cost-reduction"),
  ]);
  expect(out).toHaveLength(2);
  // FIRST, not last -- the kept object is the one the ranking already saw.
  expect(out[0].effectKind).toBe("drain");
  expect(out[1].effectKind).toBe("cost-reduction");
});

test("dedupeReasonsByText leaves distinct sentences and an empty list alone", () => {
  const r = (text: string) => ({ tag: "t", text });
  expect(dedupeReasonsByText([r("a"), r("b")])).toHaveLength(2);
  expect(dedupeReasonsByText([])).toEqual([]);
});
