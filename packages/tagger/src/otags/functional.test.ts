import { expect, test } from "vitest";
import { loadFunctionalOtags } from "./functional.js";

test("functional otag list is a non-empty deduped slug array covering the core families", () => {
  const slugs = loadFunctionalOtags();
  expect(slugs.length).toBeGreaterThan(30);
  expect(new Set(slugs).size).toBe(slugs.length); // deduped
  for (const s of ["creaturefall", "death-trigger", "sacrifice-outlet-creature", "landfall", "cast-trigger"]) {
    expect(slugs).toContain(s);
  }
});
