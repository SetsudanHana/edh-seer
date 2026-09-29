import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { ReportRailSummaries } from "./ReportRail.js";
import { SAMPLE } from "../fixtures.js";

/** THE RAIL SAYS THE CHAPTER YOU ARE IN, and only that one (owner, 2026-09-29, drawer option B).
 *  All six summaries stay mounted so nothing re-mounts on scroll; `hidden` is what the reader sees,
 *  so it is what is asserted. The figures are the report's own, never recomputed. */
test("the rail shows one chapter's summary, under that chapter's name, with the report's own figures", () => {
  const { rerender } = render(<ReportRailSummaries current="roles" report={SAMPLE.report} cutCount={3} readSlot={() => {}} />);
  expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Roles");
  expect(screen.getByTestId("rail-roles")).toBeVisible();
  expect(screen.getByTestId("rail-roles")).toHaveTextContent("Ramp6 of 10");
  for (const id of ["read", "stand", "plan", "mana", "fix"]) expect(screen.getByTestId(`rail-${id}`)).not.toBeVisible();

  rerender(<ReportRailSummaries current="fix" report={SAMPLE.report} cutCount={3} readSlot={() => {}} />);
  expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("How to improve it");
  expect(screen.getByTestId("rail-fix")).toHaveTextContent("Possible cuts3");
  expect(screen.getByTestId("rail-roles")).not.toBeVisible();
});
