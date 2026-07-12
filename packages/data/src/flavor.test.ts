import { expect, test, vi } from "vitest";
import { extractFlavorPairs, fetchFlavorNames } from "./flavor.js";

test("extractFlavorPairs keeps records with oracle_id + flavor_name, skips the rest", () => {
  const pairs = extractFlavorPairs({
    data: [
      { oracle_id: "abc", flavor_name: "Beholder's Death Ray", name: "Snuff Out" },
      { oracle_id: "def", name: "No flavor" }, // no flavor_name -> skip
      { flavor_name: "Orphan" }, // no oracle_id -> skip
    ] as never,
  });
  expect(pairs).toEqual([{ oracleId: "abc", flavorName: "Beholder's Death Ray" }]);
});

function page(body: unknown): Response {
  return { ok: true, json: async () => body } as unknown as Response;
}

test("fetchFlavorNames follows pagination and concatenates all pages", async () => {
  const fetchImpl = vi
    .fn()
    .mockResolvedValueOnce(
      page({
        has_more: true,
        next_page: "https://api.scryfall.com/cards/search?q=has%3Aflavorname&page=2",
        data: [{ oracle_id: "a", flavor_name: "Flavor A" }],
      }),
    )
    .mockResolvedValueOnce(
      page({ has_more: false, data: [{ oracle_id: "b", flavor_name: "Flavor B" }] }),
    );

  const pairs = await fetchFlavorNames(fetchImpl as unknown as typeof fetch);

  expect(pairs).toEqual([
    { oracleId: "a", flavorName: "Flavor A" },
    { oracleId: "b", flavorName: "Flavor B" },
  ]);
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  expect(fetchImpl).toHaveBeenNthCalledWith(
    2,
    "https://api.scryfall.com/cards/search?q=has%3Aflavorname&page=2",
    expect.objectContaining({ headers: expect.objectContaining({ "User-Agent": expect.any(String) }) }),
  );
});

test("fetchFlavorNames throws on a non-ok response", async () => {
  const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 503 } as unknown as Response);
  await expect(fetchFlavorNames(fetchImpl as unknown as typeof fetch)).rejects.toThrow(/503/);
});
