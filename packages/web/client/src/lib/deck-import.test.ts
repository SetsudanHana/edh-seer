import { expect, test, vi } from "vitest";
import { deckSourceOf, importDeck, toDecklistLines } from "./deck-import.js";

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;
const fail = (status: number) => ({ ok: false, status, json: async () => ({}) }) as Response;

test("collapses repeated names back into counted lines, in the order they arrived", () => {
  const names = ["Sol Ring", "Mountain", "Mountain", "Mountain", "Blood Artist"];
  expect(toDecklistLines(names)).toBe("1 Sol Ring\n3 Mountain\n1 Blood Artist");
});

test("an empty section is an empty string, not a stray newline", () => {
  expect(toDecklistLines([])).toBe("");
});

test("fills both form fields from one import", async () => {
  const fetchImpl = vi.fn(async () =>
    ok({ commanders: ["Teysa Karlov"], deck: ["Sol Ring", "Swamp", "Swamp"] }),
  );
  const deck = await importDeck("archidekt", "26039486", fetchImpl as unknown as typeof fetch);
  expect(fetchImpl).toHaveBeenCalledWith("/api/import/archidekt/26039486");
  expect(deck.commanders).toBe("1 Teysa Karlov");
  expect(deck.decklist).toBe("1 Sol Ring\n2 Swamp");
});

test("every refusal the pacer can send names the way out", async () => {
  for (const status of [404, 429, 503, 502]) {
    const err = await importDeck("moxfield", "x", (async () => fail(status)) as unknown as typeof fetch).catch(
      (e: Error) => e,
    );
    // The reader is never left with only a number: each message ends in something they can do.
    expect((err as Error).message).toMatch(/paste the decklist instead|Try again/i);
  }
});

test("an unknown status still says something useful rather than leaking a number", async () => {
  const err = await importDeck("moxfield", "x", (async () => fail(418)) as unknown as typeof fetch).catch(
    (e: Error) => e,
  );
  expect((err as Error).message).toMatch(/Paste the decklist instead/);
});

test("a network failure is its own message, not a crash", async () => {
  const err = await importDeck(
    "moxfield",
    "x",
    (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch,
  ).catch((e: Error) => e);
  expect((err as Error).message).toMatch(/Could not reach the importer/);
});

test("re-exports the one shared host rule rather than repeating it", () => {
  expect(deckSourceOf("https://moxfield.com/decks/AbC")).toEqual({ source: "moxfield", id: "AbC" });
  expect(deckSourceOf("1 Sol Ring")).toBeNull();
});
