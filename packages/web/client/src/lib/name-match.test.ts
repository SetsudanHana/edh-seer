import { expect, test } from "vitest";
import { matchNames, needleOf } from "./name-match.js";
import type { NameIndexEntry } from "./partners.js";

const INDEX: NameIndexEntry[] = [
  { slug: "krenko-mob-boss", name: "Krenko, Mob Boss", identity: ["R"], commander: true },
  { slug: "krenko-tin-street-kingpin", name: "Krenko, Tin Street Kingpin", identity: ["R"], commander: true },
  { slug: "skullclamp", name: "Skullclamp", identity: [], commander: false },
  { slug: "kess-dissident-mage", name: "Kess, Dissident Mage", identity: ["U", "B", "R"], commander: true },
];

test("the needle is the slug of the query", () => {
  expect(needleOf("  Krenko, Mob ")).toBe("krenko-mob");
  expect(needleOf("")).toBe("");
});

test("an empty query with no colour matches nothing, not everything", () => {
  expect(matchNames(INDEX, { query: "" })).toEqual([]);
  expect(matchNames(INDEX, { query: "   ", commanders: true })).toEqual([]);
});

test("a needle is a substring match on the slug, in index order", () => {
  expect(matchNames(INDEX, { query: "krenko" }).map((e) => e.slug))
    .toEqual(["krenko-mob-boss", "krenko-tin-street-kingpin"]);
  expect(matchNames(INDEX, { query: "clamp" }).map((e) => e.slug)).toEqual(["skullclamp"]);
});

test("commanders only, when asked", () => {
  expect(matchNames(INDEX, { query: "k", commanders: true }).map((e) => e.slug))
    .toEqual(["krenko-mob-boss", "krenko-tin-street-kingpin", "kess-dissident-mage"]);
});

test("a colour choice is exact identity, and C is colourless", () => {
  expect(matchNames(INDEX, { query: "", commanders: true, colours: ["R"] }).map((e) => e.slug))
    .toEqual(["krenko-mob-boss", "krenko-tin-street-kingpin"]);
  expect(matchNames(INDEX, { query: "", commanders: true, colours: ["U", "B", "R"] }).map((e) => e.slug))
    .toEqual(["kess-dissident-mage"]);
  expect(matchNames(INDEX, { query: "", colours: ["C"] }).map((e) => e.slug)).toEqual(["skullclamp"]);
});

test("limit slices the result", () => {
  expect(matchNames(INDEX, { query: "k" }, 1).map((e) => e.slug)).toEqual(["krenko-mob-boss"]);
});
