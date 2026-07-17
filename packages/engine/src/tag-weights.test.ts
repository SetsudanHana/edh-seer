import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import type { TagStats } from "./weights.js";

const stats = JSON.parse(
  readFileSync(new URL("./tag-weights.json", import.meta.url), "utf8"),
) as TagStats;

test("committed tag-weights artifact is well-formed and non-trivial", () => {
  expect(stats.N).toBeGreaterThan(1000);
  expect(Object.keys(stats.counts).length).toBeGreaterThan(10);
});

test("artifact contains representative tags with sane counts", () => {
  // tribe:wizard should be rarer than the generic cast:sorcery tag across the corpus
  expect(stats.counts["tribe:wizard"]).toBeGreaterThan(0);
  expect(stats.counts["cast:sorcery"]).toBeGreaterThan(0);
  expect(stats.counts["cast:sorcery"]).toBeGreaterThan(stats.counts["tribe:wizard"]);
  for (const c of Object.values(stats.counts)) expect(c).toBeLessThanOrEqual(stats.N);
});
