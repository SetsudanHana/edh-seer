import { expect, test } from "vitest";
import { buildAxis, maxAxisWeight, axisFactor, axisWeightOf, relationThemeFreq, RELATION_PARENTS, ZERO_ON_PURPOSE, OWN_THEME_FAMILIES } from "./axis.js";
import type { TagStats } from "@edh-seer/engine";

// 'draw:any' is universal (on ~all N cards → idf≈0); 'dies:creature' is distinctive (rare).
const stats: TagStats = { N: 1000, counts: { "draw:any": 990, "dies:creature": 40 } };

test("a universal tag (idf≈0) drops out; a distinctive tag dominates the axis", () => {
  const deckFreq = new Map([["draw:any", 12], ["dies:creature", 8]]);
  const axis = buildAxis(new Set(), deckFreq, stats);
  expect(axis.get("dies:creature")).toBe(1); // strongest tf-idf → normalized to 1
  expect(axis.get("draw:any") ?? 0).toBeLessThan(0.1); // near-zero, effectively de-noised
});

test("commander tags get a TF boost anchor, still gated by idf", () => {
  const deckFreq = new Map([["dies:creature", 8], ["draw:any", 12]]);
  const boosted = buildAxis(new Set(["dies:creature"]), deckFreq, stats);
  const plain = buildAxis(new Set(), deckFreq, stats);
  expect(boosted.get("dies:creature")! >= plain.get("dies:creature")!).toBe(true);
  // a generic commander tag can't take over: draw:any stays low even if commander-flagged.
  const genericCmd = buildAxis(new Set(["draw:any"]), deckFreq, stats);
  expect(genericCmd.get("draw:any") ?? 0).toBeLessThan(0.5);
});

test("empty/degenerate input yields an empty axis (no divide-by-zero)", () => {
  expect(buildAxis(new Set(), new Map(), stats).size).toBe(0);
  const allUniversal: TagStats = { N: 10, counts: { "draw:any": 10 } }; // idf(draw:any)=log(11/11)=0
  expect(buildAxis(new Set(), new Map([["draw:any", 5]]), allUniversal).size).toBe(0);
});

test("maxAxisWeight returns the strongest reason weight, 0 when none on-axis", () => {
  const axis = new Map([["dies:creature", 1], ["sacrifice:creature", 0.4]]);
  expect(maxAxisWeight([{ tag: "dies:creature" }, { tag: "x" }] as never, axis)).toBe(1);
  expect(maxAxisWeight([{ tag: "unknown" }] as never, axis)).toBe(0);
});

test("axisFactor rides the new weights (1 + boost*maxWeight)", () => {
  const axis = new Map([["dies:creature", 1]]);
  expect(axisFactor([{ tag: "dies:creature" }] as never, axis, 1.5)).toBeCloseTo(2.5);
  expect(axisFactor([{ tag: "x" }] as never, axis, 1.5)).toBe(1);
});

test("fodder inherits the stronger of its parents' axis weight", () => {
  const axis = new Map([["sacrifice:creature", 0.4], ["dies:creature", 0.7]]);
  expect(maxAxisWeight([{ tag: "fodder:creature" } as never], axis)).toBe(0.7);
});

test("scales inherits create-token; 0 with no parent on the axis", () => {
  expect(maxAxisWeight([{ tag: "scales:goblin" } as never], new Map([["create-token:goblin", 0.5]]))).toBe(0.5);
  expect(maxAxisWeight([{ tag: "scales:goblin" } as never], new Map())).toBe(0);
});

test("an explicit axis entry wins over the parent", () => {
  const axis = new Map([["cheat:creature", 1], ["enters:creature", 0.2]]);
  expect(maxAxisWeight([{ tag: "cheat:creature" } as never], axis)).toBe(1);
});

