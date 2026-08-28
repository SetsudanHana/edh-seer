/** Card art that survives going offline.
 *
 *  NOT a speed optimisation: `Image()` already uses the browser's HTTP cache, and Scryfall sends
 *  long-lived cache headers, so reload-without-refetch already worked before this file existed.
 *  What did not work was OFFLINE: art already seen vanished the moment the network went away,
 *  which is the one place this build failed the project's offline-first principle.
 *
 *  `fetchImpl` and `cacheStorage` are injected so tests need neither a network nor a real
 *  CacheStorage. */
const CACHE_NAME = "mtg-art-v1";

/** Entries kept before the oldest are trimmed. Card art runs ~50-80KB for an `art_crop` and
 *  ~100-150KB for a `normal`, so 500 is roughly 40-70MB — several decks' worth of browsing, and far
 *  enough under a typical origin quota that the browser never has to make the choice itself.
 *
 *  That last part is the point. Left unbounded, entries accumulated for the life of the browser
 *  profile and quota eviction, when it came, could take the WHOLE bucket rather than the oldest
 *  slice — turning a gentle miss into "every card you have ever seen is gone offline". */
const MAX_ENTRIES = 500;

/** Trim to `MAX_ENTRIES`, oldest first, and drop any earlier-versioned bucket.
 *
 *  `Cache.keys()` resolves in INSERTION order, which is what makes oldest-first possible without
 *  storing timestamps alongside every entry. It is insertion order and not use order, so this is
 *  FIFO rather than a true LRU: re-viewing a card does not refresh its place in the queue.
 *  CEILING: FIFO, not LRU — a card viewed once on day one is evicted before one never viewed
 *  since, which only matters if a user works far past 500 cards in one profile; store a `put`
 *  timestamp per entry and sort on it if that shows up in practice.
 *
 *  Best-effort throughout, like every other cache operation here: a trim that fails must never fail
 *  the load that triggered it. */
async function trim(cache: Cache, cacheStorage: CacheStorage): Promise<void> {
  try {
    // A version bump renames the bucket, so anything else named `mtg-art-*` is a previous version's
    // and is dead weight. Cheap to check here and it means bumping CACHE_NAME is self-cleaning.
    if (typeof cacheStorage.keys === "function") {
      for (const name of await cacheStorage.keys()) {
        if (name.startsWith("mtg-art-") && name !== CACHE_NAME) await cacheStorage.delete(name);
      }
    }
    const keys = await cache.keys();
    // Guarded, because `slice(0, negative)` means "all but the last n" rather than "nothing": under
    // the cap that reading evicts almost the whole cache on every single write, which is the
    // opposite of the job. Caught by the cap test, which saw 249 entries survive instead of 500.
    const excess = keys.length - MAX_ENTRIES;
    if (excess > 0) for (const req of keys.slice(0, excess)) await cache.delete(req);
  } catch {
    // Storage errors are not this load's problem.
  }
}

/** Decode a URL into an image. Used for both the blob: URL of a cached/fetched body and, when the
 *  fetch itself is refused, the remote URL directly. `label` is what an error names, so a
 *  fallback's failure still points at the card rather than at an opaque blob handle. */
function decode(src: string, label = src): Promise<HTMLImageElement> {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`art decode failed: ${label}`));
    img.src = src;
  });
}

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
      // A REFUSED fetch is not the same as a refusing SERVER. `fetch` across origins needs CORS
      // headers; Scryfall sends them today, and if it ever stops, every card silently degrades to a
      // dot with no recovery path. A plain `img.src` needs no CORS to RENDER — it only taints the
      // canvas, and nothing in this client reads pixels back (no getImageData, toDataURL or toBlob
      // anywhere), so the taint costs nothing. The image cannot be cached that way, so offline
      // stops working for cards loaded through here — degraded, which beats absent.
      //
      // Only a THROWN fetch takes this path. A non-ok response is the server answering "no" (a 404
      // on a card with no art) and retrying the same URL through a second path would just fail
      // again, so it rejects on the first answer and the ArtLoader's retry logic governs. Offline
      // reaches the fallback too and fails there in turn, which costs one extra rejected image load
      // per attempt rather than a second network round trip.
      let res: Response;
      try {
        res = await fetchImpl(url);
      } catch {
        return await decode(url);
      }
      if (!res.ok) throw new Error(`art fetch failed: ${res.status}`);
      // Clone before reading: a Response body can only be consumed once, and the cache write
      // below must not race the read that produces the image.
      const toCache = cacheStorage ? res.clone() : null;
      blob = await res.blob();
      if (cacheStorage && toCache) {
        try {
          (cache ??= await cacheStorage.open(CACHE_NAME));
          await cache.put(url, toCache);
          await trim(cache, cacheStorage);
        } catch {
          // Storing is best-effort too: a write failure (quota, private mode) must not fail a
          // load that otherwise succeeded.
        }
      }
    }

    const objectUrl = URL.createObjectURL(blob);
    try {
      return await decode(objectUrl, url);
    } finally {
      // Runs after the image has decoded (the `await` above doesn't return until onload/onerror
      // fires), so revoking here is safe -- the decoded image keeps its own copy. Holding the
      // object URL instead would leak one blob per card for the life of the page.
      URL.revokeObjectURL(objectUrl);
    }
  };
}
