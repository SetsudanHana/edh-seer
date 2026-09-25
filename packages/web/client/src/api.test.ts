import { expect, test, vi } from "vitest";
import { analyzeDeck } from "./api.js";
import { analyzeDeckStatic } from "./api.static.js";

vi.mock("./api.static.js", () => ({ analyzeDeckStatic: vi.fn() }));

/** ONE PATH, AND IT IS THE STATIC ONE (2026-09-25). This used to test a POST to `/api/analyze`, the
 *  NestJS route that was removed; what is left to pin is that `analyzeDeck` hands everything to the
 *  in-browser analysis, against `/static`, and passes the game state through. The analysis itself
 *  is `api.static.test.ts`'s. */
test("analyses in the browser against /static, with the state it was given", async () => {
  const out = { report: {}, missing: [], resolvedCount: 0, totalCount: 0, commanderColorIdentity: [], graph: {} };
  vi.mocked(analyzeDeckStatic).mockResolvedValue(out as never);
  const fetchImpl = vi.fn() as unknown as typeof fetch;
  const state = { speed: 4 } as never;
  await expect(analyzeDeck("1 Sol Ring", "Krenko", fetchImpl, state)).resolves.toBe(out);
  expect(analyzeDeckStatic).toHaveBeenCalledWith("1 Sol Ring", "Krenko", "/static", fetchImpl, state);
});
