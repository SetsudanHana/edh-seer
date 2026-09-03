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

test("serves a deck and caches it for 60 seconds", async () => {
  const { env, stubFetch } = envWith(DECK);
  const res = await worker.fetch(get("/api/import/archidekt/26039486"), env, ctx);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual(DECK.sections);
  expect(res.headers.get("Cache-Control")).toBe("public, max-age=60");
  expect(stubFetch).toHaveBeenCalledTimes(1);
  expect(cache.put).toHaveBeenCalledTimes(1);
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
