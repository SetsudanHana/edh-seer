import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { expect, test } from "vitest";
import { ReportHeader } from "./ReportHeader.js";
import type { AnalyzeResponse } from "../types.js";

const header = (extra: object) => {
  const data = { report: { cards: [], synergyOverall: 3, buildScore: 4.7, ...extra } } as unknown as AnalyzeResponse;
  return render(<MemoryRouter><ReportHeader data={data} /></MemoryRouter>).container;
};
const gap = (c: HTMLElement) => c.querySelector("[data-build-gap]")?.textContent ?? null;

/** #1087, Gisa: card advantage 12 of 15 and the header said only "on target". The band word stays
 *  the score's; the gap is added in the Roles shelf's words. */
test("the Build score names the first short role and how far short", () => {
  const c = header({ buildParents: [{ name: "Card advantage", key: "consistency", count: 12, target: 15, leaves: [] }] });
  expect(c.textContent).toContain("on target");
  expect(gap(c)).toBe("· 3 short on card advantage");
});

test("a deck with no short role adds nothing to the Build score", () => {
  const c = header({ buildParents: [{ name: "Ramp", key: "ramp", count: 11, target: 11, leaves: [] }] });
  expect(gap(c)).toBeNull();
});

test("two short roles say the first and count the rest, in findings order", () => {
  const c = header({ buildParents: [
    { name: "Board wipes", count: 0, target: 2, leaves: [] },
    { name: "Card advantage", key: "consistency", count: 9, target: 13, leaves: [] },
  ] });
  expect(gap(c)).toBe("· 2 short on board wipes and 1 more");
});

/** #1087 review: the header says the role by the Roles shelf's heading, not the verdict's word. */
test("the gap uses the shelf's word for the role", () => {
  const c = header({ buildParents: [{ name: "Interaction", key: "interaction", count: 7, target: 10, leaves: [] }] });
  expect(gap(c)).toBe("\u00b7 3 short on interaction");
});

/** AND LEADS WITH THE ONE IMPROVE LEADS WITH: rankedFindings orders by impact, findings() by shortfall. */
test("the first role is the one Improve leads with, by impact", () => {
  const c = header({ buildParents: [
    { name: "Board wipes", count: 1, target: 3, leaves: [], impact: 0.1 },
    { name: "Card advantage", key: "consistency", count: 8, target: 15, leaves: [], impact: 0.4 },
  ] });
  expect(gap(c)).toBe("\u00b7 7 short on card advantage and 1 more");
});
