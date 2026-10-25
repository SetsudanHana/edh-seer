import { describe, expect, test } from "vitest";
import type { CardTags } from "@edh-seer/tagger";
import fixtures from "./similar.fixtures.json" with { type: "json" };
import { findRedundancy, type RedundancyCandidate } from "./redundancy.js";
import type { SimilarCard } from "./similar.js";

const names = Object.keys(fixtures) as (keyof typeof fixtures)[];
const cards: SimilarCard[] = names.map((n, i) => ({ id: i + 1, name: n, tags: (fixtures[n] as unknown as { tags: CardTags }).tags }));
const card = (n: keyof typeof fixtures) => cards.find((c) => c.name === n)!;
const cand = (n: keyof typeof fixtures, inDeck = false, sharedPartners: string[] = []): RedundancyCandidate => ({ card: card(n), inDeck, sharedPartners });
const base = { seed: card("Impact Tremors"), seedPartners: ["A", "B", "C"], amplifiers: [] as string[], identity: null as string[] | null };
const find = (hits: ReturnType<typeof findRedundancy>, n: string) => hits.find((h) => h.name === n);

describe("findRedundancy, Impact Tremors seed", () => {
  const candidates = [cand("Witty Roastmaster"), cand("Corpse Knight"), cand("Impact Tremors")];
  test("tiers", () => {
    const hits = findRedundancy({ ...base, candidates });
    expect(find(hits, "Witty Roastmaster")?.tier).toBe("close");
    expect(find(hits, "Corpse Knight")?.tier).toBe("outcome");
    expect(find(hits, "Impact Tremors")).toBeUndefined();
  });
  test("amplifier loss only on the life-loss substitute", () => {
    const withAmp = findRedundancy({ ...base, candidates, amplifiers: ["Fiery Emancipation"] });
    expect(find(withAmp, "Corpse Knight")?.deckChips).toContainEqual({ dim: "amplifier", label: "loses synergy with Fiery Emancipation" });
    expect(find(withAmp, "Witty Roastmaster")?.deckChips.some((c) => c.dim === "amplifier")).toBe(false);
    const without = findRedundancy({ ...base, candidates });
    expect(find(without, "Corpse Knight")?.deckChips.some((c) => c.dim === "amplifier")).toBe(false);
  });
  test("a candidate's own amplifier list replaces the global one: an amplifier that also boosts it is no loss", () => {
    const hits = findRedundancy({ ...base, candidates: [{ ...cand("Corpse Knight"), amplifiers: [] }, cand("Corpse Knight")], amplifiers: ["Fiery Emancipation"] });
    expect(hits).toHaveLength(1); // one card, merged by name: the first entry's list wins
    expect(hits[0]!.deckChips.some((c) => c.dim === "amplifier")).toBe(false);
    const kept = findRedundancy({ ...base, candidates: [{ ...cand("Corpse Knight"), amplifiers: ["X"] }], amplifiers: ["Fiery Emancipation"] });
    expect(kept[0]!.deckChips).toContainEqual({ dim: "amplifier", label: "loses synergy with X" });
  });
  test("two amplifiers read with 'and'", () => {
    const hits = findRedundancy({ ...base, candidates, amplifiers: ["X", "Y"] });
    expect(find(hits, "Corpse Knight")?.deckChips).toContainEqual({ dim: "amplifier", label: "loses synergy with X and Y" });
  });
  test("a damage candidate for a life-loss seed gains the amplifier, so no loss chip", () => {
    const hits = findRedundancy({ ...base, seed: card("Corpse Knight"), candidates: [cand("Impact Tremors")], amplifiers: ["Fiery Emancipation"] });
    expect(hits[0]?.tier).toBe("outcome");
    expect(hits[0]?.deckChips.some((c) => c.dim === "amplifier")).toBe(false);
  });
  test("many amplifiers are summarised", () => {
    const hits = findRedundancy({ ...base, candidates, amplifiers: ["X", "Y", "Z"] });
    expect(find(hits, "Corpse Knight")?.deckChips).toContainEqual({ dim: "amplifier", label: "loses synergy with X and 2 others" });
  });
});

describe("ranking, identity, deck chips, caps", () => {
  const seed = card("Soul Warden");
  const b = { ...base, seed };
  test("more shared partners ranks first within a tier", () => {
    const hits = findRedundancy({ ...b, candidates: [cand("Essence Warden", false, ["A"]), cand("Soul's Attendant", false, ["A", "B"])] });
    expect(hits.map((h) => h.name)).toEqual(["Soul's Attendant", "Essence Warden"]);
    expect(hits[0]!.deckChips).toContainEqual({ dim: "shared", label: "shares 2 of 3 partners" });
  });
  test("identity drops outsiders unless already in the deck", () => {
    const cs = [cand("Blood Artist")];
    expect(findRedundancy({ ...b, identity: ["W"], candidates: cs }).map((h) => h.name)).toEqual([]);
    const kept = findRedundancy({ ...b, identity: ["W"], candidates: [cand("Blood Artist", true)] });
    expect(kept.map((h) => h.name)).toEqual(["Blood Artist"]);
    expect(kept[0]!.deckChips).toContainEqual({ dim: "deck", label: "in your deck" });
  });
  test("[] is colourless: a coloured outsider is dropped, an in-deck one kept", () => {
    expect(findRedundancy({ ...b, identity: [], candidates: [cand("Essence Warden")] })).toEqual([]);
    expect(findRedundancy({ ...b, identity: [], candidates: [cand("Essence Warden", true)] }).map((h) => h.name)).toEqual(["Essence Warden"]);
  });
  test("duplicate names merge: union of partners, inDeck from either copy", () => {
    const hits = findRedundancy({ ...b, candidates: [cand("Essence Warden", false, ["A"]), cand("Essence Warden", true, ["B"])] });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.sharedPartners.sort()).toEqual(["A", "B"]);
    expect(hits[0]!.deckChips).toContainEqual({ dim: "deck", label: "in your deck" });
    expect(hits[0]!.deckChips).toContainEqual({ dim: "shared", label: "shares 2 of 3 partners" });
  });
  test("perTier cap ignores in-deck hits; duplicates merge", () => {
    const cs = [cand("Essence Warden"), cand("Soul's Attendant"), cand("Auriok Champion", true), cand("Essence Warden", true)];
    const hits = findRedundancy({ ...b, candidates: cs }, { perTier: { same: 1, close: 0 } });
    expect(hits.filter((h) => h.tier === "same").length).toBe(2);
    expect(hits.filter((h) => h.tier === "close").map((h) => h.name)).toEqual(["Auriok Champion"]);
    expect(hits.filter((h) => h.name === "Essence Warden").length).toBe(1);
  });
});
