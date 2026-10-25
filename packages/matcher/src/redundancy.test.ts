import { describe, expect, test } from "vitest";
import type { CardTags } from "@edh-seer/tagger";
import fixtures from "./similar.fixtures.json" with { type: "json" };
import { findRedundancy, type RedundancyCandidate } from "./redundancy.js";
import type { SimilarCard } from "./similar.js";

const names = Object.keys(fixtures) as (keyof typeof fixtures)[];
const cards: SimilarCard[] = names.map((n, i) => ({ id: i + 1, name: n, tags: (fixtures[n] as unknown as { tags: CardTags }).tags }));
const card = (n: keyof typeof fixtures) => cards.find((c) => c.name === n)!;
const cand = (n: keyof typeof fixtures, inDeck = false, sharedPartners: string[] = []): RedundancyCandidate => ({ card: card(n), inDeck, sharedPartners });
const base = { seed: card("Impact Tremors"), seedPartners: ["A", "B", "C"], amplifiers: [] as string[], identity: [] as string[] };
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
    expect(find(withAmp, "Corpse Knight")?.deckChips).toContainEqual({ dim: "amplifier", label: "loses Fiery Emancipation synergy" });
    expect(find(withAmp, "Witty Roastmaster")?.deckChips.some((c) => c.dim === "amplifier")).toBe(false);
    const without = findRedundancy({ ...base, candidates });
    expect(find(without, "Corpse Knight")?.deckChips.some((c) => c.dim === "amplifier")).toBe(false);
  });
  test("many amplifiers are summarised", () => {
    const hits = findRedundancy({ ...base, candidates, amplifiers: ["X", "Y", "Z"] });
    expect(find(hits, "Corpse Knight")?.deckChips).toContainEqual({ dim: "amplifier", label: "loses X and 2 others synergy" });
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
  test("perTier cap ignores in-deck hits; duplicates merge", () => {
    const cs = [cand("Essence Warden"), cand("Soul's Attendant"), cand("Auriok Champion", true), cand("Essence Warden", true)];
    const hits = findRedundancy({ ...b, candidates: cs }, { perTier: { same: 1, close: 0 } });
    expect(hits.filter((h) => h.tier === "same").length).toBe(2);
    expect(hits.filter((h) => h.tier === "close").map((h) => h.name)).toEqual(["Auriok Champion"]);
    expect(hits.filter((h) => h.name === "Essence Warden").length).toBe(1);
  });
});
