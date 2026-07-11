import { expect, test, vi } from "vitest";
import { fetchOracleCards } from "./scryfall.js";
import { fetchVariants } from "./spellbook.js";
import { parseMoxfieldId, fetchMoxfieldDeck } from "./moxfield.js";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

test("fetchOracleCards follows the bulk-data download_uri", async () => {
  const fetchImpl = vi
    .fn()
    .mockResolvedValueOnce(
      jsonResponse({ data: [{ type: "oracle_cards", download_uri: "https://dl/oracle" }] }),
    )
    .mockResolvedValueOnce(jsonResponse([{ oracle_id: "a", name: "A", type_line: "T" }]));

  const cards = await fetchOracleCards(fetchImpl as unknown as typeof fetch);
  expect(fetchImpl).toHaveBeenNthCalledWith(1, "https://api.scryfall.com/bulk-data");
  expect(fetchImpl).toHaveBeenNthCalledWith(2, "https://dl/oracle");
  expect(cards).toHaveLength(1);
});

test("fetchVariants unwraps the variants envelope", async () => {
  const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ variants: [{ id: "v1" }] }));
  const variants = await fetchVariants(fetchImpl as unknown as typeof fetch);
  expect(variants).toEqual([{ id: "v1" }]);
});

test("parseMoxfieldId extracts id from URL or passes a bare id", () => {
  expect(parseMoxfieldId("https://www.moxfield.com/decks/AbC-123")).toBe("AbC-123");
  expect(parseMoxfieldId("AbC-123")).toBe("AbC-123");
  expect(parseMoxfieldId("not a valid id!!")).toBeNull();
});

test("fetchMoxfieldDeck returns commander and mainboard names", async () => {
  const fetchImpl = vi.fn().mockResolvedValue(
    jsonResponse({
      commanders: { "Krenko, Mob Boss": {} },
      mainboard: { "Sol Ring": {}, "Impact Tremors": {} },
    }),
  );
  const names = await fetchMoxfieldDeck("id", fetchImpl as unknown as typeof fetch);
  expect(names).toEqual(["Krenko, Mob Boss", "Sol Ring", "Impact Tremors"]);
});
