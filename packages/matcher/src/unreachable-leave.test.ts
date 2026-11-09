import { describe, expect, test } from "vitest";
import { deriveCardTags, deriveInputOf } from "@edh-seer/tagger";
import type { CardTags, ClauseRecord } from "@edh-seer/tagger";
import { loadHierarchy, pairReasons } from "./index.js";
import type { DeckCard } from "./types.js";
import fixtures from "./unreachable-leave.fixtures.json" with { type: "json" };

/** #1513 part 2: LEAVE TRIGGERS THAT CANNOT FIRE AS READ. Oracle text and clause records are the corpus's own (cards.oracleText, cardClauses.canonical or the grammar's reading
 *  where the stored row is grammar-sourced), dumped from Mongo 2026-11-09 (DERIVE 479).
 *
 *  Primeval Spawn: "If this creature would enter and it wasn't cast or no mana was spent to cast it, exile it instead. ... When this creature leaves the battlefield, exile the top ten cards of your library. ..."
 *  Thief of Existence: "When you cast this spell, exile up to one target noncreature, nonland permanent an opponent controls with mana value 4 or less. If you do, Thief of Existence gains "When this creature leaves the battlefield, target opponent draws a card.""
 *  Parallax Dementia: "When this Aura leaves the battlefield, destroy enchanted creature. That creature can't be regenerated."
 *  Reality Acid: "When this Aura leaves the battlefield, enchanted permanent's controller sacrifices it."
 *  Dawn of the Dead: "At the beginning of your upkeep, you may return target creature card from your graveyard to the battlefield. That creature gains haste until end of turn. Exile it at the beginning of the next end step." */
type Fx = { source: Record<string, unknown>; canonical: ClauseRecord[] };
const F = fixtures as unknown as Record<string, Fx>;
const dc = (name: string): DeckCard => ({
  card: F[name]!.source as unknown as DeckCard["card"],
  tags: deriveCardTags(deriveInputOf(F[name]!.source as never, name, name, F[name]!.canonical)) as CardTags,
});
const H = loadHierarchy();
const D: Record<string, DeckCard> = {};
const card = (name: string): DeckCard => (D[name] ??= dc(name));
const leaveTags = (producer: string, consumer: string) =>
  pairReasons(card(producer), card(consumer), H).filter((r) => r.consumer === consumer && /^(leaves|dies|exiled)\b/.test(r.tag)).map((r) => r.tag);

/** A creature the producer put onto the battlefield and then removes ("Exile it at the beginning of the next end step", "Sacrifice that creature ...", "Return that creature to its owner's hand ..."). */
const PUT_THEN_REMOVE = ["Dawn of the Dead", "Whip of Erebos", "Footsteps of the Goryo", "Zara, Renegade Recruiter"];
/** Removal or a flicker that applies to a creature already on the battlefield: it can be a cast one. */
const REMOVES_A_BATTLEFIELD_CREATURE = ["Wrath of God", "Ephemerate"];

describe("a creature that can only be on the battlefield if it was cast: what a producer puts and removes is never it", () => {
  test.each(PUT_THEN_REMOVE)("%s -> Primeval Spawn (a put Spawn is exiled instead of entering): no leave reason", (producer) => {
    expect(leaveTags(producer, "Primeval Spawn")).toEqual([]);
  });
  test.each(PUT_THEN_REMOVE)("%s -> Thief of Existence (its leave trigger is granted only when cast): no leave reason", (producer) => {
    expect(leaveTags(producer, "Thief of Existence")).toEqual([]);
  });
  test.each(REMOVES_A_BATTLEFIELD_CREATURE)("%s -> Primeval Spawn: a cast Spawn is removed like any creature, still pairs", (producer) => {
    expect(leaveTags(producer, "Primeval Spawn").length).toBeGreaterThan(0);
  });
  test.each(REMOVES_A_BATTLEFIELD_CREATURE)("%s -> Thief of Existence still pairs", (producer) => {
    expect(leaveTags(producer, "Thief of Existence").length).toBeGreaterThan(0);
  });
  test.each(["Dawn of the Dead", "Whip of Erebos", "Footsteps of the Goryo", "Zara, Renegade Recruiter"])("%s -> Admonition Angel (an ordinary leave trigger) still pairs: a reanimated creature can leave", (producer) => {
    expect(leaveTags(producer, "Admonition Angel").length).toBeGreaterThan(0);
  });
  test("Dawn of the Dead -> Hypnox and Champion of the Clachan are left as read (judgement calls, reported)", () => {
    expect(leaveTags("Dawn of the Dead", "Hypnox").length).toBeGreaterThan(0);
    expect(leaveTags("Dawn of the Dead", "Champion of the Clachan").length).toBeGreaterThan(0);
  });
});

describe("an Aura whose leave trigger acts on its host is not triggered by the host's own departure", () => {
  test.each(["Parallax Dementia", "Reality Acid"])("Murder (the host dies, the Aura goes with it) -> %s: no host-leaves reason", (aura) => {
    expect(leaveTags("Murder", aura)).toEqual([]);
  });
  test.each(["Parallax Dementia", "Reality Acid"])("Dawn of the Dead's exile of the creature -> %s: none", (aura) => {
    expect(leaveTags("Dawn of the Dead", aura)).toEqual([]);
  });
  test.each(["Parallax Dementia", "Reality Acid"])("Beast Within (\"Destroy target permanent\": it can name the Aura itself) -> %s still pairs", (aura) => {
    expect(leaveTags("Beast Within", aura).length).toBeGreaterThan(0);
  });
  test("Revoke Existence (\"Exile target artifact or enchantment\": Reality Acid can enchant an artifact, and is itself an enchantment) -> Reality Acid still pairs", () => {
    expect(leaveTags("Revoke Existence", "Reality Acid").length).toBeGreaterThan(0);
  });
  test.each(["Parallax Dementia", "Reality Acid"])("Wrath of God (creatures only: the Aura goes only because its host did) -> %s: none", (aura) => {
    expect(leaveTags("Wrath of God", aura)).toEqual([]);
  });
  test("Remove Enchantments (\"destroy all other Auras attached to permanents you control\": the Aura itself goes, host still there) -> Parallax Dementia still pairs", () => {
    expect(leaveTags("Remove Enchantments", "Parallax Dementia").length).toBeGreaterThan(0);
  });
  test("Wrath of God -> Rancor (its trigger returns itself, no host to act on) still pairs", () => {
    expect(leaveTags("Wrath of God", "Rancor").length).toBeGreaterThan(0);
  });
});
