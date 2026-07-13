import { expect, test } from "vitest";
import { buildSnapshot } from "./build-snapshot.js";

test("buildSnapshot lowercases and shapes the three catalogs", () => {
  const snap = buildSnapshot({
    abilities: ["Flying", "Delve"],
    actions: ["Mill", "Sacrifice"],
    words: ["Landfall", "Magecraft"],
    fetchedAt: "2026-07-13T00:00:00.000Z",
  });
  expect(snap["keyword-ability"]).toEqual(["flying", "delve"]);
  expect(snap["keyword-action"]).toEqual(["mill", "sacrifice"]);
  expect(snap["ability-word"]).toEqual(["landfall", "magecraft"]);
  expect(snap.fetchedAt).toBe("2026-07-13T00:00:00.000Z");
});
