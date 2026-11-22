import { describe, expect, test } from "vitest";
import { deriveCardTags, deriveInputOf } from "@edh-seer/tagger";
import type { CardTags, ClauseRecord } from "@edh-seer/tagger";
import { analyzeDeckStructured, loadHierarchy, pairReasons } from "./index.js";
import { synthesizeTokenTags } from "./token-tags.js";
import type { DeckCard } from "./types.js";
import fixtures from "./fixtures/enters-owner-1737.json" with { type: "json" };

/** #1737: "Whenever a nonland permanent an opponent OWNS enters the battlefield under your control" (Brainstealer Dragon; `owner: opp`) is heard only by a put that can bring in a card an opponent owns. CR 400.3: your
 *  library, hand and graveyard hold only cards you own, so a put out of them is a card you own (`owner: you` on the emit, stamped by derive); a steal out of an opponent's zone (`owner: opp`) or out of ANY graveyard
 *  (Animate Dead, Reanimate: the card could be theirs) still is heard. Production fixtures: the card documents and the stored `cardClauses.canonical`, dumped from Mongo 2026-11-22 (DERIVE 573). */
const F = fixtures as unknown as Record<string, { source: Record<string, unknown>; canonical: ClauseRecord[] }>;
const dc = (name: string): DeckCard => ({
  card: F[name]!.source as unknown as DeckCard["card"],
  tags: deriveCardTags(deriveInputOf(F[name]!.source as never, name, name, F[name]!.canonical)) as CardTags,
});
const H = loadHierarchy();
const dragon = dc("Brainstealer Dragon");
const heardBy = (producer: string) => pairReasons(dc(producer), dragon, H).map((r) => r.tag).filter((t) => t.startsWith("enters:"));
const putEmits = (name: string) => (dc(name).tags?.abilities ?? []).flatMap((a) => a.emits ?? []).filter((e) => e.verb === "enters" && e.subject.self !== true).map((e) => e.subject);

describe("a put of a card you own is no 'permanent an opponent owns'", () => {
  // Sneak Attack is an enchantment: its OWN implied entry is a nonland permanent entering (a separate, unread family), so it is pinned by its put's owner only.
  test.each(["Primal Surge", "Stitch Together", "Revivify", "Green Sun's Zenith", "Natural Order"])("%s puts only cards out of your own zone: not heard by Brainstealer Dragon", (producer) => {
    expect(heardBy(producer)).toEqual([]);
  });
  test.each(["Primal Surge", "Stitch Together", "Revivify", "Sneak Attack", "Green Sun's Zenith", "Natural Order"])("%s's put states the card is yours (owner you)", (producer) => {
    const puts = putEmits(producer);
    expect(puts.length).toBeGreaterThan(0);
    for (const s of puts) expect(s.owner).toBe("you");
  });
});
describe("a put that can take a card an opponent owns is still heard", () => {
  test("Gruesome Encore puts a creature out of an opponent's graveyard under your control", () => {
    expect(heardBy("Gruesome Encore")).not.toEqual([]);
  });
  test("Bribery puts a creature out of a target opponent's library under your control", () => {
    expect(heardBy("Bribery")).not.toEqual([]);
  });
  test("Journey to Eternity returns 'it', the enchanted creature that died: it can be a stolen creature, so no owner is written and Brainstealer Dragon still hears it", () => {
    const j = "Journey to Eternity // Atzal, Cave of Eternity";
    expect(putEmits(j).find((s) => s.ref === "trigger")?.owner).toBeUndefined();
    expect(heardBy(j)).not.toEqual([]);
  });
  test.each(["Animate Dead", "Reanimate"])("%s reanimates out of ANY graveyard (the card could be an opponent's): no owner is written, still heard", (producer) => {
    for (const s of putEmits(producer)) expect(s.owner).not.toBe("you");
    expect(heardBy(producer)).not.toEqual([]);
  });
});

/** #1746: the same demand is never met by a permanent you own by the rules, though the producer's words state no owner. CR 108.3: a card of your deck is yours, so a card you cast enters owned by you; CR 111.2: the player who
 *  creates a token owns it. A token is its own node whose implied entry is the route (`collectTokenNodes`), so the token cases run the whole deck. Fixtures added 2026-11-22 (DERIVE 575). */
const vanilla = (name: string, typeLine: string, p: string, colors: string[]): CardTags =>
  synthesizeTokenTags({ _id: `test-${name}`, name, typeLine, power: p, toughness: p, colors, keywords: [], printingIds: [] });
