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
    // `Cache.keys()` resolves in INSERTION order, and a Map iterates the same way — which is the
    // property the trim relies on to evict oldest-first without storing timestamps. Without these
    // two the trim threw into its own best-effort catch and the double silently hid it.
    keys: async () => [...store.keys()],
    delete: async (url: string) => store.delete(url),
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

// OFFLINE still rejects, so the loader's retry can see it. Since the CORS fallback below, a thrown
// fetch no longer rejects on its own — it tries `img.src` first. That does not weaken this contract:
// offline, the image load fails too, which is what `decodeShouldFail` models here. The fallback only
// rescues the case where the NETWORK is fine and `fetch` specifically was refused (no CORS headers).
test("a failed fetch rejects so the loader's retry can see it, when the image fails too", async () => {
  decodeShouldFail = true;
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

test("a rejecting cache open on the read side still resolves via the network, fetched once", async () => {
  // Quota exhaustion / private-mode: `caches.open()` throws instead of the store simply being
  // absent. The plan's own Risks section calls this "the common case on someone's machine" -- the
  // existing absent-Cache-API test only covers `caches` being deleted from the global, not this.
  let fetched = 0;
  const caches = { open: async () => { throw new Error("quota exceeded"); } } as unknown as CacheStorage;
  const load = cachedImageLoad(async () => { fetched++; return new Response(blob()); }, caches);
  await expect(load("u")).resolves.toBeDefined();
  expect(fetched).toBe(1);
});

test("a rejecting cache write still resolves the load that produced it, fetched once", async () => {
  // Same degradation, on the write side: the read succeeds (a miss) but storing the fetched
  // response back into the cache fails. That must not fail -- or double -- a load that otherwise
  // succeeded.
  let fetched = 0;
  const cache = {
    match: async () => undefined,
    put: async () => { throw new Error("quota exceeded"); },
  };
  const caches = { open: async () => cache } as unknown as CacheStorage;
  const load = cachedImageLoad(async () => { fetched++; return new Response(blob()); }, caches);
  await expect(load("u")).resolves.toBeDefined();
  expect(fetched).toBe(1);
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

// THE CACHE IS BOUNDED. Unbounded, entries accumulated for the life of the browser profile, and
// quota eviction when it came could take the WHOLE bucket rather than the oldest slice — turning a
// gentle miss into "every card you have ever seen is gone offline".
test("writing past the cap trims the oldest entries and keeps the newest", async () => {
  const caches = fakeCaches();
  const load = cachedImageLoad(async () => new Response(blob()), caches);
  for (let i = 0; i < 505; i++) await load(`u${i}`).catch(() => {});
  const store = (caches as unknown as { store: Map<string, Blob> }).store;
  expect(store.size).toBe(500);
  expect(store.has("u0")).toBe(false);
  expect(store.has("u504")).toBe(true);
});

// A version bump renames the bucket, so bumping CACHE_NAME should be self-cleaning rather than
// leaving the old copy on disk forever.
test("an earlier-versioned bucket is deleted", async () => {
  const caches = fakeCaches();
  const deleted: string[] = [];
  const withNames = {
    ...caches,
    keys: async () => ["mtg-art-v0", "mtg-art-v1", "something-else"],
    delete: async (n: string) => { deleted.push(n); return true; },
  } as unknown as CacheStorage;
  const load = cachedImageLoad(async () => new Response(blob()), withNames);
  await load("u").catch(() => {});
  expect(deleted).toEqual(["mtg-art-v0"]);
});

// CORS FALLBACK. Art loads through `fetch` so the bytes can be cached for offline, and a
// cross-origin `fetch` needs CORS headers. Scryfall sends them today; if it ever stops, every card
// silently degrades to a dot with no recovery path. A plain `img.src` needs no CORS to RENDER — it
// only taints the canvas, and nothing in this client reads pixels back (no getImageData, toDataURL
// or toBlob anywhere), so the taint costs nothing.
test("a fetch the network refuses still renders through img.src", async () => {
  const load = cachedImageLoad(async () => { throw new TypeError("Failed to fetch"); }, undefined);
  await expect(load("u")).resolves.toBeDefined();
});

// The fallback must not paper over a DECODE failure: the bytes arrived and are not an image, so
// there is nothing to fall back TO, and the loader's own retry path should see the rejection.
test("a decode failure still rejects rather than falling back", async () => {
  decodeShouldFail = true;
  const load = cachedImageLoad(async () => new Response(blob()), undefined);
  await expect(load("u")).rejects.toThrow();
});

// A non-ok RESPONSE is the server answering "no" — a 404 on a card with no art. Retrying the same
// URL through a second path would just fail again, so it rejects on the first answer.
test("a 404 rejects without a second attempt", async () => {
  let fetched = 0;
  const load = cachedImageLoad(async () => { fetched++; return new Response("", { status: 404 }); }, undefined);
  await expect(load("u")).rejects.toThrow();
  expect(fetched).toBe(1);
});
