import { expect, test, vi } from "vitest";
import { SCRYFALL_HEADERS, fetchDigitalOnlyOracleIds, scryfallSearch, scryfallSearchUrl } from "./scryfall.js";

/** THE ONE SCRYFALL CLIENT (2026-09-25). Every paginated search in the repository goes through
 *  `scryfallSearch`, so its contract is pinned here once: pages in order, "no matches" is empty,
 *  back-off is honoured, and a page that never arrives fails the whole search. */
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });
const collect = async (url: string, opts: Parameters<typeof scryfallSearch>[1]) => {
  const out: unknown[] = [];
  for await (const page of scryfallSearch(url, opts)) out.push(...page);
  return out;
};

test("follows next_page in order, with the shared headers, pausing between pages", async () => {
  const fetchImpl = vi.fn()
    .mockResolvedValueOnce(json({ data: [1, 2], has_more: true, next_page: "https://api.scryfall.com/p2" }))
    .mockResolvedValueOnce(json({ data: [3], has_more: false }));
  const sleep = vi.fn(async () => {});
  expect(await collect("https://api.scryfall.com/p1", { fetchImpl, sleep })).toEqual([1, 2, 3]);
  expect(fetchImpl.mock.calls.map((c) => c[0])).toEqual(["https://api.scryfall.com/p1", "https://api.scryfall.com/p2"]);
  expect(fetchImpl.mock.calls[0]![1]).toEqual({ headers: SCRYFALL_HEADERS });
  expect(sleep).toHaveBeenCalledTimes(1);
  expect(sleep).toHaveBeenCalledWith(100);
});

test("a 404 is Scryfall's 'no cards match': an empty result, not an error", async () => {
  const fetchImpl = vi.fn().mockResolvedValue(json({ object: "error", code: "not_found" }, 404));
  expect(await collect("u", { fetchImpl })).toEqual([]);
});

test("a 429 waits for Retry-After, then carries on", async () => {
  const fetchImpl = vi.fn()
    .mockResolvedValueOnce(json({}, 429, { "retry-after": "3" }))
    .mockResolvedValueOnce(json({ data: ["x"] }));
  const sleep = vi.fn(async () => {});
  expect(await collect("u", { fetchImpl, sleep })).toEqual(["x"]);
  expect(sleep).toHaveBeenCalledWith(3000);
});

test("a thrown fetch is retried like a 5xx", async () => {
  const fetchImpl = vi.fn()
    .mockRejectedValueOnce(new Error("socket hang up"))
    .mockResolvedValueOnce(json({ data: ["y"] }));
  expect(await collect("u", { fetchImpl, sleep: async () => {} })).toEqual(["y"]);
});

test("a page that never arrives fails the search rather than truncating it", async () => {
  const fetchImpl = vi.fn()
    .mockResolvedValueOnce(json({ data: [1], has_more: true, next_page: "p2" }))
    .mockResolvedValue(json({}, 503));
  await expect(collect("u", { fetchImpl, attempts: 2, sleep: async () => {} })).rejects.toThrow(/gave up after 2 attempts \(status 503\)/);
});

test("the search URL carries the query and Scryfall's own parameters", () => {
  const u = new URL(scryfallSearchUrl("otag:ramp -is:alchemy", { unique: "cards", order: "name" }));
  expect(u.origin + u.pathname).toBe("https://api.scryfall.com/cards/search");
  expect(Object.fromEntries(u.searchParams)).toEqual({ unique: "cards", order: "name", q: "otag:ramp -is:alchemy" });
});

test("the digital-only filter reads every page through the shared client", async () => {
  const fetchImpl = vi.fn()
    .mockResolvedValueOnce(json({ data: [{ oracle_id: "a" }, {}], has_more: true, next_page: "p2" }))
    .mockResolvedValueOnce(json({ data: [{ oracle_id: "b" }] }));
  const ids = await fetchDigitalOnlyOracleIds(fetchImpl as unknown as typeof fetch, { sleep: async () => {} });
  expect([...ids]).toEqual(["a", "b"]);
});
