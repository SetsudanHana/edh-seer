import { expect, test, vi } from "vitest";
import { analyzeDeck } from "./api.js";

test("POSTs decklist to /api/analyze and returns parsed body", async () => {
  const body = { report: { edges: [], combos: [], themes: [], roles: { ramp: 0, draw: 0, removal: 0 } }, missing: [], resolvedCount: 0, totalCount: 0 };
  const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => body });
  const out = await analyzeDeck("1 Sol Ring", fetchImpl as unknown as typeof fetch);
  expect(fetchImpl).toHaveBeenCalledWith(
    "/api/analyze",
    expect.objectContaining({ method: "POST" }),
  );
  expect(out).toEqual(body);
});

test("throws the server message on a non-ok response", async () => {
  const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({ message: "Cannot reach MongoDB..." }) });
  await expect(analyzeDeck("x", fetchImpl as unknown as typeof fetch)).rejects.toThrow(/Cannot reach MongoDB/);
});
