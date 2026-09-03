import { Pacer, type PacerEnv } from "./pacer.js";

export { Pacer };

interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env extends PacerEnv {
  PACER: DurableObjectNamespace;
  /** Optional so `wrangler dev` and the tests run without it; absent means unthrottled. */
  RATE_LIMITER?: RateLimiter;
  /** Set to "1" to stop all imports without a deploy. A lever that needs a build is a lever that
   *  arrives too late. */
  IMPORT_DISABLED?: string;
}

/** Only what a deck id can be, per site. The reader supplies an ID, NEVER a URL: forwarding a
 *  client-supplied URL would make this an open proxy, and the traffic that got us blocked would be
 *  someone else's. */
const ID_PATTERN: Record<string, RegExp> = {
  moxfield: /^[\w-]{1,64}$/,
  archidekt: /^\d{1,12}$/,
};

/** 60 seconds. The cache is NOT the rate limiter — the pacer is, and it cannot be outrun at any hit
 *  rate — so this trades staleness against queue length only. Short, because re-pasting a URL is the
 *  reader's refresh gesture: they edited the deck upstream and expect to see it. */
const CACHE_SECONDS = 60;

function json(body: unknown, status: number, cacheControl = "no-store"): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": cacheControl,
    },
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method !== "GET") return json({ error: "method not allowed" }, 405);
    if (env.IMPORT_DISABLED === "1") return json({ error: "deck import is off" }, 503);

    const path = new URL(request.url).pathname;
    const m = path.match(/^\/api\/import\/([a-z]+)\/([^/]+)\/?$/);
    if (!m) return json({ error: "not found" }, 404);
    const [, source, rawId] = m;
    const pattern = ID_PATTERN[source];
    if (!pattern) return json({ error: "unknown deck site" }, 404);
    const id = decodeURIComponent(rawId);
    if (!pattern.test(id)) return json({ error: "malformed deck id" }, 400);

    // Canonical key, so `/moxfield/AbC/` and `/moxfield/AbC` are one cache entry rather than two
    // upstream requests.
    const cacheKey = new Request(`https://import.invalid/${source}/${id}`, { method: "GET" });
    const cache = caches.default;
    const hit = await cache.match(cacheKey);
    // Re-headered on the way out: the stored copy carries the edge TTL, the reader gets `no-store`.
    if (hit) return json(await hit.json(), 200);

    // ONE INSTANCE, and no location hint. A hint, or a name that varies per colo, would give us one
    // pacer per datacentre — which is exactly the thing the pacer exists to prevent.
    // AFTER THE CACHE, ON PURPOSE. A cache hit costs nothing and must not count against a reader who
    // re-analyses the same deck; the limit exists to protect the one expensive path, which is the
    // queue behind the pacer. Keyed on the connecting IP, and an absent header keys everyone together
    // rather than exempting them -- failing closed on the anonymous case is the safer direction.
    if (env.RATE_LIMITER) {
      const key = request.headers.get("CF-Connecting-IP") ?? "unknown";
      const { success } = await env.RATE_LIMITER.limit({ key });
      // Same 429 the pacer's own queue cap returns, so the client already has copy for it.
      if (!success) return json({ error: "importer busy" }, 429);
    }

    const stub = env.PACER.get(env.PACER.idFromName(source));
    const res = await stub.fetch("https://pacer.invalid/", {
      method: "POST",
      body: JSON.stringify({ source, id }),
    });
    const outcome = (await res.json()) as
      | { kind: "deck"; sections: { commanders: string[]; deck: string[] } }
      | { kind: "rejected"; status: number; message: string };

    if (outcome.kind === "rejected") return json({ error: outcome.message }, outcome.status);

    // TWO COPIES OF THE SAME BODY, WITH DIFFERENT HEADERS ON PURPOSE.
    //
    // The edge copy carries `max-age=60`, which is what the Cache API reads to set its TTL. The copy
    // the reader gets carries `no-store`, because a browser has no business holding an import at all:
    // the client turns it into decklist text immediately and throws the URL away, and from then on the
    // share link carries the deck. Nothing ever re-reads this response.
    //
    // It also removes a dependency on a zone setting. Browser Cache TTL overrides the origin whenever
    // the origin's value is LOWER -- so a 4-hour zone default rewrote our `max-age=60` to 14400 and a
    // reader who edited their deck upstream would be served a four-hour-old list by their own browser,
    // with nothing to indicate it. `no-store` has no number to raise.
    //
    // Only a successful read is cached. Caching a 404 would keep telling a reader their deck is
    // private for a minute after they made it public.
    const cached = json(outcome.sections, 200, `public, max-age=${CACHE_SECONDS}`);
    ctx.waitUntil(cache.put(cacheKey, cached));
    return json(outcome.sections, 200);
  },
};
