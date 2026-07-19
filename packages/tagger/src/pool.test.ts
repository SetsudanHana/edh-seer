import { expect, test } from "vitest";
import { mapPool } from "./pool.js";

test("preserves order and maps all items", async () => {
  const out = await mapPool([1, 2, 3, 4, 5], 2, async (n) => n * 10);
  expect(out).toEqual([10, 20, 30, 40, 50]);
});

test("caps in-flight work at the concurrency limit", async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  await mapPool(Array.from({ length: 20 }, (_, i) => i), 4, async (n) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    return n;
  });
  expect(maxInFlight).toBeLessThanOrEqual(4);
  expect(maxInFlight).toBeGreaterThan(1); // actually ran in parallel
});

test("empty input returns empty without invoking fn", async () => {
  let calls = 0;
  const out = await mapPool([], 4, async () => (calls++, 1));
  expect(out).toEqual([]);
  expect(calls).toBe(0);
});
