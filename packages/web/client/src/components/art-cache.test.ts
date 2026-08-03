import { cachedImageLoad } from "./art-cache.js";

// jsdom has no image codec: `new Image()` never fires either `onload` or `onerror` for any src --
// not http, not blob: (verified empirically; neither settles even after a multi-second wait). Every
// one of these tests exercises the real `cachedImageLoad`, which decodes through a real `Image`
// internally (unlike art-loader.test.ts, which fakes the whole `load` function and never touches
// one), so without this stub every test below hangs to the vitest timeout instead of running. A
// fake that resolves on the next microtask is enough: none of these tests assert anything about
// decode success/failure, only about network and cache behaviour.
// Per-test switch (not per-instance): the tests below construct `Image` only indirectly, through
// `cachedImageLoad`, so there is no handle to configure an instance directly -- this flag is what
// a test sets before calling `load` to choose which branch the *next* decode takes.
let decodeShouldFail = false;
const RealImage = globalThis.Image;
class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(_value: string) {
    queueMicrotask(() => (decodeShouldFail ? this.onerror?.() : this.onload?.()));
  }
}
beforeAll(() => { (globalThis as unknown as { Image: unknown }).Image = FakeImage; });
afterAll(() => { (globalThis as unknown as { Image: unknown }).Image = RealImage; });
afterEach(() => { decodeShouldFail = false; });

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
  // Passing `undefined` re-triggers the same default-parameter expression as omitting the arg
  // entirely (`typeof caches !== "undefined" ? caches : undefined`), so this only pins "absent"
  // if the global itself is actually absent -- true in this Node/jsdom combo today, but not
  // something the test asserts. Stub the global away for the duration so the test proves what its
  // name claims regardless of what this environment happens to expose.
  const hadCaches = "caches" in globalThis;
  const savedCaches = (globalThis as { caches?: CacheStorage }).caches;
  delete (globalThis as { caches?: CacheStorage }).caches;
  try {
    let fetched = 0;
    const load = cachedImageLoad(async () => { fetched++; return new Response(blob()); }, undefined);
    await load("u").catch(() => {});
    expect(fetched).toBe(1);
  } finally {
    if (hadCaches) (globalThis as { caches?: CacheStorage }).caches = savedCaches;
  }
});

test("a decode failure rejects, and still revokes the object URL", async () => {
  // The one failure mode intrinsic to this file: art-loader.test.ts fakes `load` wholesale and
  // never touches a real `Image`, so it structurally cannot exercise `onerror` -> reject. Without
  // this test, wiring `onerror` to `resolve` instead of `reject` would pass every other test here.
  const revokeSpy = vi.spyOn(URL, "revokeObjectURL");
  const caches = fakeCaches();
  const load = cachedImageLoad(async () => new Response(blob()), caches);
  decodeShouldFail = true;
  await expect(load("u")).rejects.toThrow(/art decode failed/);
  expect(revokeSpy).toHaveBeenCalledTimes(1);
  revokeSpy.mockRestore();
});