test("an unmapped relation family weighs 0; an ordinary tag reads its own weight", () => {
  // No `mystery:creature` entry: the lookup must reach the parent code and find no parent for it,
  // even though `enters:creature` is on the axis.
  const axis = new Map([["enters:creature", 0.9], ["draw:any", 0.3]]);
  expect(maxAxisWeight([{ tag: "mystery:creature" } as never], axis)).toBe(0);
  expect(maxAxisWeight([{ tag: "draw:any" } as never], axis)).toBe(0.3);
});

test("a fact kind's static tag (static:evasion) never counts toward the deck's axis (#1315)", async () => {
  const { axisThemeTags, isFactStaticTag } = await import("./edges.js");
  const tag = (kind: string) => ({ oracleId: kind, abilities: [{ kind: "static", effect: { kind } }], characteristics: { types: ["Enchantment"], subtypes: [] } }) as never;
  expect(isFactStaticTag("static:evasion")).toBe(true);
  expect(isFactStaticTag("static:pump")).toBe(false);
  expect(isFactStaticTag("enters:creature")).toBe(false);
  const tags = axisThemeTags(tag("evasion"));
  expect(tags.has("static:evasion")).toBe(false);
  expect(axisThemeTags(tag("pump")).has("static:pump")).toBe(true);
});

// #1095 (owner ruling 2026-11-16, "Mixed"). 1: a family with a natural parent inherits its weight.
test("graveyard-recursion and recursion-target inherit dies / enters-graveyard on the same subject", () => {
  const dies = new Map([["dies:creature", 0.6]]);
  const fill = new Map([["enters-graveyard:creature", 0.8], ["dies:creature", 0.3]]);
  for (const fam of ["graveyard-recursion", "recursion-target"]) {
    expect(axisWeightOf(`${fam}:creature`, dies)).toBe(0.6);
    expect(axisWeightOf(`${fam}:creature`, fill)).toBe(0.8);
    expect(axisWeightOf(`${fam}:artifact`, fill)).toBe(0); // another subject is another theme
  }
});

// Owner amendment 2026-11-16: a prowess-style self-pump is a helper, not a synergy (#517).
test("prowess stays at 0 even when cast:-creature is the deck's top theme", () => {
  const axis = new Map([["cast:-creature", 1], ["cast:spell", 0.8]]);
  expect(axisWeightOf("prowess:-creature", axis)).toBe(0);
  expect(maxAxisWeight([{ tag: "prowess:-creature" } as never], axis)).toBe(0);
  expect(Object.hasOwn(RELATION_PARENTS, "prowess")).toBe(false);
});

test("threshold inherits enters-graveyard", () => {
  expect(axisWeightOf("threshold:creature", new Map([["enters-graveyard:creature", 0.4]]))).toBe(0.4);
  expect(axisWeightOf("threshold:land", new Map([["enters-graveyard:land", 0.7], ["dies:land", 0.9]]))).toBe(0.7); // dies is not threshold's parent
});

// 2: left at 0 ON PURPOSE (owner 2026-11-16): mana-base links are not the plan.
test("ramp-target, land-condition and prowess stay at 0 on purpose, whatever the axis holds", () => {
  expect([...ZERO_ON_PURPOSE].sort()).toEqual(["land-condition", "prowess", "ramp-target"]);
  const axis = new Map([["enters:basic", 1], ["enters:land", 1], ["enters:plains", 1]]);
  expect(axisWeightOf("ramp-target:basic", axis)).toBe(0);
  expect(axisWeightOf("land-condition:plains", axis)).toBe(0);
  // not an accident of absence: the three lists never overlap
  for (const f of ZERO_ON_PURPOSE) {
    expect(Object.hasOwn(RELATION_PARENTS, f)).toBe(false);
    expect(OWN_THEME_FAMILIES).not.toContain(f);
  }
  for (const f of OWN_THEME_FAMILIES) expect(Object.hasOwn(RELATION_PARENTS, f)).toBe(false);
});

