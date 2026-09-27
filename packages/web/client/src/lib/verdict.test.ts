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
    { name: "Consistency", count: 9, target: 13, leaves: [] },
    { name: "Interaction", count: 10, target: 13, leaves: [] },
    { name: "Ramp", count: 11, target: 11, leaves: [] },
  ];
  expect(verdict(r(2.8, 4.3, { buildParents: parents }))).toBe(
    "Mostly well built, but short on card draw and answers. Its cards don't work with each other much yet, which is what the synergy score measures.");
  expect(verdict(r(4.2, 4.6, { buildParents: parents }))).toBe("A well-built deck whose cards work together, short only on card draw and answers.");
  // Nothing short: the claim stands.
  expect(verdict(r(2.9, 4.5, { buildParents: [parents[2]] }))).toMatch(/^Well built: it has the ramp, draw and answers a deck needs\./);
});
