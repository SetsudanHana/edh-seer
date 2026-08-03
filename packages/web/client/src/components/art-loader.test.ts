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
  const img = fakeImage();
  release!(img);
  await new Promise((r) => setTimeout(r, 0));
  expect(loader.get("a")).not.toBe("loading");
  // Not just "not error": `undefined` also satisfies `not.toBe("error")`, so this passed even if
  // the resolved image was never stored. Assert the actual image landed.
  expect(loader.get("a")).toBe(img);
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
  const img = fakeImage();
  const loader = createArtLoader({
    load: async () => { if (++calls === 1) throw new Error("429"); return img; },
    delay: immediate, retries: 1,
  });
  loader.request("a");
  await new Promise((r) => setTimeout(r, 0));
  // `not.toBe("error")` is satisfied by `undefined` too -- this passed even if the retry's
  // successful result was never stored. Assert the actual image landed.
  expect(loader.get("a")).toBe(img);
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
  // `toBeLessThanOrEqual(4)` passes at peak === 1 too -- a loader that serialised every load
  // instead of running 4 concurrently would read green. Assert the cap is actually reached.
  expect(peak).toBe(4);
  releases.forEach((r) => r());
});

test("a dispatch does not fire until the spacing delay for the previous one resolves", async () => {
  // A controllable delay -- not a spy that just records the ms argument -- because the property
  // that matters is *gating*: does the next load wait for this one to resolve, not merely "was
  // delay(75) called somewhere". A spy-only test can't tell "spaced before every dispatch" apart
  // from "called once at the wrong point" (e.g. only before the first, or only after the last) --
  // both would still record a 75 without ever gating a dispatch.
  let calls = 0;
  let releaseDelay: (() => void) | undefined;
  const loader = createArtLoader({
    concurrency: 4, spacingMs: 75,
    delay: () => new Promise<void>((res) => { releaseDelay = res; }),
    load: async () => { calls++; return fakeImage(); },
  });
  loader.request("a"); loader.request("b");
  await new Promise((r) => setTimeout(r, 0));
  expect(calls).toBe(1); // "b" must not dispatch while "a"'s spacing delay is still pending
  releaseDelay!();
  await new Promise((r) => setTimeout(r, 0));
  expect(calls).toBe(2); // resolving it releases exactly the next dispatch
});
