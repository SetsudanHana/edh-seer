import { expect, test, vi } from "vitest";
import type { Collection } from "mongodb";
import { fetchTypeLines } from "./gen-hierarchy.js";
import { buildHierarchy } from "../hierarchy.js";

/** Minimal fake Mongo collection: `find()` returns an async-iterable cursor-like object, no live DB. */
function fakeCollection(docs: Array<{ typeLine?: string }>): Pick<Collection, "find"> {
  const find = vi.fn(() => ({
    [Symbol.asyncIterator]: async function* () {
      for (const d of docs) yield d;
    },
  }));
  return { find } as unknown as Pick<Collection, "find">;
}

test("fetchTypeLines reads typeLine from every doc in the fake collection, skipping empties", async () => {
  const cards = fakeCollection([
    { typeLine: "Legendary Creature — Human Wizard" },
    { typeLine: "Artifact — Treasure" },
    {},
  ]);

  const lines = await fetchTypeLines(cards);

  expect(lines).toEqual(["Legendary Creature — Human Wizard", "Artifact — Treasure"]);
});

test("fetchTypeLines output feeds buildHierarchy end-to-end (no Mongo)", async () => {
  const cards = fakeCollection([
    { typeLine: "Legendary Creature — Human Wizard" },
    { typeLine: "Basic Land — Mountain" },
  ]);

  const lines = await fetchTypeLines(cards);
  const h = buildHierarchy(lines);

  expect(h.wizard).toContain("creature");
  expect(h.mountain).toContain("land");
});
