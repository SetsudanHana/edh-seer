import { cachedImageLoad } from "./art-cache.js";

// jsdom has no image codec: `new Image()` never fires either `onload` or `onerror` for any src --
// not http, not blob: (verified empirically; neither settles even after a multi-second wait). Every
// one of these tests exercises the real `cachedImageLoad`, which decodes through a real `Image`
// internally (unlike art-loader.test.ts, which fakes the whole `load` function and never touches
// one), so without this stub every test below hangs to the vitest timeout instead of running. A
// fake that resolves on the next microtask is enough: none of these tests assert anything about
// decode success/failure, only about network and cache behaviour.
const RealImage = globalThis.Image;
class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(_value: string) {
    queueMicrotask(() => this.onload?.());
  }
}
beforeAll(() => { (globalThis as unknown as { Image: unknown }).Image = FakeImage; });
afterAll(() => { (globalThis as unknown as { Image: unknown }).Image = RealImage; });

const blob = () => new Blob(["x"], { type: "image/jpeg" });

const fakeCaches = (initial: Record<string, Blob> = {}) => {
  const store = new Map(Object.entries(initial));
  const cache = {
    match: async (url: string) => (store.has(url) ? new Response(store.get(url)!) : undefined),
    put: async (url: string, res: Response) => { store.set(url, await res.blob()); },
  };
  return { open: async () => cache, store } as unknown as CacheStorage & { store: Map<string, Blob> };
};

test("a cache hit never touches the network", async () => {
  let fetched = 0;
  const caches = fakeCaches({ "u": blob() });
  const load = cachedImageLoad(async () => { fetched++; return new Response(blob()); }, caches);
  await load("u").catch(() => {});
  expect(fetched).toBe(0);
});

test("a cache miss fetches and stores the response", async () => {
  const caches = fakeCaches();
  const load = cachedImageLoad(async () => new Response(blob()), caches);
  await load("u").catch(() => {});
  expect((caches as unknown as { store: Map<string, Blob> }).store.has("u")).toBe(true);
});

test("a failed fetch rejects so the loader's retry can see it", async () => {
  const caches = fakeCaches();
  const load = cachedImageLoad(async () => { throw new Error("offline"); }, caches);
  await expect(load("u")).rejects.toThrow();
});

test("an absent Cache API degrades to a plain network load rather than throwing", async () => {
  let fetched = 0;
  const load = cachedImageLoad(async () => { fetched++; return new Response(blob()); }, undefined);
  await load("u").catch(() => {});
  expect(fetched).toBe(1);
});
