import { expect, test } from "vitest";
import { deriveCardTags } from "@edh-seer/tagger";
import type { Characteristics, ClauseRecord, CardTags } from "@edh-seer/tagger";
import { loadHierarchy, pairReasons } from "./index.js";
import { abilityIsKind, losesYouTheGame } from "./edges.js";
import { claimingAbilitiesOf, emitKeysOf, supplyKeysOf } from "./partners-core.js";
import type { DeckCard } from "./types.js";

/** #1252, owner ruling 2026-10-16: "A self 'you lose the game' trigger is never a payoff." Phage the
 *  Untouchable's enters trigger and the Pacts' upkeep trigger form no `enters`, `cheat`, `doubles` or
 *  `copies` edge. Clauses and texts are the corpus's own (`cardClauses`, `cards.oracleText`). */
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

const phage = card("Phage the Untouchable", ["creature"], [
  { id: 1, abilityType: "triggered", trigger: { event: "enters", subject: "this", control: "you" }, actions: [{ verb: "lose-game", object: "you" }] },
  { id: 2, abilityType: "triggered", trigger: { event: "damage-dealt", subject: "this", control: "you" }, actions: [{ verb: "destroy", object: "that creature" }, { verb: "cant", object: "be regenerated" }] },
  { id: 3, abilityType: "triggered", trigger: { event: "damage-dealt", subject: "this", control: "you" }, actions: [{ verb: "lose-game", object: "that player" }] },
] as ClauseRecord[], {
  1: "When Phage enters, if you didn't cast it from your hand, you lose the game.",
  2: "Whenever Phage deals combat damage to a creature, destroy that creature. It can't be regenerated.",
  3: "Whenever Phage deals combat damage to a player, that player loses the game.",
});
const pact = card("Pact of Negation", ["instant"], [
  { id: 1, abilityType: "spell", actions: [{ verb: "counter-spell", object: "target spell" }] },
  { id: 2, abilityType: "triggered", trigger: { event: "upkeep", subject: "you", control: "you" }, actions: [{ verb: "lose-game", object: "you" }] },
] as ClauseRecord[], { 1: "Counter target spell.", 2: "At the beginning of your next upkeep, pay {3}{U}{U}. If you don't, you lose the game." });
const solemn = card("Solemn Simulacrum", ["artifact", "creature"], [
  { id: 1, abilityType: "triggered", trigger: { event: "enters", subject: "this creature", control: "you" }, actions: [
    { verb: "search", object: "your library for a basic land card", fromZone: "library", optional: true },
    { verb: "put", object: "that card", fromZone: "library", toZone: "battlefield" },
    { verb: "tap", object: "that card" }, { verb: "shuffle", object: "your library" }] },
  { id: 2, abilityType: "triggered", trigger: { event: "dies", subject: "this creature", control: "you" }, actions: [{ verb: "draw", object: "a card", amount: "1", optional: true }] },
] as ClauseRecord[], {
  1: "When this creature enters, you may search your library for a basic land card, put that card onto the battlefield tapped, then shuffle.",
  2: "When this creature dies, you may draw a card.",
});
const animateDead = card("Animate Dead", ["enchantment"], [
  { id: 2, abilityType: "triggered", trigger: { event: "enters", subject: "this Aura", control: "you" }, actions: [
    { verb: "return", object: "enchanted creature card", fromZone: "graveyard", toZone: "battlefield" }, { verb: "attach", object: "this Aura" }] },
  { id: 3, abilityType: "triggered", trigger: { event: "leaves", subject: "this Aura", control: "you" }, actions: [{ verb: "sacrifice", object: "that creature" }] },
] as ClauseRecord[], {
  2: "When this Aura enters, if it's on the battlefield, it loses \"enchant creature card in a graveyard\" and gains \"enchant creature put onto the battlefield with this Aura.\" Return enchanted creature card to the battlefield under your control and attach this Aura to it.",
  3: "When this Aura leaves the battlefield, that creature's controller sacrifices it.",
});
const ephemerate = card("Ephemerate", ["instant"], [{
  id: 1, abilityType: "spell",
  actions: [
    { verb: "exile", object: "target creature you control", fromZone: "battlefield", toZone: "exile" },
    { verb: "return", object: "it", fromZone: "exile", toZone: "battlefield" },
  ],
}] as ClauseRecord[], { 1: "Exile target creature you control, then return it to the battlefield under its owner's control." });
const sneakAttack = card("Sneak Attack", ["enchantment"], [{
  id: 1, abilityType: "activated",
  actions: [
    { verb: "put", object: "a creature card", fromZone: "hand", toZone: "battlefield", optional: true },
    { verb: "grant-ability", object: "haste" },
    { verb: "sacrifice", object: "the creature" },
  ],
}] as ClauseRecord[], { 1: "{R}: You may put a creature card from your hand onto the battlefield. That creature gains haste. Sacrifice the creature at the beginning of the next end step." });
const panharmonicon = card("Panharmonicon", ["artifact"], [{
  id: 1, abilityType: "static", actions: [{ verb: "trigger-again", object: "a triggered ability of a permanent you control" }],
}] as ClauseRecord[], { 1: "If an artifact or creature entering causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time." });
const resonator = card("Strionic Resonator", ["artifact"], [{
  id: 1, abilityType: "activated", actions: [{ verb: "copy", object: "target triggered ability you control" }, { verb: "other", object: "you may choose new targets for the copy", optional: true }],
}] as ClauseRecord[], { 1: "{2}, {T}: Copy target triggered ability you control. You may choose new targets for the copy." });

