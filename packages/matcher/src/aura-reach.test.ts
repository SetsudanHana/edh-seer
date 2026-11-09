import { describe, expect, test } from "vitest";
import type { GameEvent, SubjectFilter } from "@edh-seer/tagger";
import { removalReachesAura, targetsOnlyOpponents } from "./aura-reach.js";
import { loadHierarchy } from "./hierarchy.js";

/** #1577 part 2: THE HOST ROUTE READS ONLY EVENTS THAT NAME A CLASS (the direct route's gate, #1575). "Destroy target creature. Return it ..." beside an untyped "it" must not make the card able to take an Aura. */
const H = loadHierarchy();
const aura: SubjectFilter = { control: "you", token: false, type: ["enchantment"], subtype: ["aura"] } as SubjectFilter;
const ev = (verb: string, subject: Partial<SubjectFilter>): GameEvent => ({ verb, subject: { control: "any", token: null, ...subject } }) as GameEvent;

describe("removalReachesAura: an untyped event is no proof the card can take an Aura", () => {
  test("a creature kill beside a bare 'return it' (untyped leaves) does not reach", () => {
    expect(removalReachesAura([ev("dies", { type: "creature", scope: "target" }), ev("leaves", { fromZone: "battlefield" })], "Destroy target creature. Return it to its owner's hand.", aura, H)).toBe(false);
  });
  test("a bare pronoun death and a self-less untyped sacrifice do not reach", () => {
    expect(removalReachesAura([ev("dies", {}), ev("sacrifice", { control: "you" })], "Sacrifice it.", aura, H)).toBe(false);
  });
  test("CONTROL: a typed enchantment or permanent removal still reaches", () => {
    expect(removalReachesAura([ev("dies", { type: "enchantment", scope: "all" })], "Destroy all enchantments.", aura, H)).toBe(true);
    expect(removalReachesAura([ev("leaves", { type: "permanent", scope: "target" })], "Return target permanent to its owner's hand.", aura, H)).toBe(true);
  });
  test("CONTROL: a subtype-only or anyOf-typed removal still reaches", () => {
    expect(removalReachesAura([ev("dies", { subtype: "aura", scope: "all" })], "Destroy all Auras.", aura, H)).toBe(true);
    expect(removalReachesAura([ev("exiled", { anyOf: [{ type: "enchantment" }, { type: "creature" }] as never, scope: "target" })], "Exile target enchantment or creature.", aura, H)).toBe(true);
  });
});

/** #1577 part 3: "THAT PLAYER CONTROLS" / "DEFENDING PLAYER CONTROLS" NAME AN OPPONENT ONLY WHERE THE SENTENCE SAYS WHO THE PLAYER IS. Oracle text quoted from the corpus (cards.oracleText, 2026-11-09). */
describe("targetsOnlyOpponents: the player the sentence points back to", () => {
  test.each([
    ["Aberrant (ability word before the dash)", "Ravenous (This creature enters with X +1/+1 counters on it. If X is 5 or more, draw a card when it enters.)\nTrample\nHeavy Power Hammer — Whenever this creature deals combat damage to a player, destroy target artifact or enchantment that player controls."],
    ["Dawning Purist", "Whenever this creature deals combat damage to a player, you may destroy target enchantment that player controls."],
    ["Feline Sovereign", "Whenever one or more Cats you control deal combat damage to a player, destroy up to one target artifact or enchantment that player controls."],
    ["Hammer of Ruin", "Whenever equipped creature deals combat damage to a player, you may destroy target Equipment that player controls."],
    ["Kogla, the Titan Ape", "Whenever Kogla attacks, destroy target artifact or enchantment defending player controls."],
    ["Outland Liberator", "Whenever this creature attacks, destroy target artifact or enchantment defending player controls."],
    ["Dismantling Wave", "For each opponent, destroy up to one target artifact or enchantment that player controls."],
  ])("%s: only an opponent's permanents", (_name, text) => {
    expect(targetsOnlyOpponents(text)).toBe(true);
  });
  test.each([
    ["Battle at the Helvault", "For each player, exile up to one target non-Saga, nonland permanent that player controls until this Saga leaves the battlefield."],
    ["The Abyss", "At the beginning of each player's upkeep, destroy target nonartifact creature that player controls of their choice."],
    ["Sigil of Sleep", "Whenever enchanted creature deals damage to a player, return target creature that player controls to its owner's hand."],
    ["Kappa Tech-Wrecker", "When you do, exile target artifact or enchantment that player controls."],
    ["Fatal Lore (an opponent chooses, in an earlier sentence: the sentence itself does not say)", "You destroy up to two target creatures that player controls."],
  ])("%s: the player can be you, or the sentence does not say", (_name, text) => {
    expect(targetsOnlyOpponents(text)).toBe(false);
  });
});
