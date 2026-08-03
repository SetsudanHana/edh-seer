/** Card art that survives going offline.
 *
 *  NOT a speed optimisation: `Image()` already uses the browser's HTTP cache, and Scryfall sends
 *  long-lived cache headers, so reload-without-refetch already worked before this file existed.
 *  What did not work was OFFLINE: art already seen vanished the moment the network went away,
 *  which is the one place this build failed the project's offline-first principle.
 *
 *  `fetchImpl` and `cacheStorage` are injected so tests need neither a network nor a real
 *  CacheStorage. */
// ponytail: no eviction and no version-bump cleanup -- entries accumulate in origin storage for
// the life of the browser profile, and once quota eviction kicks in it can take the whole
// `mtg-art-v1` bucket rather than just the oldest entries. Add an eviction policy (LRU count/size
// cap, or a `caches.delete()` of old-versioned names on startup once this bumps to `mtg-art-v2`)
// if unbounded growth or quota eviction turns out to matter in practice.
const CACHE_NAME = "mtg-art-v1";

export function cachedImageLoad(
  fetchImpl: typeof fetch = fetch,
  cacheStorage: CacheStorage | undefined = typeof caches !== "undefined" ? caches : undefined,
): (url: string) => Promise<HTMLImageElement> {
  return async (url: string): Promise<HTMLImageElement> => {
    let blob: Blob | undefined;
    // Held across the read and write phases below so a successful `open()` is reused instead of
    // repeated -- the two phases still fail independently (a read failure must not skip the
    // write attempt), this just avoids asking the Cache API to open the same store twice.
    let cache: Cache | undefined;

    // Cache read is best-effort and isolated from the network fetch below: the Cache API is
    // absent in some real contexts (private browsing, non-secure origins) and can fail even when
    // present (quota, storage errors). Either way this must fall through to a plain network load
    // rather than take the whole card down -- a cache failure must never be fatal.
    if (cacheStorage) {
      try {
        cache = await cacheStorage.open(CACHE_NAME);
        const hit = await cache.match(url);
        if (hit) blob = await hit.blob();
      } catch {
        cache = undefined; // Fall through to the network fetch below.
      }
    }

    if (!blob) {
      // Deliberately outside the try/catch above: a network failure here must reject once and
      // propagate to the ArtLoader's own retry/error path, not be swallowed and re-attempted
      // inline -- that would double every fetch on the exact path (offline) this file exists for.
      const res = await fetchImpl(url);
      if (!res.ok) throw new Error(`art fetch failed: ${res.status}`);
      // Clone before reading: a Response body can only be consumed once, and the cache write
      // below must not race the read that produces the image.
      const toCache = cacheStorage ? res.clone() : null;
      blob = await res.blob();
      if (cacheStorage && toCache) {
        try {
          (cache ??= await cacheStorage.open(CACHE_NAME));
          await cache.put(url, toCache);
        } catch {
          // Storing is best-effort too: a write failure (quota, private mode) must not fail a
          // load that otherwise succeeded.
        }
      }
    }

    const objectUrl = URL.createObjectURL(blob);
    try {
      return await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`art decode failed: ${url}`));
        img.src = objectUrl;
      });
    } finally {
      // Runs after the image has decoded (the `await` above doesn't return until onload/onerror
      // fires), so revoking here is safe -- the decoded image keeps its own copy. Holding the
      // object URL instead would leak one blob per card for the life of the page.
      URL.revokeObjectURL(objectUrl);
    }
  };
}
