import { expect, test } from "vitest";
import { compareThemeStats, driftReport } from "./theme-stats-fresh-core.js";

const stats = (N: number, counts: Record<string, number>) => ({ N, counts });

test("an artifact that matches the recount is fresh", () => {
  const d = compareThemeStats(stats(3, { "dies:creature": 2 }), stats(3, { "dies:creature": 2 }));
  expect(d.fresh).toBe(true);
  expect(driftReport(d)).toMatch(/^theme-stats: fresh/);
});

/** #720: every family present, a count stale -- the case the drift test cannot see. */
test("a stale count is stale, even with every family present", () => {
  const d = compareThemeStats(stats(3, { "dies:creature": 2, "enters:aura": 1 }), stats(3, { "dies:creature": 2, "enters:aura": 3 }));
  expect(d.fresh).toBe(false);
  expect(d.changed).toEqual([{ tag: "enters:aura", committed: 1, fresh: 3 }]);
});

test("missing and gone tags are named, and the biggest move leads", () => {
  const d = compareThemeStats(
    stats(10, { a: 1, b: 5, old: 2 }),
    stats(12, { a: 2, b: 9, new: 1 }),
  );
  expect(d.fresh).toBe(false);
  expect(d.n).toEqual({ committed: 10, fresh: 12 });
  expect(d.changed.map((c) => c.tag)).toEqual(["b", "a"]);
  expect(d.missing).toEqual(["new"]);
  expect(d.gone).toEqual(["old"]);
  expect(driftReport(d)).toMatch(/STALE[\s\S]*missing new[\s\S]*b: 5 -> 9[\s\S]*gone old[\s\S]*gen-theme-stats/);
});

test("a changed N alone is stale", () => {
  expect(compareThemeStats(stats(3, { a: 1 }), stats(4, { a: 1 })).fresh).toBe(false);
});
