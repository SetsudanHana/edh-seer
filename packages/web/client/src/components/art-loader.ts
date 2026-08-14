/** Concurrency-capped, spaced, retrying image loader for card art.
 *
 *  Extracted from GraphView's effect closure so it can be tested at all: the previous version fired
 *  8 unspaced concurrent requests at scryfall.io and wrote a PERMANENT "error" on the first failure,
 *  so a single rate-limit response left that card a dot for the rest of the session. Scryfall's own
 *  guidance is 50-100ms between requests.
 *
 *  `load` and `delay` are injected so tests need neither a network nor a real `Image`. */
export type ArtState = HTMLImageElement | "loading" | "error";

export interface ArtLoader {
  /** Current state for a URL, or undefined if never requested. */
  get(url: string): ArtState | undefined;
  /** Request a URL. Idempotent: safe to call every animation frame.
   *
   *  `urgent` jumps the queue. The queue is FIFO and dispatches are SPACED (75ms), so a 95-card
   *  deck takes ~7 seconds to dispatch whatever it asked for first — and the card a user zooms into
   *  is asked for LAST, behind all 95 discs. Owner-reported: "when I zoom in I still have to wait
   *  for everything to load". Spacing is Scryfall's own guidance and stays; what changes is which
   *  request gets the next slot. */
  request(url: string, urgent?: boolean): void;
}

export interface ArtLoaderOptions {
  concurrency?: number;
  spacingMs?: number;
  retries?: number;
  /** Injected so tests need no network and no real Image. Resolves on load, rejects on failure. */
  load: (url: string) => Promise<HTMLImageElement>;
  /** Injected so tests control time. Defaults to setTimeout. */
  delay?: (ms: number) => Promise<void>;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function createArtLoader(options: ArtLoaderOptions): ArtLoader {
  const concurrency = options.concurrency ?? 4;
  const spacingMs = options.spacingMs ?? 75;
  const retries = options.retries ?? 1;
  const delay = options.delay ?? sleep;

  const state = new Map<string, ArtState>();
  const queue: string[] = [];
  let active = 0;
  let pumping = false;

  const attempt = async (url: string): Promise<void> => {
    for (let tryIndex = 0; tryIndex <= retries; tryIndex++) {
      try {
        state.set(url, await options.load(url));
        return;
      } catch {
        // Back off before the retry; a burst that drew a 429 will draw another one immediately.
        if (tryIndex < retries) await delay(spacingMs * (tryIndex + 2));
      }
    }
    // Permanent after the retries are spent: a card that genuinely has no art must not retry forever.
    state.set(url, "error");
  };

  const pump = async (): Promise<void> => {
    if (pumping) return;
    pumping = true;
    while (queue.length > 0 && active < concurrency) {
      const url = queue.shift()!;
      active++;
      // .catch: the retry backoff's `await delay(...)` inside `attempt` is unguarded, so a
      // rejecting `delay` (never happens with the shipped `sleep`, but is injectable in tests)
      // would otherwise escape this void-fired call as an unhandled rejection. `pump`'s own delay
      // three lines below is already guarded the same way.
      void attempt(url).finally(() => { active--; void pump(); }).catch(() => {});
      // Unconditional, not `if (queue.length > 0)`: two `request()` calls in the same tick each
      // start their own `pump()`, and each sees a queue of length 1 at dispatch time -- gating the
      // wait on remaining queue length means back-to-back requests never actually get spaced. The
      // `pumping` guard above means only one of these loops is ever actually advancing at a time,
      // so this wait is the real inter-dispatch gap regardless of which call happened to start it.
      // try/catch: a `delay` that rejects must not escape and skip `pumping = false` below --
      // that would wedge the queue open (`pumping` stuck true) for the life of the loader.
      try { await delay(spacingMs); } catch { /* fall through to pumping = false */ }
    }
    pumping = false;
  };

  return {
    get: (url) => state.get(url),
    request: (url, urgent = false) => {
      // Idempotent by construction: `draw()` calls this every frame for every unresolved node.
      // `state.set(url, "loading")` below happens in this same synchronous call, before the url
      // could ever be queued again, so `state.has(url)` alone already covers a queued-but-not-yet-
      // dispatched url -- no separate `queue.includes` check needed.
      //
      // An already-QUEUED url can still be promoted, though, and that is the case that matters: the
      // whole board is requested on the first frame, so by the time a user zooms into a card its
      // disc art is already sitting in the queue behind 90-odd others. Promotion moves it to the
      // front instead of returning early and leaving it there.
      if (state.has(url)) {
        if (!urgent) return;
        const at = queue.indexOf(url);
        if (at > 0) queue.unshift(...queue.splice(at, 1));
        return;
      }
      state.set(url, "loading");
      if (urgent) queue.unshift(url);
      else queue.push(url);
      void pump();
    },
  };
}
