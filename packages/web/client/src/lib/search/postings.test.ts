import { expect, test } from "vitest";
import { decodePostings, encodePostings } from "./postings.js";

test("empty list round-trips", () => {
  expect(decodePostings(encodePostings([]))).toEqual([]);
});
test("single row, including row 0", () => {
  expect(decodePostings(encodePostings([0]))).toEqual([0]);
  expect(decodePostings(encodePostings([34000]))).toEqual([34000]);
});
test("large gaps and dense runs round-trip", () => {
  const rows = [0, 1, 2, 127, 128, 129, 16383, 16384, 2_000_000, 2_000_001, 2 ** 31 + 5];
  expect(decodePostings(encodePostings(rows))).toEqual(rows);
});
test("a 40k-row list round-trips and is smaller than its JSON", () => {
  const rows = Array.from({ length: 40000 }, (_, i) => i * 3);
  const enc = encodePostings(rows);
  expect(decodePostings(enc)).toEqual(rows);
  expect(enc.length).toBeLessThan(JSON.stringify(rows).length);
});
test("unsorted or duplicate rows are refused", () => {
  expect(() => encodePostings([3, 2])).toThrow();
  expect(() => encodePostings([2, 2])).toThrow();
});
