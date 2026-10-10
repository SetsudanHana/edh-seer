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

/** #1160 (reverses #1087's form): a short role LEADS the Build score, the number follows muted, and
 *  the band word is not shown -- "4.8/5 on target / 2 short" read as contradicting itself. */
test("a short role leads the Build score; the score follows muted and the band word is gone", () => {
  const c = header({ buildParents: [{ name: "Card advantage", key: "consistency", count: 12, target: 15, leaves: [] }] });
  const g = c.querySelector("[data-build-gap]") as HTMLElement;
  const score = g.parentElement!.parentElement as HTMLElement;
  expect(score.textContent).not.toContain("on target");
  expect(score.textContent).toContain("4.7/5");
  expect(score.textContent!.indexOf("3 short on card advantage")).toBeLessThan(score.textContent!.indexOf("4.7/5"));
  expect(score.querySelector(".stat-num")!.className).toContain("text-(--muted)");
  expect(gap(c)).toBe("3 short on card advantage");
});

test("with nothing short the band word shows, and the Synergy score keeps its band word", () => {
  const c = header({ buildParents: [{ name: "Ramp", key: "ramp", count: 11, target: 11, leaves: [] }] });
  expect(c.textContent).toContain("on target");
  expect(c.textContent).toContain("connected");
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
  expect(gap(c)).toBe("2 short on board wipes and 1 more");
});

/** #1087 review: the header says the role by the Roles shelf's heading, not the verdict's word. */
test("the gap uses the shelf's word for the role", () => {
  const c = header({ buildParents: [{ name: "Interaction", key: "interaction", count: 7, target: 10, leaves: [] }] });
  expect(gap(c)).toBe("3 short on interaction");
});

/** AND LEADS WITH THE ONE IMPROVE LEADS WITH: rankedFindings orders by impact, findings() by shortfall. */
test("the first role is the one Improve leads with, by impact", () => {
  const c = header({ buildParents: [
    { name: "Board wipes", count: 1, target: 3, leaves: [], impact: 0.1 },
    { name: "Card advantage", key: "consistency", count: 8, target: 15, leaves: [], impact: 0.4 },
  ] });
  expect(gap(c)).toBe("7 short on card advantage and 1 more");
});
