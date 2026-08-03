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
  /** Request a URL. Idempotent: safe to call every animation frame. */
  request(url: string): void;
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
      void attempt(url).finally(() => { active--; void pump(); });
      // Unconditional, not `if (queue.length > 0)`: two `request()` calls in the same tick each
      // start their own `pump()`, and each sees a queue of length 1 at dispatch time -- gating the
      // wait on remaining queue length means back-to-back requests never actually get spaced. The
      // `pumping` guard above means only one of these loops is ever actually advancing at a time,
      // so this wait is the real inter-dispatch gap regardless of which call happened to start it.
      await delay(spacingMs);
    }
    pumping = false;
  };

  return {
    get: (url) => state.get(url),
    request: (url) => {
      // Idempotent by construction: `draw()` calls this every frame for every unresolved node.
      if (state.has(url) || queue.includes(url)) return;
      state.set(url, "loading");
      queue.push(url);
      void pump();
    },
  };
}
