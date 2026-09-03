import { gzipSync } from "node:zlib";
import { expect, test, vi } from "vitest";
import { fetchOracleCards } from "./scryfall.js";
import { streamVariants } from "./spellbook.js";
import { parseMoxfieldId, fetchMoxfieldDeck, moxfieldDeckToSections } from "./moxfield.js";
import {
  parseArchidektId,
  fetchArchidektDeck,
  archidektDeckToSections,
} from "./archidekt.js";

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

/** Trimmed from a real `GET api2.moxfield.com/v3/decks/all/<id>` body, 2026-09-03. Keys and nesting
 *  are verbatim; only the card objects are cut down. The map key is `uniqueCardId`, NOT the name --
 *  that is the whole point of the fixture. */
const MOXFIELD_V3 = {
  name: "Ups, all Chandras",
  boards: {
    commanders: {
      cards: {
        Egj3v: {
          quantity: 1,
          boardType: "commanders",
          card: { uniqueCardId: "Egj3v", name: "Chandra, Fire of Kaladesh // Chandra, Roaring Flame", layout: "transform" },
        },
      },
    },
    mainboard: {
      cards: {
        aB1: { quantity: 1, boardType: "mainboard", card: { uniqueCardId: "aB1", name: "Chandra's Ignition", layout: "normal" } },
        aB2: { quantity: 7, boardType: "mainboard", card: { uniqueCardId: "aB2", name: "Mountain", layout: "normal" } },
        aB3: { quantity: 1, boardType: "mainboard", card: { uniqueCardId: "aB3", name: "Valakut Awakening // Valakut Stoneforge", layout: "modal_dfc" } },
      },
    },
    sideboard: { cards: { s1: { quantity: 1, card: { name: "Pyroblast" } } } },
    maybeboard: { cards: { m1: { quantity: 1, card: { name: "Wheel of Fortune" } } } },
    companions: { cards: { c1: { quantity: 1, card: { name: "Lurrus of the Dream-Den" } } } },
    tokens: { cards: { t1: { quantity: 1, card: { name: "Elemental" } } } },
    planes: { cards: {} },
    schemes: { cards: {} },
    attractions: { cards: {} },
    stickers: { cards: {} },
    contraptions: { cards: {} },
    signatureSpells: { cards: {} },
  },
};

test("moxfieldDeckToSections reads names from card.name and expands by quantity", () => {
  const { commanders, deck } = moxfieldDeckToSections(MOXFIELD_V3);
  expect(commanders).toEqual(["Chandra, Fire of Kaladesh // Chandra, Roaring Flame"]);
  // 1 + 7 + 1: the seven Mountains are seven entries, and no `uniqueCardId` appears as a name.
  expect(deck).toHaveLength(9);
  expect(deck.filter((n) => n === "Mountain")).toHaveLength(7);
  expect(deck).toContain("Valakut Awakening // Valakut Stoneforge");
  expect(deck.join(" ")).not.toContain("aB1");
});

test("moxfieldDeckToSections imports only mainboard and commanders", () => {
  const { deck, commanders } = moxfieldDeckToSections(MOXFIELD_V3);
  const all = [...deck, ...commanders];
  for (const outside of ["Pyroblast", "Wheel of Fortune", "Lurrus of the Dream-Den", "Elemental"]) {
    expect(all).not.toContain(outside);
  }
});

test("moxfieldDeckToSections refuses a shape it does not recognise", () => {
  // The v2 body the previous implementation was written against: boards at the top level, maps
  // keyed by card name. It must fail loudly rather than import zero cards.
  expect(() => moxfieldDeckToSections({ commanders: { "Krenko, Mob Boss": {} }, mainboard: {} })).toThrow(
    /boards\.mainboard/,
  );
  expect(() =>
    moxfieldDeckToSections({ boards: { mainboard: { cards: { x: { quantity: 1 } } } } }),
  ).toThrow(/card\.name/);
});

