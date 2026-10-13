import { describe, expect, it } from "vitest";
import { deriveInputOf, faceLoyalties } from "./derive-input.js";

describe("faceLoyalties: the starting loyalty each face prints, from the card document (owner 2026-10-13: it comes from ingest)", () => {
  it("a single-face walker is one entry, a card with no loyalty is undefined", () => {
    expect(faceLoyalties({ loyalty: "5" })).toEqual([5]);
    expect(faceLoyalties({})).toBeUndefined();
  });
  it("a double-faced card is one entry per face, null where a face has none (Valki's creature front)", () => {
    expect(faceLoyalties({ faces: [{}, { loyalty: "5" }] })).toEqual([null, 5]);
    expect(faceLoyalties({ faces: [{}, {}] })).toBeUndefined();
  });
  it("a loyalty no counter count can be read from (X, *) is null, not 0", () => {
    expect(faceLoyalties({ loyalty: "X" })).toEqual([null]);
    expect(faceLoyalties({ faces: [{ loyalty: "*" }, { loyalty: "3" }] })).toEqual([null, 3]);
  });
  it("deriveInputOf hands it to derive", () => {
    const input = deriveInputOf({ oracleText: "", keywords: [], typeLine: "Legendary Planeswalker — Chandra", name: "C", loyalty: "5" } as never, "id", "C", []);
    expect(input.startLoyalty).toEqual([5]);
  });
});
