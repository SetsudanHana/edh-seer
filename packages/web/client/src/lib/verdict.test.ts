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
