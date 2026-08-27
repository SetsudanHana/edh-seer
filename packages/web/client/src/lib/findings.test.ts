import { expect, test } from "vitest";
import { findings, slotTrade, FINDING_CAP } from "./findings.js";
import type { DeckReport } from "../types.js";

const report = (over: Partial<DeckReport>): DeckReport => ({ ...over } as DeckReport);

test("a build parent under target becomes a finding, and the shortfall is the fraction missing", () => {
  const [f] = findings(report({
    buildParents: [{ name: "Consistency", count: 6, target: 14, leaves: ["draw"] }],
  }));
  expect(f.figure).toBe("6/14");
  expect(f.shortfall).toBeCloseTo(8 / 14);
  expect(f.filled).toBeCloseTo(6 / 14);
});

test("a parent AT or OVER target is not a finding — a surplus is a trade, not a fault", () => {
  expect(findings(report({
    buildParents: [
      { name: "Board wipes", count: 2, target: 2, leaves: [] },
      { name: "Interaction", count: 15, target: 10, leaves: [] },
    ],
  }))).toEqual([]);
});

/** THE WHOLE POINT OF THE RANKING: no weight is chosen, so a bigger fraction of a target wins
 *  whatever kind of target it is. Consistency missing 8 of 14 (0.57) must outrank a colour short
 *  10 of 31 (0.32) — and mutating the sort to ascending must flip them. */
test("findings rank by fraction of target missing, across different kinds", () => {
  const rows = findings(report({
    buildParents: [{ name: "Consistency", count: 6, target: 14, leaves: [] }],
    deckMath: {
      colors: [{ color: "W", supplied: 21, worst: { pips: 4, turn: 9, required: 31, requiredRaw: 36, cards: 1 } }],
    } as DeckReport["deckMath"],
  }));
  expect(rows.map((r) => r.kind)).toEqual(["build", "colour"]);
  expect(rows[0].shortfall).toBeGreaterThan(rows[1].shortfall);
});

test("a colour that meets its own worst requirement is not a finding", () => {
  expect(findings(report({
    deckMath: {
      colors: [{ color: "B", supplied: 40, worst: { pips: 2, turn: 4, required: 22, requiredRaw: 24, cards: 3 } }],
    } as DeckReport["deckMath"],
  }))).toEqual([]);
});

/** Five thin classes are ONE finding, not five rows: the fix is one card that hits any permanent,
 *  and five near-identical rows is the wall of equal panels this list exists to replace. */
test("thin answer classes collapse into a single finding", () => {
  const rows = findings(report({
    deckMath: {
      turn: 6,
      answers: [
        { class: "creature", count: 5, required: 5, available: 0.51, exiling: 2, recurring: 0, fromCommandZone: false, pool: 1 },
        { class: "artifact", count: 2, required: 5, available: 0.25, exiling: 1, recurring: 0, fromCommandZone: false, pool: 1 },
        { class: "enchantment", count: 2, required: 5, available: 0.25, exiling: 1, recurring: 0, fromCommandZone: false, pool: 1 },
        { class: "planeswalker", count: 2, required: 5, available: 0.25, exiling: 1, recurring: 0, fromCommandZone: false, pool: 1 },
        { class: "land", count: 1, required: 5, available: 0.13, exiling: 1, recurring: 0, fromCommandZone: false, pool: 1 },
        // Hate, not removal — a Naturalize does not answer it, so it must not join the count.
        { class: "graveyard", count: 1, required: 5, available: 0.13, exiling: 0, recurring: 0, fromCommandZone: false, pool: 1 },
      ],
    } as DeckReport["deckMath"],
  }));
  expect(rows).toHaveLength(1);
  expect(rows[0].kind).toBe("answers");
  expect(rows[0].figure).toBe("13%");
  expect(rows[0].detail).not.toContain("graveyard");
});

/** THE DEFECT THE 2026-08-27 PERSONA RUN FOUND ON THE PAGE'S FOCAL ELEMENT, pinned in both
 *  directions. The headline printed "Your removal only answers creatures" on a deck holding two
 *  artifact, two enchantment and two planeswalker answers — which its OWN detail line then listed.
 *  "Only" is a claim about ZERO and is now spelled from the counts. */
const answers = (counts: Record<string, number>) => ({
  turn: 6,
  answers: Object.entries(counts).map(([cls, count]) => ({
    class: cls, count, required: 5, available: 0.25, exiling: 0, recurring: 0,
    fromCommandZone: false, pool: 1,
  })),
}) as DeckReport["deckMath"];

test("THIN is not NONE: a deck with two of each does not read as creature-only", () => {
  const [f] = findings(report({
    deckMath: answers({ creature: 5, artifact: 2, enchantment: 2, planeswalker: 2, land: 1 }),
  }));
  expect(f.headline).not.toContain("only answers creatures");
  expect(f.headline).toBe("Your answers outside creatures are thin.");
  // The detail must still list what it DOES have, and the headline must not contradict it.
  expect(f.detail).toContain("2 for artifacts");
});

test("ONLY is earned when every other class is genuinely zero", () => {
  const [f] = findings(report({
    deckMath: answers({ creature: 5, artifact: 0, enchantment: 0, planeswalker: 0, land: 0 }),
  }));
  expect(f.headline).toBe("Your removal only answers creatures.");
});

test("a partial hole is named as a hole, not generalised", () => {
  const [f] = findings(report({
    deckMath: answers({ creature: 5, artifact: 2, enchantment: 0, planeswalker: 0, land: 3 }),
  }));
  expect(f.headline).toBe("You have no answer at all for enchantments and planeswalkers.");
});

test("lands are a finding in BOTH directions", () => {
  const lands = (actual: number) => ({
    lands: { actual, target: 36, avgManaValue: 3.29, targetSource: "flat", rawTarget: 40, archetypeDelta: 0, rampPlusDraw: 6, fastMana: 0, mdfc: 0 },
  }) as DeckReport["deckMath"];
  expect(findings(report({ deckMath: lands(30) }))[0].headline).toContain("short");
  expect(findings(report({ deckMath: lands(42) }))[0].headline).toContain("more");
  expect(findings(report({ deckMath: lands(36) }))).toEqual([]);
});

test("the slot trade names the category and never a card, and stays silent with nothing short", () => {
  const r = report({
    buildParents: [{ name: "Consistency", count: 6, target: 14, leaves: [] }],
    slack: [{ category: "Interaction", count: 15, target: 10, over: 5 }],
  });
  const trade = slotTrade(r, findings(r))!;
  expect(trade).toContain("Interaction sits at 15 against a target of 10");
  // The surplus must read as a SURPLUS. "5 of those slots are the ones you need" said the opposite.
  expect(trade).toContain("5 more slots than it needs");
  expect(trade).not.toContain("are the ones you need");
  expect(slotTrade(report({ slack: [{ category: "Interaction", count: 15, target: 10, over: 5 }] }), [])).toBeNull();
});

test("the cap is a stated presentational constant, not a threshold on the data", () => {
  expect(FINDING_CAP).toBe(3);
  // Every shortfall is still RETURNED — slicing is the caller's job, so a persona re-run or the
  // CLI can read the whole list.
  expect(findings(report({
    buildParents: [
      { name: "Consistency", count: 1, target: 14, leaves: [] },
      { name: "Ramp", count: 1, target: 10, leaves: [] },
      { name: "Interaction", count: 1, target: 10, leaves: [] },
      { name: "Board wipes", count: 0, target: 3, leaves: [] },
    ],
  }))).toHaveLength(4);
});
