import { expect, test } from "vitest";
import { ROLE_PARENTS } from "./role-parents.js";
import { MIN_INDEXABLE_PARTNERS, isIndexableCard, jobOf } from "./partner-shard.js";

test("a card with a counted job is indexable without partners; a card with neither is not", () => {
  expect(isIndexableCard(0, ["ramp"])).toBe(true);
  expect(isIndexableCard(0, undefined)).toBe(false);
  expect(isIndexableCard(0, ["stax"])).toBe(false);
  expect(isIndexableCard(MIN_INDEXABLE_PARTNERS, undefined)).toBe(true);
});

test("a card with several roles is named by the first job in the report's order", () => {
  expect(jobOf(["draw", "ramp"])).toEqual({ noun: "ramp", tally: "Ramp" });
  expect(jobOf(["tutor"])).toEqual({ noun: "a tutor", tally: "Card advantage" });
  expect(jobOf([])).toBeNull();
});

/** #1168: a job's tally is the NAME of the build parent whose leaves hold the role -- read off
 *  BUILD_PARENTS, so a rename there cannot leave the sentence pointing at a row that is gone. */
test("every job's tally is the name of the parent that owns its role", async () => {
  const { BUILD_PARENTS } = await import("./build.js");
  expect(BUILD_PARENTS.map((p) => [p.name, p.key, p.leaves])).toEqual(ROLE_PARENTS.map((p) => [p.name, p.key, [...p.leaves]]));
  for (const role of ["ramp", "boardWipe", "targetedRemoval", "stackInteraction", "protection", "graveyardHate", "tutor", "draw", "cardSelection", "impulseDraw"] as const) {
    const parent = BUILD_PARENTS.find((p) => p.leaves.includes(role))!;
    expect(jobOf([role])?.tally, role).toBe(parent.name);
  }
});