const tags = (a: DeckCard, b: DeckCard, prefix: string) => pairReasons(a, b, H).filter((r) => r.tag.startsWith(prefix));

test("Phage's enters trigger derives as a self lose-the-game trigger (fixture sanity)", () => {
  const t = phage.tags?.abilities.find((a) => a.trigger?.verbs.includes("enters"));
  expect(t?.emits?.map((e) => e.verb)).toEqual(["loses-game"]);
});

test("Animate Dead does not feed Phage's lose-the-game enters trigger", () => {
  expect(tags(animateDead, phage, "enters:")).toEqual([]);
});
test("Ephemerate does not feed Phage's lose-the-game enters trigger", () => {
  expect(tags(ephemerate, phage, "enters:")).toEqual([]);
});
test("Ephemerate still feeds an ordinary ETB creature", () => {
  expect(tags(ephemerate, solemn, "enters:").length).toBeGreaterThan(0);
});
test("Sneak Attack does not cheat Phage out, and does not feed its enters trigger", () => {
  expect(tags(sneakAttack, phage, "cheat:")).toEqual([]);
  expect(tags(sneakAttack, phage, "enters:")).toEqual([]);
});
test("Sneak Attack still cheats an ordinary creature", () => {
  expect(tags(sneakAttack, solemn, "cheat:creature").length).toBeGreaterThan(0);
});
test("Panharmonicon does not double Phage's lose-the-game trigger", () => {
  expect(tags(panharmonicon, phage, "doubles:")).toEqual([]);
});
test("Panharmonicon still doubles an ordinary ETB creature", () => {
  expect(tags(panharmonicon, solemn, "doubles:enters").length).toBeGreaterThan(0);
});
test("Strionic Resonator does not copy the Pact's lose-the-game trigger", () => {
  expect(tags(pact, resonator, "copies:")).toEqual([]);
  expect(tags(resonator, pact, "copies:")).toEqual([]);
});
test("Strionic Resonator still copies an ordinary triggered card", () => {
  expect(tags(solemn, resonator, "copies:triggered").length + tags(resonator, solemn, "copies:triggered").length).toBeGreaterThan(0);
});

