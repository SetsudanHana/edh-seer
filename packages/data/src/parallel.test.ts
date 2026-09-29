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
