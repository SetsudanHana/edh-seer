import { expect, test } from "vitest";
import { createArtLoader } from "./art-loader.js";

const fakeImage = () => ({}) as HTMLImageElement;
const immediate = async () => {};

test("a repeated request for the same url loads it exactly once", async () => {
  let calls = 0;
  const loader = createArtLoader({ load: async () => { calls++; return fakeImage(); }, delay: immediate });
  loader.request("a"); loader.request("a"); loader.request("a");
  await new Promise((r) => setTimeout(r, 0));
  expect(calls).toBe(1);
});

test("a url is marked loading while in flight and resolves to the image", async () => {
  let release: (img: HTMLImageElement) => void;
  const loader = createArtLoader({
    load: () => new Promise((res) => { release = res; }), delay: immediate,
  });
  loader.request("a");
  expect(loader.get("a")).toBe("loading");
  release!(fakeImage());
  await new Promise((r) => setTimeout(r, 0));
  expect(loader.get("a")).not.toBe("loading");
  expect(loader.get("a")).not.toBe("error");
});

test("a failing url is retried once before it is marked dead", async () => {
  let calls = 0;
  const loader = createArtLoader({
    load: async () => { calls++; throw new Error("429"); }, delay: immediate, retries: 1,
  });
  loader.request("a");
  await new Promise((r) => setTimeout(r, 0));
  expect(calls).toBe(2);
  expect(loader.get("a")).toBe("error");
});

test("a url that succeeds on retry is not marked dead", async () => {
  let calls = 0;
  const loader = createArtLoader({
    load: async () => { if (++calls === 1) throw new Error("429"); return fakeImage(); },
    delay: immediate, retries: 1,
  });
  loader.request("a");
  await new Promise((r) => setTimeout(r, 0));
  expect(loader.get("a")).not.toBe("error");
});

test("no more than `concurrency` loads are in flight at once", async () => {
  let inFlight = 0, peak = 0;
  const releases: Array<() => void> = [];
  const loader = createArtLoader({
    concurrency: 4, delay: immediate,
    load: () => new Promise((res) => {
      inFlight++; peak = Math.max(peak, inFlight);
      releases.push(() => { inFlight--; res(fakeImage()); });
    }),
  });
  for (const u of ["a", "b", "c", "d", "e", "f", "g"]) loader.request(u);
  await new Promise((r) => setTimeout(r, 0));
  expect(peak).toBeLessThanOrEqual(4);
  releases.forEach((r) => r());
});

test("dispatches are spaced by the configured interval", async () => {
  const waits: number[] = [];
  const loader = createArtLoader({
    concurrency: 4, spacingMs: 75,
    delay: async (ms) => { waits.push(ms); },
    load: async () => fakeImage(),
  });
  loader.request("a"); loader.request("b");
  await new Promise((r) => setTimeout(r, 0));
  expect(waits).toContain(75);
});