// ---- #1252, owner ruling 2026-10-17: all ability kinds; a rescue keeps its link; a payoff never hears it ----
const stunning = card("Stunning Reversal", ["instant"], [
  { id: 1, abilityType: "spell", trigger: { event: "loses-game", subject: "you", control: "you" }, actions: [{ verb: "draw", object: "card", amount: "7" }, { verb: "set-life", object: "your life total", amount: "1" }] },
  { id: 2, abilityType: "spell", actions: [{ verb: "exile", object: "Stunning Reversal" }] },
] as ClauseRecord[], {
  1: "The next time you would lose the game this turn, instead draw seven cards and your life total becomes 1.",
  2: "Exile Stunning Reversal.",
});
const bloodTyrant = card("Blood Tyrant", ["creature"], [
  { id: 3, abilityType: "triggered", trigger: { event: "loses-game", subject: "a player", control: "any" }, actions: [{ verb: "add-counter", object: "+1/+1", amount: "5" }] },
] as ClauseRecord[], { 3: "Whenever a player loses the game, put five +1/+1 counters on this creature." });
const nefariousLich = card("Nefarious Lich", ["enchantment"], [
  { id: 1, abilityType: "static", actions: [{ verb: "exile", object: "cards from your graveyard", fromZone: "graveyard", toZone: "exile", amount: "that many" }, { verb: "lose-game", object: "you" }] },
  { id: 3, abilityType: "triggered", trigger: { event: "leaves", subject: "this enchantment", control: "you" }, actions: [{ verb: "lose-game", object: "you" }] },
] as ClauseRecord[], {
  1: "If damage would be dealt to you, exile that many cards from your graveyard instead. If you can't, you lose the game.",
  3: "When this enchantment leaves the battlefield, you lose the game.",
});
const finalFortune = card("Final Fortune", ["instant"], [
  { id: 1, abilityType: "spell", actions: [{ verb: "extra-turn", object: "a turn after this one" }] },
  { id: 2, abilityType: "triggered", trigger: { event: "end-step", subject: "that turn", control: "you" }, actions: [{ verb: "lose-game", object: "you" }] },
] as ClauseRecord[], { 1: "Take an extra turn after this one.", 2: "At the beginning of that turn's end step, you lose the game." });

const selfLoss = (d: DeckCard) => d.tags?.abilities.filter(losesYouTheGame) ?? [];

test("a rescue (Stunning Reversal) still hears a self lose-the-game, from a Pact, a Final Fortune or a Lich", () => {
  for (const src of [pact, finalFortune, nefariousLich]) {
    expect(selfLoss(src).length, src.card.name).toBeGreaterThan(0);
    expect(tags(src, stunning, "loses-game:").length, src.card.name).toBeGreaterThan(0);
  }
});
test("a payoff that profits from a loss (Blood Tyrant) never hears a self lose-the-game", () => {
  for (const src of [pact, finalFortune, nefariousLich, phage]) {
    expect(tags(src, bloodTyrant, "loses-game:").length === 0 || src === phage, src.card.name).toBe(true);
  }
  expect(tags(phage, bloodTyrant, "loses-game:").length).toBeGreaterThan(0); // Phage's combat-damage loss is the opponent's
});
test("a self lose-the-game of any kind (static, trigger) is recognised", () => {
  expect(selfLoss(nefariousLich).map((a) => a.kind).sort()).toEqual(["static", "triggered"]);
});
test("abilityIsKind never counts it", () => {
  const t = pact.tags?.abilities.find(losesYouTheGame);
  expect(t).toBeDefined();
  expect(abilityIsKind(t!, "triggered")).toBe(false);
  expect(abilityIsKind(solemn.tags!.abilities[0]!, "triggered")).toBe(true);
});
test("negative control: an opp loses-game, or one among several emits, is not silenced", () => {
  const oppLoss = phage.tags!.abilities.find((a) => a.emits?.some((e) => e.verb === "loses-game" && e.subject.control === "opp"));
  expect(oppLoss).toBeDefined();
  expect(losesYouTheGame(oppLoss!)).toBe(false);
  const base = pact.tags!.abilities.find(losesYouTheGame)!;
  expect(losesYouTheGame({ ...base, emits: [...base.emits!, { verb: "draw", subject: { control: "you", token: null } }] } as never)).toBe(false);
  expect(losesYouTheGame({ ...base, emits: [{ verb: "loses-game", subject: { control: "any", token: null } }] } as never)).toBe(false);
});
test("the partner side: a Pact-only card claims no ability, keeps its loss key for a rescue, and offers no copy key", () => {
  const lone = { ...pact, tags: { ...pact.tags!, abilities: pact.tags!.abilities.filter(losesYouTheGame) } } as DeckCard;
  expect(claimingAbilitiesOf(lone)).toEqual([]);
  expect(emitKeysOf(lone).some((k) => k.startsWith("loses-game"))).toBe(true);
  expect(supplyKeysOf(lone)).not.toContain("copies|-|triggered|-");
  expect(supplyKeysOf(solemn)).toContain("copies|-|triggered|-");
});
