import { Pacer, type PacerEnv } from "./pacer.js";

export { Pacer };

export interface Env extends PacerEnv {
  PACER: DurableObjectNamespace;
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

function json(body: unknown, status: number, cacheSeconds = 0): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": cacheSeconds > 0 ? `public, max-age=${cacheSeconds}` : "no-store",
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
    if (hit) return hit;

    // ONE INSTANCE, and no location hint. A hint, or a name that varies per colo, would give us one
    // pacer per datacentre — which is exactly the thing the pacer exists to prevent.
    const stub = env.PACER.get(env.PACER.idFromName(source));
    const res = await stub.fetch("https://pacer.invalid/", {
      method: "POST",
      body: JSON.stringify({ source, id }),
    });
    const outcome = (await res.json()) as
      | { kind: "deck"; sections: { commanders: string[]; deck: string[] } }
      | { kind: "rejected"; status: number; message: string };

    if (outcome.kind === "rejected") return json({ error: outcome.message }, outcome.status);

    const ok = json(outcome.sections, 200, CACHE_SECONDS);
    // Only a successful read is cached. Caching a 404 would keep telling a reader their deck is
    // private for a minute after they made it public.
    ctx.waitUntil(cache.put(cacheKey, ok.clone()));
    return ok;
  },
};