const TOKENS: Record<string, CardTags> = {
  Soldier: vanilla("Soldier", "Token Creature — Soldier", "1", ["W"]),
};
const tokenTags = (ref: { name: string }): CardTags | null => TOKENS[ref.name] ?? null;
const dragonHears = (maker: string): boolean =>
  analyzeDeckStructured([dc(maker), dragon], undefined, H, undefined, undefined, undefined, tokenTags as never)
    .cards.find((c) => c.name === maker)!.topPartners.some((p) => p.name === "Brainstealer Dragon");
describe("an implied enter and a token you create are yours (#1746)", () => {
  test("Wall of Omens: its own entry is a card of your deck, not heard", () => {
    expect(heardBy("Wall of Omens")).toEqual([]);
  });
  test("Raise the Alarm (an instant, its only route is the Soldier tokens): a token you create is yours, not heard", () => {
    expect(heardBy("Raise the Alarm")).toEqual([]);
    expect(dragonHears("Raise the Alarm")).toBe(false);
  });
  test.each(["Gruesome Encore", "Bribery", "Animate Dead"])("%s is still heard", (producer) => {
    expect(heardBy(producer)).not.toEqual([]);
  });
});

/** #1750: the real Dragon partners #1746 took away. A put out of an opponent's graveyard stored `control: opp` with no owner (Puppeteer Clique, Rakshasa Debaser, Bone Dancer, Tariel, Visions of Dread), and a cast of a card an
 *  opponent owns emitted no enter at all (Gonti, Thief of Sanity, Hostage Taker). Both are "a nonland permanent an opponent owns enters under your control". A steal (Control Magic) is no enter. Fixtures added 2026-11-22 (DERIVE 575). */
describe("an opponent-owned card entering under your control is heard (#1750)", () => {
  test.each(["Puppeteer Clique", "Rakshasa Debaser", "Bone Dancer", "Tariel, Reckoner of Souls", "Visions of Dread"])("%s: the put out of an opponent's graveyard states control you, owner opp", (producer) => {
    const puts = putEmits(producer).filter((s) => s.fromZone === "graveyard");
    expect(puts.length).toBeGreaterThan(0);
    for (const s of puts) expect([s.control, s.owner]).toEqual(["you", "opp"]);
  });
  test.each(["Puppeteer Clique", "Rakshasa Debaser", "Bone Dancer", "Tariel, Reckoner of Souls", "Visions of Dread", "Gonti, Lord of Luxury", "Thief of Sanity", "Gruesome Encore", "Bribery"])("%s is heard by Brainstealer Dragon", (producer) => {
    expect(heardBy(producer)).not.toEqual([]);
  });
  test("Prince of Thralls puts back a creature an opponent CONTROLS died: it can be a stolen card of yours, so no owner is written", () => {
    for (const s of putEmits("Prince of Thralls")) expect(s.owner).toBeUndefined();
  });
  test("Control Magic gains control, it is no enter: not heard", () => {
    expect(heardBy("Control Magic")).toEqual([]);
  });
  test("Primal Surge (your own cards) is still not heard", () => {
    expect(heardBy("Primal Surge")).toEqual([]);
  });
});

/** #1750 review: the cast bridge reads a cast as an enter only when the card cast can be a permanent. Memory Plunder, Taster of Wares and Tasha's -3 cast instants and sorceries only; Supper for Spiders' cards enter as Food ARTIFACTS, not creatures (CR 611.2e). */
describe("a cast that can only be an instant or sorcery is no enter (#1750 review)", () => {
  test.each(["Memory Plunder", "Taster of Wares", "Tasha, the Witch Queen"])("%s: not heard by Brainstealer Dragon", (producer) => {
    expect(heardBy(producer)).toEqual([]);
  });
  test("Taster of Wares' and Tasha's casts are typed instant or sorcery", () => {
    for (const n of ["Taster of Wares", "Tasha, the Witch Queen"]) {
      const casts = (dc(n).tags?.abilities ?? []).flatMap((a) => a.emits ?? []).filter((e) => e.verb === "cast" && e.subject.owner === "opp").map((e) => e.subject.type);
      expect(casts.length).toBeGreaterThan(0);
      for (const t of casts) expect(t).toEqual(["instant", "sorcery"]);
    }
  });
  test("Supper for Spiders: the put cards enter as Food artifacts, still the opponent's, still heard; a creature-enters consumer does not hear them", () => {
    const puts = putEmits("Supper for Spiders");
    expect(puts.map((s) => [s.type, s.subtype, s.control, s.owner])).toEqual([["artifact", "food", "you", "opp"]]);
    expect(heardBy("Supper for Spiders")).not.toEqual([]);
  });
});
