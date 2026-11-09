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
});

/** #1581, owner ruling 2026-11-09. Hypnox ("When this creature enters, if you cast it from your hand, exile all cards from target opponent's hand. When this creature leaves the battlefield, return the exiled cards to their owner's hand.")
 *  and the Champions ("As an additional cost to cast this spell, behold a Kithkin and exile it. ... When this creature leaves the battlefield, return the exiled card to its owner's hand.") return nothing unless they were cast.
 *  Tidehollow Sculler exiles on every entry ("When this creature enters, ... Exile that card."), so its leave trigger always returns something. */
const CAST_ONLY_EXILE = ["Hypnox", "Champion of the Clachan", "Champion of the Weird", "Champions of the Perfect", "Champion of the Path", "Champions of the Shoal"];
describe("a creature whose leave trigger returns what only a CAST exile took (#1581)", () => {
  const pairs: [string, string][] = PUT_THEN_REMOVE.flatMap((p) => CAST_ONLY_EXILE.map((c): [string, string] => [p, c]));
  test.each(pairs)("%s (puts a creature, then removes it) -> %s: no leave reason", (producer, consumer) => {
    expect(leaveTags(producer, consumer)).toEqual([]);
  });
  test.each(["Animate Dead", "Reanimate"])("%s (a reanimator) -> Hypnox and the Champions: no leave reason", (producer) => {
    for (const c of CAST_ONLY_EXILE) expect(leaveTags(producer, c), c).toEqual([]);
  });
  test.each(CAST_ONLY_EXILE)("Ephemerate (a flicker: the flicker itself is a leave of a cast creature) -> %s still pairs", (consumer) => {
    expect(leaveTags("Ephemerate", consumer).length).toBeGreaterThan(0);
  });
  test.each(PUT_THEN_REMOVE)("%s -> Tidehollow Sculler (exiles on every entry) still pairs", (producer) => {
    expect(leaveTags(producer, "Tidehollow Sculler").length).toBeGreaterThan(0);
  });
});


describe("an Aura whose leave trigger acts on its host is not triggered by the host's own departure", () => {
  test.each(["Parallax Dementia", "Reality Acid"])("Murder (the host dies, the Aura goes with it) -> %s: no host-leaves reason", (aura) => {
    expect(leaveTags("Murder", aura)).toEqual([]);
  });
  test.each(["Parallax Dementia", "Reality Acid"])("Dawn of the Dead's exile of the creature -> %s: none", (aura) => {
    expect(leaveTags("Dawn of the Dead", aura)).toEqual([]);
  });
  test.each(["Farewell", "Austere Command", "Cleansing Nova"])("%s (its card also removes every enchantment or permanent, yours included) -> Parallax Dementia and Reality Acid still pair", (producer) => {
    expect(leaveTags(producer, "Parallax Dementia").length).toBeGreaterThan(0);
    expect(leaveTags(producer, "Reality Acid").length).toBeGreaterThan(0);
  });
  test.each(["Isolate", "Fragmentize", "Beast Within", "Revoke Existence", "Shoot Down"])("%s (a TARGETED removal can be aimed at your own Aura, whatever control it is stored with) -> Reality Acid pairs", (producer) => {
    expect(leaveTags(producer, "Reality Acid").length).toBeGreaterThan(0);
  });
  test("Tranquil Domain (\"Destroy all non-Aura enchantments\": the Aura is excluded) -> Reality Acid: none", () => {
    expect(leaveTags("Tranquil Domain", "Reality Acid")).toEqual([]);
  });
  test("Pharika's Libation (an opponent-only edict cannot choose your Aura) and Portal of Sanctuary (takes the host and its Auras together) -> Parallax Dementia: none", () => {
    expect(leaveTags("Pharika's Libation", "Parallax Dementia")).toEqual([]);
    expect(leaveTags("Portal of Sanctuary", "Parallax Dementia")).toEqual([]);
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

/** #1513 review round: WHAT CAN REMOVE THE AURA FROM THE BATTLEFIELD. A producer card keeps its pair with Parallax Dementia / Reality Acid only if one of its removal events can take a permanent off the battlefield that may be
 *  the Aura: not an exile from hand (Sunscour's alternative cost) or a graveyard (Force of Despair), not a token, not an opponent-only target ("an opponent controls": Banishing Light), not an opponent's edict (Invoke Despair:
 *  "Target opponent sacrifices ... an enchantment"), not one filter's rider held against another type's alternative (Ravnica at War's multicolored, Pyroblast's blue), not a host taken with its Auras (End Hostilities). */
const bothAuras = (producer: string) => [leaveTags(producer, "Parallax Dementia"), leaveTags(producer, "Reality Acid")];
describe("reachesAura: only a removal that can take the Aura off the battlefield", () => {
  test.each([
    "Sunscour", "Force of Despair", "Kozilek's Command", "Riveteers Charm", // a hand or graveyard exile
    "Phantom Steed", "Mardu Siegebreaker", "Echoing Assault", // a token
    "Lord Xander, the Collector", "Invoke Despair", "Starseer Mentor", // an opponent's edict
    "Banishing Light", "Assassin's Trophy", "Feed the Swarm", "Cyclonic Rift", "Skyclave Apparition", "Leyline Binding", // "an opponent controls" / "you don't control"
    "Ravnica at War", "Sentinel of the Pearl Trident", // a dropped colour / historic rider
    "End Hostilities", // the host and its Auras together
    "Murder",
  ])("%s -> Parallax Dementia and Reality Acid: none", (producer) => {
    expect(bothAuras(producer)).toEqual([[], []]);
  });
  test.each(["Farewell", "Austere Command", "Cleansing Nova", "Gaius van Baelsar", "Isolate", "Beast Within", "Shoot Down"])("%s still pairs with both", (producer) => {
    const [p, r] = bothAuras(producer);
    expect(p!.length).toBeGreaterThan(0);
    expect(r!.length).toBeGreaterThan(0);
  });
  test("Pyroblast (\"Destroy target permanent if it's blue\"): Reality Acid is blue and pairs, the black Parallax Dementia does not", () => {
    expect(leaveTags("Pyroblast", "Parallax Dementia")).toEqual([]);
    expect(leaveTags("Pyroblast", "Reality Acid").length).toBeGreaterThan(0);
  });
  test("Thraben Exorcism (\"Exile target Spirit, creature with disturb, or enchantment\": the Spirit subtype belongs to the creature alternative) -> Reality Acid still pairs", () => {
    expect(leaveTags("Thraben Exorcism", "Reality Acid").length).toBeGreaterThan(0);
  });
});

describe("a put creature the clause names with a definite noun phrase", () => {
  test.each(["Primeval Spawn", "Thief of Existence"])("Sneak Attack (\"Sacrifice the creature at the beginning of the next end step\") -> %s: no leave reason", (consumer) => {
    expect(leaveTags("Sneak Attack", consumer)).toEqual([]);
  });
});