// The #972 review's finding: the graveyard-scaling channel keys `scales:creature` too.
test("a graveyard-scaling reason takes the dies / enters-graveyard weight, never the board's enters / create-token", () => {
  const etb = new Map([["enters:creature", 0.9], ["create-token:creature", 0.8]]);
  const gy = { tag: "scales:creature", scaling: "per-graveyard" } as never;
  const board = { tag: "scales:creature", scaling: "per-permanent" } as never;
  expect(maxAxisWeight([gy], etb)).toBe(0);
  expect(maxAxisWeight([board], etb)).toBe(0.9);
  const aristocrats = new Map([["dies:creature", 0.7]]);
  expect(maxAxisWeight([gy], aristocrats)).toBe(0.7);
  expect(maxAxisWeight([board], aristocrats)).toBe(0);
  expect(maxAxisWeight([gy], new Map([["enters-graveyard:creature", 0.5]]))).toBe(0.5);
});

// 3: the rest are deck themes of their own: in-deck frequency x rarity, the buildAxis statistic.
test("an own-theme relation weighs deckFreq x idf over the strongest theme, capped at 1, themes untouched", () => {
  const deckFreq = new Map([["dies:creature", 8]]);
  const themes = buildAxis(new Set(), deckFreq, stats);
  const rel = { freq: new Map([["tutor:creature", 6]]), stats: { N: 71, counts: { "tutor:creature": 35 } } as TagStats };
  const axis = buildAxis(new Set(), deckFreq, stats, rel);
  const themeMax = 8 * Math.log(1001 / 41);
  expect(axis.get("tutor:creature")).toBeCloseTo((6 * Math.log(72 / 36)) / themeMax, 10);
  expect(axis.get("dies:creature")).toBe(themes.get("dies:creature"));
  const heavy = buildAxis(new Set(), deckFreq, stats, { ...rel, freq: new Map([["tutor:creature", 500]]) });
  expect(heavy.get("tutor:creature")).toBe(1);
  expect(heavy.get("dies:creature")).toBe(1); // a relation never moves a theme's weight
});

test("a relation tag outside OWN_THEME_FAMILIES, or on a deck with no theme at all, gets no weight", () => {
  const rel = { freq: new Map([["ramp-target:basic", 9], ["fodder:creature", 9], ["tutor:creature", 3]]), stats: { N: 71, counts: {} } as TagStats };
  const axis = buildAxis(new Set(), new Map([["dies:creature", 8]]), stats, rel);
  expect(axis.has("ramp-target:basic")).toBe(false);
  expect(axis.has("fodder:creature")).toBe(false);
  expect(axis.has("tutor:creature")).toBe(true);
  expect(buildAxis(new Set(), new Map(), stats, rel).size).toBe(0);
});

test("relationThemeFreq counts the cards holding the relation: the smaller of its producers and consumers", () => {
  const r = (tag: string, producer: string, consumer: string) => ({ tag, producer, consumer }) as never;
  const reasons = [
    // two tutors, five creatures they find: the tutors are the deck's frequency
    ...["Tutor A", "Tutor B"].flatMap((t) => ["C1", "C2", "C3", "C4", "C5"].map((c) => r("tutor:creature", t, c))),
    // one threshold card, three fillers: the one card
    ...["F1", "F2", "F3"].map((f) => r("threshold:any", f, "Threshold Card")),
    // a family that is not its own theme is not counted
    r("ramp-target:basic", "Rampant", "Plains"),
    r("fodder:creature", "X", "Y"),
    // a reason that names no cards counts for nothing
    { tag: "tutor:land" } as never,
  ];
  const f = relationThemeFreq(reasons);
  expect(f.get("tutor:creature")).toBe(2);
  expect(f.has("threshold:any")).toBe(false); // threshold has a parent, so it is not an own theme
  expect(f.has("ramp-target:basic")).toBe(false);
  expect(f.has("fodder:creature")).toBe(false);
  expect(f.has("tutor:land")).toBe(false);
});
