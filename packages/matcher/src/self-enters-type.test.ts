import { describe, expect, test } from "vitest";
import { deriveAsCorpus } from "@edh-seer/tagger/derive-worker";
import { loadHierarchy, pairReasonsAcrossFaces } from "./index.js";
import type { DeckCard } from "./types.js";
import fixtures from "./fixtures/self-enters-type.json" with { type: "json" };

/** #1698: A NAMED-SELF ENTERS TRIGGER IS FED BY WHAT CAN PUT THAT CARD'S TYPE ONTO THE BATTLEFIELD. "When U.S.S. Voyager enters" was a typeless self demand, met by every typeless `enters` emit: Kodama's Reach (lands), Nissa's Pilgrimage
 *  (Forests), Living Death and Living End (creature cards) fed Voyager, Skyship Weatherlight and Loki's Scepter, which are artifacts. The card's own type now stands on the trigger, as "this creature" always carried `creature`. Cards dumped from
 *  Mongo 2026-11-21 (DERIVE 561) with their stored clauses, derived as derive-corpus derives them. */
type Fx = { source: Record<string, unknown>; canonical?: unknown[]; segmentHash?: string };
const F = fixtures as unknown as Record<string, Fx>;
const H = loadHierarchy();
const dc = (name: string): DeckCard => {
  const f = F[name]!;
  const tags = deriveAsCorpus({ doc: { oracleId: name, name, canonical: f.canonical ?? [], segmentHash: f.segmentHash } as never, source: f.source, isToken: false }).tags;
  return { card: { _id: name, ...f.source } as unknown as DeckCard["card"], tags };
};
/** The `enters:` reasons by which `maker` feeds `payoff`'s own entry (a recursion-target or graveyard-recursion reason is another question). */
const feeds = (maker: string, payoff: string): string[] =>
  pairReasonsAcrossFaces(dc(maker), dc(payoff), H).filter((r) => r.producer === dc(maker).card.name && r.consumer === dc(payoff).card.name).map((r) => r.tag).filter((t) => t.startsWith("enters:"));

const ARTIFACTS = ["U.S.S. Voyager, Lone Wanderer", "Skyship Weatherlight", "Loki's Scepter"];
describe("a card that cannot put an artifact onto the battlefield does not fire an artifact's own entry", () => {
  test.each(ARTIFACTS.flatMap((p) => ["Kodama's Reach", "Nissa's Pilgrimage", "Living Death", "Living End"].map((m) => [m, p] as const)))("%s -> %s: no pair", (m, p) => {
    expect(feeds(m, p)).toEqual([]);
  });
  test.each(["Kodama's Reach", "Nissa's Pilgrimage"])("%s feeds no named creature's own entry either (Emry)", (m) => {
    expect(feeds(m, "Emry, Lurker of the Loch")).toEqual([]);
  });
});
describe("the class a Living Death-style put names is the class it can feed (Living Death, Living End: creature cards; Scrap Mastery: artifact cards)", () => {
  test.each(["Living Death", "Living End"])("%s -> Emry, a named creature: pairs", (m) => expect(feeds(m, "Emry, Lurker of the Loch").length).toBeGreaterThan(0));
  test.each(["Living Death", "Living End"])("%s -> Mulldrifter ('this creature'): pairs", (m) => expect(feeds(m, "Mulldrifter").length).toBeGreaterThan(0));
  test.each(["Living Death", "Living End"])("%s -> Breya (an artifact creature): pairs", (m) => expect(feeds(m, "Breya, Etherium Shaper").length).toBeGreaterThan(0));
  test.each(ARTIFACTS)("Scrap Mastery -> %s: pairs", (p) => expect(feeds("Scrap Mastery", p).length).toBeGreaterThan(0));
  test("Scrap Mastery -> Emry: no pair (it returns artifact cards)", () => expect(feeds("Scrap Mastery", "Emry, Lurker of the Loch")).toEqual([]));
});
describe("CONTROL: what really puts the card onto the battlefield still does", () => {
  test.each(ARTIFACTS)("Ghostly Flicker (artifacts, creatures and lands) -> %s", (p) => expect(feeds("Ghostly Flicker", p).length).toBeGreaterThan(0));
  test.each(ARTIFACTS)("Goblin Welder (an artifact card from a graveyard) -> %s", (p) => expect(feeds("Goblin Welder", p).length).toBeGreaterThan(0));
  test("Sevinne's Reclamation (a permanent card) -> Loki's Scepter", () => expect(feeds("Sevinne's Reclamation", "Loki's Scepter").length).toBeGreaterThan(0));
  test.each(["Cloudshift", "Ghostly Flicker", "Rise of the Dark Realms"])("%s (creatures) -> Emry, a named creature", (m) => expect(feeds(m, "Emry, Lurker of the Loch").length).toBeGreaterThan(0));
  test("a flicker of creatures still fires an artifact creature's own entry (Breya)", () => expect(feeds("Cloudshift", "Breya, Etherium Shaper").length).toBeGreaterThan(0));
  test("Ghostly Flicker -> Breya", () => expect(feeds("Ghostly Flicker", "Breya, Etherium Shaper").length).toBeGreaterThan(0));
  test("a creature's 'this creature' entry is unchanged: Cloudshift -> Mulldrifter", () => expect(feeds("Cloudshift", "Mulldrifter").length).toBeGreaterThan(0));
});
