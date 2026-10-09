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
