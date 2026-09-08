import { EFFECT_KINDS } from "@edh-seer/tagger/schema";
import { ARCHETYPE_SIGNATURE } from "@edh-seer/matcher/archetypes";
import type { FacetRow } from "@edh-seer/matcher/partners-core";
import { expect, test } from "vitest";
import { DOES, STRATEGIES, applyFacets, coloursFit, facetsFromParams, facetsToParams, matchedTerms } from "./facets.js";

/** FIND BY WHAT IT DOES (spec 2026-09-08 part 4): the chips name real kinds, the strategies carry
 *  signatures, colours mean subset on Cards and exact on Commanders, groups AND and chips OR. */
test("every Does chip names a real effect kind, and every Strategy option carries a signature", () => {
  for (const d of DOES) expect(EFFECT_KINDS).toContain(d.kind);
  for (const s of STRATEGIES) expect(Object.keys(ARCHETYPE_SIGNATURE)).toContain(s.slug);
  expect(STRATEGIES.find((s) => s.slug === "counters")?.label).toBe("+1/+1 Counters");
});

test("colours: subset on cards, exact on commanders, C is colourless", () => {
  expect(coloursFit("G", ["G", "W"], "cards")).toBe(true);
  expect(coloursFit("", ["G"], "cards")).toBe(true);
  expect(coloursFit("UG", ["G"], "cards")).toBe(false);
  expect(coloursFit("G", ["C"], "cards")).toBe(false);
  expect(coloursFit("", ["C"], "cards")).toBe(true);
  expect(coloursFit("WG", ["G", "W"], "commanders")).toBe(true);
  expect(coloursFit("G", ["G", "W"], "commanders")).toBe(false);
  expect(coloursFit("G", [], "cards")).toBe(true);
});

const ROWS: FacetRow[] = [
  { s: "fathom-mage", i: "UG", c: 1, e: ["draw-card"], t: ["counters"], d: ["counters"] },
  { s: "inspiring-call", i: "G", c: 0, e: ["draw-card"], t: ["counters"], d: ["counters"] },
  { s: "skullclamp", i: "", c: 0, e: ["draw-card"], t: ["aristocrats"], d: [] },
  { s: "hardened-scales", i: "G", c: 0, e: ["counter-placement"], t: ["counters"], d: [] },
  { s: "zaxara", i: "UBG", c: 1, e: ["token-generation"], t: ["counters"], d: [] },
];

test("groups AND, chips within a group OR, colours by mode", () => {
  expect(applyFacets(ROWS, { colours: ["G"], does: ["draw-card"], strategy: "counters" }, "cards").map((r) => r.s))
    .toEqual(["inspiring-call"]);
  expect(applyFacets(ROWS, { colours: [], does: ["draw-card", "counter-placement"], strategy: "counters" }, "cards").map((r) => r.s))
    .toEqual(["fathom-mage", "inspiring-call", "hardened-scales"]);
  expect(applyFacets(ROWS, { colours: [], does: [], strategy: undefined }, "cards")).toHaveLength(5);
});

test("with a strategy chosen, askers first, then suppliers, then slug; commanders only on that page", () => {
  expect(applyFacets(ROWS, { colours: [], does: [], strategy: "counters" }, "cards").map((r) => r.s))
    .toEqual(["fathom-mage", "inspiring-call", "hardened-scales", "zaxara"]);
  const out = applyFacets(ROWS, { colours: [], does: [], strategy: "counters" }, "commanders").map((r) => r.s);
  expect(out).toEqual(["fathom-mage", "zaxara"]);
});

test("the why-line names what hit", () => {
  expect(matchedTerms(ROWS[0]!, { colours: [], does: ["draw-card"], strategy: "counters" }))
    .toEqual(["draws cards", "+1/+1 Counters (asks for it)"]);
  expect(matchedTerms(ROWS[3]!, { colours: [], does: [], strategy: "counters" })).toEqual(["+1/+1 Counters"]);
  expect(matchedTerms(ROWS[2]!, { colours: [], does: [], strategy: undefined })).toEqual([]);
});

test("facets round-trip through the URL, and unknown values are dropped", () => {
  const q = { colours: ["G", "W"], does: ["draw-card", "mill"], strategy: "counters" };
  const p = facetsToParams(q, new URLSearchParams("q=kren"));
  expect(p.toString()).toBe("q=kren&colors=GW&does=draw-card%2Cmill&theme=counters");
  expect(facetsFromParams(p)).toEqual(q);
  expect(facetsFromParams(new URLSearchParams(""))).toEqual({ colours: [], does: [], strategy: undefined });
  expect(facetsFromParams(new URLSearchParams("colors=GX&does=nope,mill&theme=nope")))
    .toEqual({ colours: ["G"], does: ["mill"], strategy: undefined });
});
