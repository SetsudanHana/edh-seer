import { describe, expect, test } from "vitest";
import { ChipTable, decodeSimilar, encodeSimilar } from "./similar-shard.js";

const index = [
  { slug: "soul-warden", name: "Soul Warden" },
  { slug: "essence-warden", name: "Essence Warden" },
  { slug: "blood-artist", name: "Blood Artist" },
];

describe("similar shard codec", () => {
  test("round trips tier, chips and the candidate's name and slug", () => {
    const table = new ChipTable();
    const enc = encodeSimilar([
      { id: 1, name: "Essence Warden", tier: "same", score: 0, chips: [] },
      { id: 2, name: "Blood Artist", tier: "output", score: 3, chips: [{ dim: "trigger", label: "when a creature dies" }, { dim: "extra", label: "+ life loss" }] },
    ], table);
    expect(enc).toEqual([[1, 0], [2, 2, 0, 1]]);
    expect(decodeSimilar(enc, index, table.chips)).toEqual([
      { name: "Essence Warden", slug: "essence-warden", tier: "same", chips: [] },
      { name: "Blood Artist", slug: "blood-artist", tier: "output", chips: [{ dim: "trigger", label: "when a creature dies" }, { dim: "extra", label: "+ life loss" }] },
    ]);
  });

  test("a chip label is interned once across lists", () => {
    const table = new ChipTable();
    const hit = (id: number) => ({ id, name: "x", tier: "close" as const, score: 0, chips: [{ dim: "extra" as const, label: "+ protection" }] });
    encodeSimilar([hit(1)], table);
    encodeSimilar([hit(2)], table);
    expect(table.chips).toEqual([["extra", "+ protection"]]);
  });

  test("an old shard (no list) reads as empty, and a row the index cannot name is dropped", () => {
    expect(decodeSimilar(undefined, index, [])).toEqual([]);
    expect(decodeSimilar([[99, 0], [1, 1], [2, 0, 7]], index, [])).toEqual([{ name: "Essence Warden", slug: "essence-warden", tier: "close", chips: [] }]);
  });
});
