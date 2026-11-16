import { readdirSync } from "node:fs";
import { expect, test } from "vitest";
import { CALIBRATION_DECKS } from "@edh-seer/data";
import { DERIVE_VERSION } from "@edh-seer/tagger";
import { isOwnThemeTag } from "./axis.js";
import { computeRelationStats, loadRelationStats } from "./relation-stats.js";

test("a deck counts once however many reasons carry the tag, and only own-theme tags are counted", () => {
  const s = computeRelationStats([["tutor:creature", "tutor:creature", "fodder:creature"], ["tutor:creature", "doubles:enters"], []], 7);
  expect(s).toEqual({ N: 3, counts: { "doubles:enters": 1, "tutor:creature": 2 }, deriveVersion: 7 });
});

// The committed artifact goes stale silently, as theme-stats.json did (theme-stats-drift.test.ts): an absent tag
// clamps to the rarest observed one. This reads only committed files, so it runs in CI with no database.
test("the committed relation stats were generated at the current derive version over every calibration deck (regenerate: npm run gen:relation-stats -w @edh-seer/matcher)", () => {
  const s = loadRelationStats();
  expect(s.deriveVersion).toBe(DERIVE_VERSION);
  expect(s.N).toBe(readdirSync(CALIBRATION_DECKS).filter((f) => f.endsWith(".txt")).length);
  expect(Object.keys(s.counts).length).toBeGreaterThan(0);
  for (const [tag, n] of Object.entries(s.counts)) {
    expect(isOwnThemeTag(tag), tag).toBe(true);
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(s.N);
  }
});
