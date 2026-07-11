import { expect, test } from "vitest";
import { FIXTURES } from "./fixtures.js";

test("treasure maker fixture has oracle text mentioning treasure", () => {
  const c = FIXTURES.dockside;
  expect(c.name).toBe("Dockside Extortionist");
  expect(c.oracleText.toLowerCase()).toContain("treasure token");
  expect(c.typeLine).toContain("Creature");
});
