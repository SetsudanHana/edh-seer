import { EFFECT_KINDS } from "@edh-seer/tagger/schema";
import { ARCHETYPE_SIGNATURE } from "@edh-seer/matcher/archetypes";
import type { FacetRow } from "@edh-seer/matcher/partners-core";
import { expect, test } from "vitest";
import { DOES, STRATEGIES, applyFacets, coloursFit, facetsFromParams, facetsToParams, matchedTerms, rateLabel } from "./facets.js";

/** FIND BY WHAT IT DOES (spec 2026-09-08 part 4): the chips name real kinds, the strategies carry
 *  signatures, colours mean subset on Cards and exact on Commanders, groups AND and chips OR. */
test("every Does chip names a real effect kind, and every Strategy option carries a signature", () => {
  for (const d of DOES) expect(EFFECT_KINDS).toContain(d.kind);
  for (const s of STRATEGIES) expect(Object.keys(ARCHETYPE_SIGNATURE)).toContain(s.slug);
  expect(STRATEGIES.find((s) => s.slug === "counters")?.label).toBe("+1/+1 Counters");
});

test("colours: exact identity on both pages, C is colourless, none means any", () => {
  expect(coloursFit("WG", ["G", "W"], "cards")).toBe(true);
  expect(coloursFit("G", ["G", "W"], "cards")).toBe(false);
  expect(coloursFit("", ["G"], "cards")).toBe(false);
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

test("groups AND, chips within a group OR, exact colours", () => {
  expect(applyFacets(ROWS, { colours: ["G"], does: ["draw-card"], strategy: "counters" }, "cards").map((r) => r.s))
    .toEqual(["inspiring-call"]);
  expect(applyFacets(ROWS, { colours: [], does: ["draw-card", "counter-placement"], strategy: "counters" }, "cards").map((r) => r.s))
    .toEqual(["fathom-mage", "inspiring-call", "hardened-scales"]);
  expect(applyFacets(ROWS, { colours: [], does: [], strategy: undefined }, "cards")).toHaveLength(5);
});

test("more chosen chips matched puts a card higher (owner 2026-09-08)", () => {
  const rows: FacetRow[] = [
    { s: "one", i: "", c: 0, e: ["draw-card"], t: [], d: [] },
    { s: "both", i: "", c: 0, e: ["draw-card", "mill"], t: [], d: [] },
    { s: "also-one", i: "", c: 0, e: ["mill"], t: [], d: [] },
  ];
  expect(applyFacets(rows, { colours: [], does: ["draw-card", "mill"], strategy: undefined }, "cards").map((r) => r.s))
    .toEqual(["both", "also-one", "one"]);
});

/** EQUAL ROWS ORDER BY PARTNER COUNT BEFORE SLUG (owner 2026-09-17). "makes tokens, in red" opened
 *  on three Aether cards because nothing but the alphabet separated 467 equal rows. */
test("equal rows list the best-connected card first, then slug", () => {
  const rows: FacetRow[] = [
    { s: "aether", i: "R", c: 0, e: ["token-generation"], t: [], d: [], p: 12 },
    { s: "krenko", i: "R", c: 1, e: ["token-generation"], t: [], d: [], p: 2400 },
    { s: "zealous", i: "R", c: 0, e: ["token-generation"], t: [], d: [], p: 12 },
    { s: "uncounted", i: "R", c: 0, e: ["token-generation"], t: [], d: [] },
  ];
  expect(applyFacets(rows, { colours: [], does: ["token-generation"], strategy: undefined }, "cards").map((r) => r.s))
    .toEqual(["krenko", "aether", "zealous", "uncounted"]);
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

/** ONE DOES CHIP SORTS BY ITS RATE (spec 2026-09-04 step 3): floor per mana, ceiling to break it,
 *  the cards that state one above the ones that do not; two chips get no rate order. */
test("a single rated chip orders by floor per mana, rated above unrated; two chips do not", () => {
  const rows: FacetRow[] = [
    { s: "rhystic-study", i: "U", c: 0, e: ["draw-card"], t: [], d: [], p: 900, r: { cards: [0, 3, null, 3] } },
    { s: "unrated", i: "U", c: 0, e: ["draw-card"], t: [], d: [], p: 2000 },
    { s: "divination", i: "U", c: 0, e: ["draw-card"], t: [], d: [], r: { cards: [2, 3, 2, 3] } },
    { s: "brainstorm", i: "U", c: 0, e: ["draw-card"], t: [], d: [], r: { cards: [1, 1, 1, 1] } },
    { s: "fiery-gambit", i: "R", c: 0, e: ["draw-card", "damage"], t: [], d: [], r: { cards: [0, 3, 9, 3], damage: [0, 3, 3, 3] } },
    { s: "jayemdae-tome", i: "", c: 0, e: ["draw-card"], t: [], d: [], r: { cards: [1, 8, 1, 4] } },
  ];
  expect(applyFacets(rows, { colours: [], does: ["draw-card"], strategy: undefined }, "cards").map((r) => r.s))
    .toEqual(["brainstorm", "divination", "jayemdae-tome", "rhystic-study", "fiery-gambit", "unrated"]);
  expect(applyFacets(rows, { colours: [], does: ["draw-card", "damage"], strategy: undefined }, "cards").map((r) => r.s))
    .toEqual(["fiery-gambit", "unrated", "rhystic-study", "brainstorm", "divination", "jayemdae-tome"]);
  const q = { colours: [], does: ["draw-card"], strategy: undefined };
  expect(matchedTerms(rows[3]!, q)).toEqual(["draws cards", "1 card / 1 mana"]);
  expect(matchedTerms(rows[2]!, q)).toEqual(["draws cards", "2 cards / 3 mana"]);
  expect(matchedTerms(rows[0]!, q)).toEqual(["draws cards", "0+ cards / 3 mana"]);
  expect(matchedTerms(rows[4]!, q)).toEqual(["draws cards", "0–9 cards / 3 mana"]);
  expect(matchedTerms(rows[5]!, q)).toEqual(["draws cards", "1 card / 8 mana, then 1 / 4"]);
  expect(matchedTerms(rows[4]!, { ...q, does: ["damage"] })).toEqual(["deals damage", "0–3 damage / 3 mana"]);
  expect(matchedTerms(rows[1]!, q)).toEqual(["draws cards"]);
  expect(rateLabel([0, 3, 0, 3], "cards")).toBe("0 cards / 3 mana");
  expect(rateLabel([2, 1, 2, 0], "mana")).toBe("2 mana / 1 mana, then 2 / 0");
  expect(rateLabel([1, 1, 1, 0, 1], "mana")).toBe("1 mana / 1 mana, then 1 / 0, from next turn");
  expect(rateLabel([3, 2, 3, 2], "life")).toBe("3 life / 2 mana");
  expect(rateLabel([0, 2, null, 2], "life-loss")).toBe("0+ life / 2 mana");
  expect(rateLabel([10, 2, 10, 2], "mill")).toBe("10 cards / 2 mana");
  expect(rateLabel([1, 2, 1, 2], "tokens")).toBe("1 token / 2 mana");
  expect(rateLabel([2, 3, 2, 3], "counters")).toBe("2 counters / 3 mana");
  expect(DOES.filter((d) => d.rate).map((d) => d.kind)).toEqual(["draw-card", "token-generation", "counter-placement", "mana-generation", "lifegain", "damage", "player-life-loss", "mill"]);
  const rocks: FacetRow[] = [
    { s: "commanders-sphere", i: "", c: 0, e: ["draw-card", "mana-generation"], t: [], d: [], r: { mana: [1, 3, 1, 0] } },
    { s: "sol-ring", i: "", c: 0, e: ["mana-generation"], t: [], d: [], r: { mana: [2, 1, 2, 0] } },
    { s: "arcane-signet", i: "", c: 0, e: ["mana-generation"], t: [], d: [], r: { mana: [1, 2, 1, 0] } },
  ];
  expect(applyFacets(rocks, { colours: [], does: ["mana-generation"], strategy: undefined }, "cards").map((r) => r.s))
    .toEqual(["sol-ring", "arcane-signet", "commanders-sphere"]);
});
