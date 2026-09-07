import { beforeEach, expect, test, vi } from "vitest";
import worker, { type Env } from "./index.js";

/** The router is the trust boundary: it decides what reaches the pacer at all. These tests stand in
 *  for the Workers runtime with the two globals it touches. */
function fakeCache() {
  const store = new Map<string, Response>();
  return {
    store,
    match: vi.fn(async (req: Request) => store.get(req.url)?.clone()),
    put: vi.fn(async (req: Request, res: Response) => {
      store.set(req.url, res);
    }),
  };
}

let cache: ReturnType<typeof fakeCache>;

beforeEach(() => {
  cache = fakeCache();
  (globalThis as unknown as { caches: unknown }).caches = { default: cache };
});

function envWith(outcome: unknown, extra: Partial<Env> = {}): { env: Env; stubFetch: ReturnType<typeof vi.fn> } {
  const stubFetch = vi.fn(async () => Response.json(outcome));
  const env = {
    MOXFIELD_UA: "ua",
    PACER: {
      idFromName: vi.fn((n: string) => `id:${n}`),
      get: vi.fn(() => ({ fetch: stubFetch })),
    },
    ...extra,
  } as unknown as Env;
  return { env, stubFetch };
}

const ctx = { waitUntil: (p: Promise<unknown>) => void p } as unknown as ExecutionContext;
const get = (path: string) => new Request(`https://edhseer.cards${path}`);

const DECK = { kind: "deck", sections: { commanders: ["Teysa Karlov"], deck: ["Sol Ring"] } };

test("the reader gets no-store while the EDGE copy carries the 60s TTL", async () => {
  const { env, stubFetch } = envWith(DECK);
  const res = await worker.fetch(get("/api/import/archidekt/26039486"), env, ctx);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual(DECK.sections);
  // A zone-wide Browser Cache TTL raises any max-age LOWER than its own, so `max-age=60` became four
  // hours in production. `no-store` has no number to raise, and a browser has no reason to hold an
  // import: the client converts it to decklist text and the share link carries the deck from then on.
  expect(res.headers.get("Cache-Control")).toBe("no-store");

  expect(cache.put).toHaveBeenCalledTimes(1);
  const stored = cache.put.mock.calls[0][1] as Response;
  expect(stored.headers.get("Cache-Control")).toBe("public, max-age=60");
  expect(await stored.clone().json()).toEqual(DECK.sections);
  expect(stubFetch).toHaveBeenCalledTimes(1);
});

test("a cache HIT is re-headered on the way out, not handed over as stored", async () => {
  const { env } = envWith(DECK);
  await worker.fetch(get("/api/import/archidekt/26039486"), env, ctx);
  const second = await worker.fetch(get("/api/import/archidekt/26039486"), env, ctx);
  expect(second.headers.get("Cache-Control")).toBe("no-store");
  expect(await second.json()).toEqual(DECK.sections);
});

test("a cache hit never reaches the pacer", async () => {
  const { env, stubFetch } = envWith(DECK);
  await worker.fetch(get("/api/import/archidekt/26039486"), env, ctx);
  await worker.fetch(get("/api/import/archidekt/26039486"), env, ctx);
  // The second read is the point: an upstream request that never happens cannot cost us a slot.
  expect(stubFetch).toHaveBeenCalledTimes(1);
});

test("a trailing slash is the same cache entry, not a second upstream request", async () => {
  const { env, stubFetch } = envWith(DECK);
  await worker.fetch(get("/api/import/archidekt/26039486"), env, ctx);
  await worker.fetch(get("/api/import/archidekt/26039486/"), env, ctx);
  expect(stubFetch).toHaveBeenCalledTimes(1);
});

test("refuses a malformed id without asking the pacer", async () => {
  const { env, stubFetch } = envWith(DECK);
  // Archidekt ids are integers. Anything else is a typo or an attempt to steer our fetch, and the
  // check runs on the DECODED id -- `%2E%2E%2F` is `../`, which a check on the raw path would miss.
  for (const bad of ["not-a-number", "1;2", "%2E%2E%2Fadmin", "12 34"]) {
    const res = await worker.fetch(get(`/api/import/archidekt/${bad}`), env, ctx);
    expect(res.status).toBe(400);
  }
  // A literal slash never even reaches the id check: it fails the route shape first. Refused either
  // way, which is the property that matters.
  for (const bad of ["../../etc", "1/2"]) {
    const res = await worker.fetch(get(`/api/import/archidekt/${bad}`), env, ctx);
    expect(res.status).toBeGreaterThanOrEqual(400);
  }
  expect(stubFetch).not.toHaveBeenCalled();
});

