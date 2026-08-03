import { gzipSync } from "node:zlib";
import { expect, test, vi } from "vitest";
import { fetchOracleCards } from "./scryfall.js";
import { streamVariants } from "./spellbook.js";
import { parseMoxfieldId, fetchMoxfieldDeck } from "./moxfield.js";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

function gzipResponse(jsonlBody: string, ok = true, status = 200): Response {
  const gz = gzipSync(Buffer.from(jsonlBody, "utf8"));
  return {
    ok,
    status,
    arrayBuffer: async () => gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.byteLength),
  } as unknown as Response;
}

test("fetchOracleCards follows jsonl_download_uri and decompresses gzipped JSONL", async () => {
  const jsonl =
    JSON.stringify({ oracle_id: "a", name: "A", type_line: "T" }) +
    "\n" +
    JSON.stringify({ oracle_id: "b", name: "B", type_line: "T2" });
  const fetchImpl = vi
    .fn()
    .mockResolvedValueOnce(
      jsonResponse({
        data: [{ type: "oracle_cards", jsonl_download_uri: "https://data.scryfall.io/oracle" }],
      }),
    )
    .mockResolvedValueOnce(gzipResponse(jsonl));

  const cards = await fetchOracleCards(fetchImpl as unknown as typeof fetch);
  expect(fetchImpl).toHaveBeenNthCalledWith(
    1,
    "https://api.scryfall.com/bulk-data",
    expect.objectContaining({
      headers: expect.objectContaining({ "User-Agent": expect.any(String) }),
    }),
  );
  expect(fetchImpl).toHaveBeenNthCalledWith(
    2,
    "https://data.scryfall.io/oracle",
    expect.objectContaining({
      headers: expect.objectContaining({ "User-Agent": expect.any(String) }),
    }),
  );
  expect(fetchImpl.mock.calls[0][1].headers["User-Agent"]).toBeTruthy();
  expect(cards).toEqual([
    { oracle_id: "a", name: "A", type_line: "T" },
    { oracle_id: "b", name: "B", type_line: "T2" },
  ]);
});

test("fetchOracleCards skips blank trailing lines in the JSONL body", async () => {
  const jsonl = JSON.stringify({ oracle_id: "a", name: "A", type_line: "T" }) + "\n";
  const fetchImpl = vi
    .fn()
    .mockResolvedValueOnce(
      jsonResponse({
        data: [{ type: "oracle_cards", jsonl_download_uri: "https://data.scryfall.io/oracle" }],
      }),
    )
    .mockResolvedValueOnce(gzipResponse(jsonl));

  const cards = await fetchOracleCards(fetchImpl as unknown as typeof fetch);
  expect(cards).toHaveLength(1);
  expect(cards[0]).toEqual({ oracle_id: "a", name: "A", type_line: "T" });
});

test("fetchOracleCards throws a clear error when the metadata response has no data array", async () => {
  const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse({ object: "error" }));

  await expect(fetchOracleCards(fetchImpl as unknown as typeof fetch)).rejects.toThrow(
    "Scryfall bulk-data request failed: unexpected response",
  );
});

test("fetchOracleCards throws the existing message when the oracle_cards entry is missing", async () => {
  const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse({ data: [{ type: "other" }] }));

  await expect(fetchOracleCards(fetchImpl as unknown as typeof fetch)).rejects.toThrow(
    "Scryfall oracle_cards bulk entry not found",
  );
});

test("fetchOracleCards throws the existing message when the entry has no jsonl_download_uri", async () => {
  const fetchImpl = vi
    .fn()
    .mockResolvedValueOnce(jsonResponse({ data: [{ type: "oracle_cards" }] }));

  await expect(fetchOracleCards(fetchImpl as unknown as typeof fetch)).rejects.toThrow(
    "Scryfall oracle_cards bulk entry not found",
  );
});

test("fetchOracleCards throws on a non-ok metadata response", async () => {
  const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500 } as unknown as Response);
  await expect(fetchOracleCards(fetchImpl as unknown as typeof fetch)).rejects.toThrow(/500/);
});

test("streamVariants yields each variant from the streamed variants array", async () => {
  const body = JSON.stringify({ variants: [{ id: "v1" }, { id: "v2" }] });
  const fetchImpl = vi.fn().mockResolvedValue(new Response(body, { status: 200 }));
  const out: unknown[] = [];
  for await (const v of streamVariants(fetchImpl as unknown as typeof fetch)) {
    out.push(v);
  }
  expect(out).toEqual([{ id: "v1" }, { id: "v2" }]);
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
