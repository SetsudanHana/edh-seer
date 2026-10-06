/** BOUNDED MEMOIZATION FOR A PURE FUNCTION (G-T3, derive-grammar review task T3, F2): `segment()`
 *  ran six times per card during derive (five in `derive-input.ts`, one in `grammar/clause-record.ts`,
 *  always over the exact same `(oracleText, keywords, typeLine)` triple) and `parseTrigger` ran twice
 *  on the same preamble whenever a card derives from both the stored answer and the grammar's own
 *  records (`derive-worker.ts`'s dual derive). Wrapping the function once, here, turns repeats within
 *  and across one card's derive into cache hits with no change to its signature or its callers.
 *
 *  ONLY FOR A FUNCTION WITH NO OBSERVABLE SIDE CHANNEL: `grammar/action.ts`'s `parseActions` is NOT
 *  wrapped this way — `unreadPhrases` reads a module-level variable `parseActions` populates as it
 *  runs, and a cache hit would skip that run and silently report nothing unread. That redundancy is
 *  cut instead by threading `GrammarRecords.readings` through to derive (`derive-input.ts`,
 *  `derive/derive.ts`), which needs no cache and has no side channel to lose.
 *
 *  ponytail: a plain `Map`, cleared whole on overflow rather than a real LRU -- the gain is repeats
 *  within a short window (one card, or two derives back to back on the same card), not a long-lived
 *  cross-corpus cache, so evicting everything instead of the single oldest entry costs nothing
 *  measurable. Upgrade to an LRU only if a profile shows the clear-on-overflow churn matters. */
export function memoize<Args extends unknown[], R>(
  fn: (...args: Args) => R,
  keyOf: (...args: Args) => string,
  max = 4000,
): (...args: Args) => R {
  const cache = new Map<string, R>();
  return (...args: Args): R => {
    const key = keyOf(...args);
    const hit = cache.get(key);
    if (hit !== undefined || cache.has(key)) return hit as R;
    const result = fn(...args);
    if (cache.size >= max) cache.clear();
    cache.set(key, result);
    return result;
  };
}

/** Same as `memoize`, but returns a fresh shallow copy of the cached value on every call -- for a
 *  result some caller mutates in place (the filter grammar's `SubjectFilter`: `subjectFrom` writes
 *  `.named`, `.notNamed` and `.control` onto whatever `parse()` hands it). A shared cached object
 *  would carry one card's mutation into the next lookup of the same text; a shallow copy costs one
 *  object allocation and keeps the cache's own entry pristine. */
export function memoizeCloned<Args extends unknown[], R extends object | null>(
  fn: (...args: Args) => R,
  keyOf: (...args: Args) => string,
  max = 4000,
): (...args: Args) => R {
  const inner = memoize(fn, keyOf, max);
  return (...args: Args): R => {
    const r = inner(...args);
    return (r === null ? null : { ...r }) as R;
  };
}