test("fetchMoxfieldDeck calls api2 v3 with the supplied User-Agent", async () => {
  const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(MOXFIELD_V3));
  const sections = await fetchMoxfieldDeck("abc", "edh-seer/1.0 (contact)", fetchImpl as unknown as typeof fetch);
  expect(fetchImpl).toHaveBeenCalledWith(
    "https://api2.moxfield.com/v3/decks/all/abc",
    expect.objectContaining({
      headers: expect.objectContaining({ "User-Agent": "edh-seer/1.0 (contact)" }),
    }),
  );
  expect(sections.commanders).toHaveLength(1);
});

test("fetchMoxfieldDeck sends nothing at all without a User-Agent", async () => {
  const fetchImpl = vi.fn();
  await expect(fetchMoxfieldDeck("abc", "", fetchImpl as unknown as typeof fetch)).rejects.toThrow(
    /MOXFIELD_UA/,
  );
  expect(fetchImpl).not.toHaveBeenCalled();
});

/** Trimmed from a real `GET archidekt.com/api/decks/<id>/` body, 2026-09-03. */
const ARCHIDEKT = {
  name: "Teysa",
  categories: [
    { name: "Sideboard", isPremier: false, includedInDeck: false },
    { name: "Maybeboard", isPremier: false, includedInDeck: false },
    { name: "Commander", isPremier: true, includedInDeck: true },
    { name: "Ramp", isPremier: false, includedInDeck: true },
  ],
  cards: [
    { quantity: 1, categories: ["Commander"], card: { oracleCard: { name: "Teysa Karlov" } } },
    { quantity: 1, categories: ["Ramp"], card: { oracleCard: { name: "Sol Ring" } } },
    { quantity: 9, categories: [], card: { oracleCard: { name: "Swamp" } } },
    { quantity: 1, categories: ["Maybeboard"], card: { oracleCard: { name: "Demonic Tutor" } } },
    { quantity: 1, categories: ["Sideboard", "Ramp"], card: { oracleCard: { name: "Arcane Signet" } } },
  ],
};

test("archidektDeckToSections drops categories flagged includedInDeck:false", () => {
  const { deck } = archidektDeckToSections(ARCHIDEKT);
  expect(deck).not.toContain("Demonic Tutor");
  // In a maybeboard AND a real category: still not in the deck.
  expect(deck).not.toContain("Arcane Signet");
  expect(deck).toHaveLength(10);
});

test("archidektDeckToSections takes the commander from isPremier, not the category name", () => {
  const renamed = {
    ...ARCHIDEKT,
    categories: ARCHIDEKT.categories.map((c) =>
      c.name === "Commander" ? { ...c, name: "Le General" } : c,
    ),
    cards: ARCHIDEKT.cards.map((c) =>
      c.categories.includes("Commander") ? { ...c, categories: ["Le General"] } : c,
    ),
  };
  expect(archidektDeckToSections(renamed).commanders).toEqual(["Teysa Karlov"]);
});

test("archidektDeckToSections refuses a shape it does not recognise", () => {
  expect(() => archidektDeckToSections({ cards: {} })).toThrow(/cards array/);
  expect(() => archidektDeckToSections({ cards: [{ quantity: 1, categories: [] }] })).toThrow(
    /oracleCard\.name/,
  );
});

test("fetchArchidektDeck uses the bare host that does not 301", async () => {
  const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(ARCHIDEKT));
  await fetchArchidektDeck("26039486", fetchImpl as unknown as typeof fetch);
  expect(fetchImpl).toHaveBeenCalledWith(
    "https://archidekt.com/api/decks/26039486/",
    expect.anything(),
  );
});

test("parseArchidektId extracts the integer id from a URL or a bare id", () => {
  expect(parseArchidektId("https://archidekt.com/decks/26039486/teysa-karlov")).toBe("26039486");
  expect(parseArchidektId("26039486")).toBe("26039486");
  expect(parseArchidektId("https://archidekt.com/decks/abc")).toBeNull();
});
