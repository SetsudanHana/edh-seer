import { expect, test } from "vitest";
import { eventLabel } from "./demand-sentence.js";

/** The graph's trace-event chips label a census key's VERB half. It reuses `DEMAND_VERB` rather
 *  than adding a second vocabulary — this repo has twice shipped an internal identifier rendered as
 *  English (`targetedRemoval`, `enters:type:land`), and both times the humane label already existed
 *  one file over. */
test("an event label is English, never a raw verb token", () => {
  expect(eventLabel("dies")).toBe("Dying");
  expect(eventLabel("enters")).toBe("Entering the battlefield");
});

test("a verb the map has never seen de-slugs rather than printing a token", () => {
  expect(eventLabel("bushido")).toBe("Bushido");
  expect(eventLabel("combat-damage")).not.toContain("-");
});