test("refuses an unknown deck site", async () => {
  const { env, stubFetch } = envWith(DECK);
  const res = await worker.fetch(get("/api/import/evilsite/123"), env, ctx);
  expect(res.status).toBe(404);
  expect(stubFetch).not.toHaveBeenCalled();
});

test("the kill switch stops everything before the pacer", async () => {
  const { env, stubFetch } = envWith(DECK, { IMPORT_DISABLED: "1" });
  const res = await worker.fetch(get("/api/import/archidekt/26039486"), env, ctx);
  expect(res.status).toBe(503);
  expect(stubFetch).not.toHaveBeenCalled();
});

test("a rejection keeps its status and is NOT cached", async () => {
  const { env } = envWith({ kind: "rejected", status: 404, message: "deck not found, or not public" });
  const res = await worker.fetch(get("/api/import/moxfield/AbC-123"), env, ctx);
  expect(res.status).toBe(404);
  expect(res.headers.get("Cache-Control")).toBe("no-store");
  // Caching this would keep telling a reader their deck is private for a minute after they fixed it.
  expect(cache.put).not.toHaveBeenCalled();
});

test("addresses one pacer per site, by a fixed name and with no location hint", async () => {
  const { env } = envWith(DECK);
  await worker.fetch(get("/api/import/moxfield/AbC-123"), env, ctx);
  expect(env.PACER.idFromName).toHaveBeenCalledWith("moxfield");
  expect(env.PACER.get).toHaveBeenCalledWith("id:moxfield");
});

function limiter(success: boolean) {
  return { limit: vi.fn(async () => ({ success })) };
}

test("a throttled caller gets 429 and never reaches the pacer", async () => {
  const { env, stubFetch } = envWith(DECK);
  const rl = limiter(false);
  const res = await worker.fetch(
    new Request("https://edhseer.cards/api/import/archidekt/26039486", {
      headers: { "CF-Connecting-IP": "203.0.113.7" },
    }),
    { ...env, RATE_LIMITER: rl } as unknown as Env,
    ctx,
  );
  expect(res.status).toBe(429);
  expect(rl.limit).toHaveBeenCalledWith({ key: "203.0.113.7" });
  // The whole point: the expensive path is never entered.
  expect(stubFetch).not.toHaveBeenCalled();
});

/** THE LOG LINE MUST NOT CARRY THE IP. We throttle ON the connecting address, so it is right there
 *  in scope, and the question the log has to answer later is "are we shedding traffic, and for which
 *  site" -- which needs the source and nothing about who. A test, because "we did not log the IP" is
 *  exactly the kind of thing a later edit adds back for debugging and nobody notices. */
test("shedding traffic is logged by site, and never by IP", async () => {
  const { env } = envWith(DECK);
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  await worker.fetch(
    new Request("https://edhseer.cards/api/import/archidekt/26039486", {
      headers: { "CF-Connecting-IP": "203.0.113.7" },
    }),
    { ...env, RATE_LIMITER: limiter(false) } as unknown as Env,
    ctx,
  );
  expect(warn).toHaveBeenCalledWith({ event: "import.rate_limited", source: "archidekt" });
  expect(JSON.stringify(warn.mock.calls)).not.toContain("203.0.113.7");
  warn.mockRestore();
});

test("a cache hit is not counted against the reader", async () => {
  const { env } = envWith(DECK);
  const rl = limiter(true);
  const withRl = { ...env, RATE_LIMITER: rl } as unknown as Env;
  await worker.fetch(get("/api/import/archidekt/26039486"), withRl, ctx);
  await worker.fetch(get("/api/import/archidekt/26039486"), withRl, ctx);
  // Two reads, one upstream. Re-analysing the same deck must not spend a reader's budget.
  expect(rl.limit).toHaveBeenCalledTimes(1);
});

test("an absent IP header keys everyone together rather than exempting them", async () => {
  const { env } = envWith(DECK);
  const rl = limiter(true);
  await worker.fetch(get("/api/import/moxfield/AbC"), { ...env, RATE_LIMITER: rl } as unknown as Env, ctx);
  expect(rl.limit).toHaveBeenCalledWith({ key: "unknown" });
});

test("no limiter binding means unthrottled, so dev and tests still run", async () => {
  const { env, stubFetch } = envWith(DECK);
  const res = await worker.fetch(get("/api/import/archidekt/26039486"), env, ctx);
  expect(res.status).toBe(200);
  expect(stubFetch).toHaveBeenCalledTimes(1);
});
