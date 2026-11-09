import { describe, expect, test } from "vitest";
import { deriveCardTags, deriveInputOf } from "@edh-seer/tagger";
import type { CardTags, ClauseRecord } from "@edh-seer/tagger";
import { loadHierarchy, pairReasons } from "./index.js";
import type { DeckCard } from "./types.js";
import fixtures from "./aura-direct-route.fixtures.json" with { type: "json" };

/** #1575 part 3: THE DIRECT ROUTE FROM A REMOVAL TO AN AURA'S OWN LEAVE TRIGGER. An enchantment- or permanent-typed removal event cannot be shown to be an Aura by the subtype test of the Aura's self trigger, so "Destroy all enchantments"
 *  (Cleanfall) formed no pair with Parallax Dementia or Reality Acid. Oracle text and clause records are the corpus's own, dumped from Mongo 2026-11-09 (DERIVE 480). */
type Fx = { source: Record<string, unknown>; canonical: ClauseRecord[] };
const F = fixtures as unknown as Record<string, Fx>;
const H = loadHierarchy();
const D: Record<string, DeckCard> = {};
const card = (name: string): DeckCard => (D[name] ??= { card: F[name]!.source as unknown as DeckCard["card"], tags: deriveCardTags(deriveInputOf(F[name]!.source as never, name, name, F[name]!.canonical)) as CardTags });
const leaveTags = (producer: string, consumer: string) =>
  pairReasons(card(producer), card(consumer), H).filter((r) => r.consumer === consumer && /^(leaves|dies|exiled)\b/.test(r.tag)).map((r) => r.tag);

describe("enchantment removal x an Aura's own leave trigger", () => {
  test.each(["Parallax Dementia", "Reality Acid", "Rancor"])("Cleanfall (\"Destroy all enchantments\") -> %s: pairs", (aura) => {
    expect(leaveTags("Cleanfall", aura).length).toBeGreaterThan(0);
  });
  test.each(["Parallax Dementia", "Reality Acid", "Rancor"])("Disenchant (a target enchantment) -> %s: pairs", (aura) => {
    expect(leaveTags("Disenchant", aura).length).toBeGreaterThan(0);
  });
  test.each(["Parallax Dementia", "Reality Acid", "Rancor"])("Worldslayer (\"Destroy all permanents other than this Equipment\") -> %s: pairs", (aura) => {
    expect(leaveTags("Worldslayer", aura).length).toBeGreaterThan(0);
  });
  test.each(["Parallax Dementia", "Reality Acid"])("Saw (sacrifice a permanent) and Mythos of Nethroi (destroy a nonland permanent) -> %s: pair", (aura) => {
    expect(leaveTags("Saw", aura).length).toBeGreaterThan(0);
    expect(leaveTags("Mythos of Nethroi", aura).length).toBeGreaterThan(0);
  });
  test.each(["Banishing Light", "Invoke Despair", "End Hostilities", "Murder", "Wrath of God"])("%s -> Parallax Dementia and Reality Acid: none (the host route's rules hold on the direct route)", (producer) => {
    expect(leaveTags(producer, "Parallax Dementia")).toEqual([]);
    expect(leaveTags(producer, "Reality Acid")).toEqual([]);
  });
  test("Tranquil Domain (\"Destroy all non-Aura enchantments\") -> Reality Acid: none", () => {
    expect(leaveTags("Tranquil Domain", "Reality Acid")).toEqual([]);
  });
  test("Pyroblast (\"Destroy target permanent if it's blue\"): Reality Acid is blue, Parallax Dementia is not", () => {
    expect(leaveTags("Pyroblast", "Parallax Dementia")).toEqual([]);
    expect(leaveTags("Pyroblast", "Reality Acid").length).toBeGreaterThan(0);
  });
  test("Thraben Exorcism -> Reality Acid still pairs through its own enchantment alternative", () => {
    expect(leaveTags("Thraben Exorcism", "Reality Acid").length).toBeGreaterThan(0);
  });
  test("a removal never reaches a creature's own leave trigger through this route (Primeval Spawn is no Aura)", () => {
    expect(leaveTags("Cleanfall", "Primeval Spawn")).toEqual([]);
  });
  test.each([
    ["Bomb Squad", "Spirit Loop"], ["Cut the Tethers", "Parallax Dementia"], ["Ashling, the Limitless", "Slow Motion"], ["Slogurk, the Overslime", "Gift of Wrath"],
  ])("%s -> %s: an UNTYPED removal (a bare 'it') says nothing about an Aura and pairs nothing", (producer, aura) => {
    expect(leaveTags(producer, aura)).toEqual([]);
  });
  test("Apocalypse Chime (permanents with a Homelands name: a named set the engine cannot test) -> Spreading Algae: none", () => {
    expect(leaveTags("Apocalypse Chime", "Spreading Algae")).toEqual([]);
  });
});

/** #1579 part 1: BOTH ROUTES READ `selection` THE SAME WAY (aura-reach.ts `selectionCanIncludeAura`). A mass the players pick from can take your Aura; a set the card defined, a vote over permanents you don't control and a name list cannot.
 *  Oracle text: Cataclysm "Each player chooses from among the permanents they control an artifact, a creature, an enchantment, and a land, then sacrifices the rest."; Pox Plague "... sacrifices half the permanents they control of their choice"; Whims of the Fates "separates
 *  all permanents they control into three piles"; Renounce "Sacrifice any number of permanents"; Selective Obliteration "exile each permanent unless it's colorless or it's only the color its controller chose"; Liliana of the Veil -6 "Separate all permanents target player controls into two piles";
 *  Council's Judgment "votes for a nonland permanent you don't control"; Druid of Purification "an artifact or enchantment you don't control. Destroy each permanent chosen this way".
 *  Parallax Dementia and Reality Acid act on their host, so they pair only when the producer can take the Aura itself (the host is gone by then). A creature-host Aura such as Rancor also pairs through "the creature it enchants dies", so it cannot tell the routes apart: the pair census does. */
describe("a selection-marked mass x an Aura that acts on its host", () => {
  test.each(["Cataclysm", "Pox Plague", "Whims of the Fates", "Renounce", "Selective Obliteration", "Liliana of the Veil"])("%s -> Parallax Dementia and Reality Acid: pairs", (producer) => {
    expect(leaveTags(producer, "Parallax Dementia").length).toBeGreaterThan(0);
    expect(leaveTags(producer, "Reality Acid").length).toBeGreaterThan(0);
  });
  test.each(["Council's Judgment", "Druid of Purification", "Journey to the Lost City"])("%s -> Parallax Dementia and Reality Acid: none", (producer) => {
    expect(leaveTags(producer, "Parallax Dementia")).toEqual([]);
    expect(leaveTags(producer, "Reality Acid")).toEqual([]);
  });
});
