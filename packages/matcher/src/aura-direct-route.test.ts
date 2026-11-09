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
});
