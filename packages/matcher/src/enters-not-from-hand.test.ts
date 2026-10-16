import { expect, test } from "vitest";
import { deriveCardTags } from "@edh-seer/tagger";
import type { Characteristics, ClauseRecord, CardTags } from "@edh-seer/tagger";
import { loadHierarchy, pairReasons } from "./index.js";
import type { DeckCard } from "./types.js";

/** #1250 task 5: Chainer, Nightmare Adept's "if you didn't cast it from your hand" was dropped silently, so
 *  every creature that enters (Braids, cast from hand) fed it. The condition is the entry's HOW (`notCast`):
 *  a card's own implied entry is a cast, a blink or reanimation is not. Clauses are the corpus's own. */
const chars = (types: string[]): Characteristics => ({
  types, subtypes: [], colors: [], identity: [], cmc: 0, power: null, toughness: null, token: false, keywords: [],
});
function card(name: string, types: string[], clauses: ClauseRecord[], clauseTexts: Record<number, string>): DeckCard {
  const tags = deriveCardTags({ oracleId: name, name, clauses, clauseTexts, characteristics: chars(types) }) as CardTags;
  return {
    card: { name, typeLine: types.join(" "), oracleText: Object.values(clauseTexts).join("\n"), keywords: [], colors: [], manaValue: 0 } as unknown as DeckCard["card"],
    tags,
  };
}
const H = loadHierarchy();

const chainer = card("Chainer, Nightmare Adept", ["creature"], [{
  id: 2, abilityType: "triggered",
  trigger: { event: "enters", subject: "a nontoken creature you control", control: "you" },
  actions: [{ verb: "grant-ability", object: "haste until your next turn" }],
}], { 2: "Whenever a nontoken creature you control enters, if you didn't cast it from your hand, it gains haste until your next turn." });

const braids = card("Braids, Arisen Nightmare", ["creature"], [{
  id: 1, abilityType: "triggered",
  trigger: { event: "end-step", subject: "you", control: "you" },
  actions: [{ verb: "sacrifice", object: "an artifact, creature, enchantment, land, or planeswalker", optional: true }],
}], { 1: "At the beginning of your end step, you may sacrifice an artifact, creature, enchantment, land, or planeswalker." });

const ephemerate = card("Ephemerate", ["instant"], [{
  id: 1, abilityType: "spell",
  actions: [
    { verb: "exile", object: "target creature you control", fromZone: "battlefield", toZone: "exile" },
    { verb: "return", object: "it", fromZone: "exile", toZone: "battlefield" },
  ],
}], { 1: "Exile target creature you control, then return it to the battlefield under its owner's control." });

const entersTag = (a: DeckCard, b: DeckCard) => pairReasons(a, b, H).filter((r) => r.tag === "enters:creature");

test("Chainer's trigger keeps 'you didn't cast it from your hand' as notCast, not dropped", () => {
  const t = chainer.tags?.abilities?.find((a) => a.trigger?.verbs.includes("enters"))?.trigger;
  expect(t?.subject.notCast).toBe(true);
});

test("a creature cast from hand (Braids) does not feed Chainer's enters trigger", () => {
  expect(entersTag(braids, chainer)).toEqual([]);
});

test("a blink (Ephemerate) still feeds Chainer's enters trigger", () => {
  expect(entersTag(ephemerate, chainer).length).toBeGreaterThan(0);
});
