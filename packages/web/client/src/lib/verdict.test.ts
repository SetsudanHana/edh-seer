import { expect, test } from "vitest";
import type { DeckReport } from "../types.js";
import { verdict } from "./verdict.js";

const r = (synergyOverall: number, buildScore: number, extra: object = {}) => ({ synergyOverall, buildScore, ...extra }) as unknown as DeckReport;

test("the two scores answer as one sentence that says which is which", () => {
  expect(verdict(r(4.2, 4.6))).toBe("A well-built deck whose cards work together.");
  // The Party Time precon: "2.9 developing" beside "4.5 on target" read as two opposite grades.
  expect(verdict(r(2.9, 4.5))).toMatch(/^Well built: .* Its cards don't work with each other much yet, which is what the synergy score measures\.$/);
  expect(verdict(r(3.6, 2.4))).toMatch(/^Its cards work together well, but it is short on some basics/);
  expect(verdict(r(1.2, 1.0))).toMatch(/^Short on some basics a deck needs, and its cards don't work with each other much yet\.$/);
});

test("a partly read deck gets no verdict, and neither does a report without both scores", () => {
  expect(verdict(r(4, 4, { coverage: { resolved: 99, derived: 50 } }))).toBeNull();
  expect(verdict({ buildScore: 4 } as unknown as DeckReport)).toBeNull();
});

/** THE VERDICT NAMES THE GAPS THE SUGGESTIONS ARE ABOUT (persona round 2026-09-27: "Well built: it
 *  has the ramp, draw and answers a deck needs" sat above "You will run out of cards" on three
 *  seats' reports). Read off the same findings, so the two cannot disagree. */
test("a well-built deck that is short on a basic says which, and never claims it has them all", () => {
  const parents = [
    { name: "Card advantage", count: 9, target: 13, leaves: [] },
    { name: "Interaction", count: 10, target: 13, leaves: [] },
    { name: "Ramp", count: 11, target: 11, leaves: [] },
  ];
  expect(verdict(r(2.8, 4.3, { buildParents: parents }))).toBe(
    "Mostly well built, but short on card advantage (9 of 13) and answers (10 of 13). Its cards don't work with each other much yet, which is what the synergy score measures.");
  expect(verdict(r(4.2, 4.6, { buildParents: parents }))).toBe("A well-built deck whose cards work together, short only on card advantage (9 of 13) and answers (10 of 13).");
  // Nothing short: the claim stands.
  expect(verdict(r(2.9, 4.5, { buildParents: [parents[2]] }))).toMatch(/^Well built: it has the ramp, card advantage and answers a deck needs\./);
});

/** #1086, the Gisa and Mari reports: "short only on card draw" sat above a Roles shelf saying "Draw 11" and
 *  "Card advantage 12, aim for 15". The headline names the role the shelf names, with the shelf's numbers. */
test("a gap names its role as the Roles shelf does, with the count and target it was measured on", () => {
  const gisa = [{ name: "Card advantage", key: "consistency", count: 12, target: 15, leaves: ["draw", "cardSelection", "tutor"] }];
  expect(verdict(r(4.2, 4.6, { buildParents: gisa }))).toBe("A well-built deck whose cards work together, short only on card advantage (12 of 15).");
  const mari = [
    { name: "Board wipes", count: 0, target: 2, leaves: [] },
    { name: "Card advantage", key: "consistency", count: 9, target: 13, leaves: [] },
  ];
  expect(verdict(r(2.8, 4.3, { buildParents: mari }))).toMatch(/^Mostly well built, but short on board wipes \(0 of 2\) and card advantage \(9 of 13\)\./);
});

test("a lands gap carries the lands tile's own figures, and the basics sentence says card advantage", () => {
  const deckMath = { lands: { actual: 33, target: 37, avgManaValue: 3 } };
  expect(verdict(r(4.2, 4.6, { deckMath }))).toBe("A well-built deck whose cards work together, short only on lands (33 of 37).");
  expect(verdict(r(3.6, 2.4))).toBe("Its cards work together well, but it is short on some basics a deck needs, like ramp, card advantage or answers.");
  expect(verdict(r(2.9, 4.5))).toMatch(/^Well built: it has the ramp, card advantage and answers a deck needs\./);
});
