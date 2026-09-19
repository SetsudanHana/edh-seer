import { expect, test } from "vitest";
import { groupAnchor } from "./group-anchor.js";

/** ONE ID, BOTH READERS (roadmap AJ4, spec C5). */
test("an event key becomes an id a browser can jump to", () => {
  expect(groupAnchor("dies|creature|-|-")).toBe("event-dies-creature");
  expect(groupAnchor("applies:keyword-grant|creature|cleric|-")).toBe("event-applies-keyword-grant-creature-cleric");
  expect(groupAnchor("mill|-|-|-")).toBe("event-mill");
});

/** TWO DIFFERENT EVENTS MUST NOT SHARE AN ID, or the link lands on the wrong group. */
test("keys that differ give ids that differ", () => {
  const keys = ["enters|creature|-|-", "enters|creature|-|t", "enters|artifact|-|-", "leaves|creature|-|-", "leaves-graveyard|creature|-|-"];
  expect(new Set(keys.map(groupAnchor)).size).toBe(keys.length);
});
