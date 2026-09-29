import { expect, test } from "vitest";
import { mapInWorkers } from "./parallel.js";

const worker = new URL("./fixtures/square-worker.ts", import.meta.url);

test("results come back in INPUT order, whatever order the workers finish in", async () => {
  const items = Array.from({ length: 40 }, (_, i) => i);
  const out = await mapInWorkers<number, { n: number; thread: number }>(items, worker, { workers: 4 });
  expect(out.map((o) => o.n)).toEqual(items.map((i) => i * i));
  // The work really was spread: more than one worker thread answered.
  expect(new Set(out.map((o) => o.thread)).size).toBeGreaterThan(1);
});

test("a worker's error fails the whole map, naming the item", async () => {
  await expect(mapInWorkers([1, 2, -3, 4], worker, { workers: 2 })).rejects.toThrow(/negative: -3/);
});

test("an empty input spawns nothing and returns nothing", async () => {
  expect(await mapInWorkers([], worker)).toEqual([]);
});

test("zero workers still runs (at least one is started)", async () => {
  expect((await mapInWorkers<number, { n: number }>([3], worker, { workers: 0 })).map((o) => o.n)).toEqual([9]);
});

test("a pool keeps its workers: a broadcast reaches every worker before the next map", async () => {
  const { createPool } = await import("./parallel.js");
  const pool = createPool<number, number>(new URL("./fixtures/scale-worker.ts", import.meta.url), { workers: 3 });
  try {
    expect(await pool.map([1, 2, 3, 4])).toEqual([1, 2, 3, 4]);
    await pool.broadcast({ factor: 10 });
    expect(await pool.map([1, 2, 3, 4, 5, 6])).toEqual([10, 20, 30, 40, 50, 60]);
  } finally {
    await pool.close();
  }
});

test("a NaN worker count is the default, not a pool with no workers", async () => {
  expect((await mapInWorkers<number, { n: number }>([2, 3], worker, { workers: Number.NaN })).map((o) => o.n)).toEqual([4, 9]);
});
