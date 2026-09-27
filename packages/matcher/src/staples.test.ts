import { expect, test } from "vitest";
import { loadStaples } from "./staples.js";

test("the committed staples snapshot exists, is dated, and covers the competitive staples", () => {
  const s = loadStaples();
  expect(s.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}/);
  expect(s.source).toContain("edhtop16");
  expect(Object.keys(s.cards).length).toBeGreaterThan(1000);
  for (const r of Object.values(s.cards).slice(0, 50)) { expect(r).toBeGreaterThan(0); expect(r).toBeLessThanOrEqual(1); }
});
