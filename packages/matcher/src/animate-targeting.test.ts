import { expect, test } from "vitest";
import { deriveCardTags, deriveInputOf, grammarClauseRecords } from "@edh-seer/tagger";
import type { CardTags } from "@edh-seer/tagger";
import { loadHierarchy, pairReasons } from "./index.js";
import { producerEvents } from "./edges.js";
import type { DeckCard } from "./types.js";

/** A TARGET ANIMATE KEEPS ITS CLASS (#1352 review). The grammar once folded "target land you control becomes a 3/3 Elemental creature" into the animate's subject, which `spellTargeting`
 *  reads as "the spell targets a creature you control": Brave the Wilds (a land) met Leyline of Resonance and every heroic creature. Real oracle text (Mongo `cards`), derived from the
 *  grammar's own records. */
const H = loadHierarchy();
function fromText(name: string, typeLine: string, oracleText: string): DeckCard {
  const card = { name, typeLine, oracleText, keywords: [] as string[] };
  const g = grammarClauseRecords(card);
  expect(g.complete, name).toBe(true);
  const tags = deriveCardTags(deriveInputOf(card as never, name, name, g.records, undefined, g.readings)) as CardTags;
  return { card: { ...card, colors: [], manaValue: 0 } as unknown as DeckCard["card"], tags };
}
const brave = fromText("Brave the Wilds", "Sorcery", "Bargain (You may sacrifice an artifact, enchantment, or token as you cast this spell.)\nIf this spell was bargained, target land you control becomes a 3/3 Elemental creature with haste that's still a land.\nSearch your library for a basic land card, reveal it, put it into your hand, then shuffle.");
const crusader = fromText("Akroan Crusader", "Creature — Human Soldier", "Heroic — Whenever you cast a spell that targets this creature, create a 1/1 red Soldier creature token with haste. (It can attack and {T} as soon as it comes under your control.)");
const giantGrowth = fromText("Giant Growth", "Instant", "Target creature gets +3/+3 until end of turn.");

test("Brave the Wilds' derived row states no creature target", () => {
  const targeting = producerEvents(brave.tags!).flatMap((e) => (e as { targeting?: unknown[] }).targeting ?? []);
  expect(targeting).toEqual([]);
  expect(brave.tags!.abilities.find((a) => a.effect.kind === "animate")?.effect.subject).toMatchObject({ type: "land", scope: "target" });
});

test("...so a heroic creature forms no cast edge with it (and does with a spell that does target a creature: Giant Growth)", () => {
  expect(pairReasons(brave, crusader, H).some((r) => r.tag.startsWith("cast:"))).toBe(false);
  expect(pairReasons(giantGrowth, crusader, H).some((r) => r.tag.startsWith("cast:"))).toBe(true);
});

/** A TOKEN COPY OF A TARGET IS AIMED AT WHAT IT COPIES, NOT AT WHAT IT BECOMES (#1365). The token-generation subject describes the TOKEN ("a 3/3 creature in addition to its other types"); its
 *  `scope: target` is the copied permanent's, so the token's own `creature` type read as a creature target. Real oracle text (Mongo `cards`), derived from the grammar's own records. */
/** Rebuild the City is not grammar-complete: its STORED reading (Mongo `cardClauses`, verbatim) is derived. */
const rebuildCard = { name: "Rebuild the City", typeLine: "Sorcery", oracleText: "Choose target land. Create three tokens that are copies of it, except they're 3/3 creatures in addition to their other types and they have vigilance and menace. (They're affected by summoning sickness.)", keywords: [] as string[] };
const rebuild: DeckCard = {
  card: { ...rebuildCard, colors: [], manaValue: 0 } as unknown as DeckCard["card"],
  tags: deriveCardTags(deriveInputOf(rebuildCard as never, "Rebuild the City", "Rebuild the City", [{ id: 1, abilityType: "spell", actions: [{ verb: "create", object: "a token that is a copy of target land, except it's a 3/3 creature in addition to its other types and it has vigilance and menace", fromZone: null, toZone: null, amount: "3", optional: false }] }] as never)) as CardTags,
};
const geometry = fromText("Applied Geometry", "Sorcery — Lesson", "Create a token that's a copy of target non-Aura permanent you control, except it's a 0/0 Fractal creature in addition to its other types. Put six +1/+1 counters on it.");
/** Will of the Temur is not grammar-complete either: its STORED reading (Mongo `cardClauses`, verbatim) is derived. */
const willCard = { name: "Will of the Temur", typeLine: "Sorcery", oracleText: "Choose one. If you control a commander as you cast this spell, you may choose both instead.\n\u2022 Create a token that's a copy of target permanent, except it's a 4/4 Dragon creature with flying in addition to its other types.\n\u2022 Target player draws cards equal to the greatest mana value among permanents you control.", keywords: [] as string[] };
const will: DeckCard = {
  card: { ...willCard, colors: [], manaValue: 0 } as unknown as DeckCard["card"],
  tags: deriveCardTags(deriveInputOf(willCard as never, "Will of the Temur", "Will of the Temur", [
    { id: 1, abilityType: "spell", actions: [{ verb: "none" }] },
    { id: 2, abilityType: "spell", actions: [{ verb: "create", object: "a token that's a copy of target permanent, except it's a 4/4 Dragon creature with flying in addition to its other types", fromZone: null, toZone: null, amount: "1", optional: false }] },
    { id: 3, abilityType: "spell", actions: [{ verb: "draw", object: "cards equal to the greatest mana value among permanents you control", fromZone: null, toZone: null, amount: "the greatest mana value among permanents you control", optional: false }] },
  ] as never)) as CardTags,
};
const embers = fromText("Ember Island Production", "Sorcery", "Choose one —\n• Create a token that's a copy of target creature you control, except it's not legendary and it's a 4/4 Hero in addition to its other types.\n• Create a token that's a copy of target creature an opponent controls, except it's not legendary and it's a 2/2 Coward in addition to its other types.");
const targetingOf = (c: DeckCard): unknown[] => producerEvents(c.tags!).flatMap((e) => (e as { targeting?: unknown[] }).targeting ?? []);

test("Rebuild the City and Will of the Temur state no creature target; Applied Geometry (a non-Aura permanent YOU control, which can be a creature, #713) and a copy of a target creature do", () => {
  expect(targetingOf(rebuild)).toEqual([]);
  expect(targetingOf(will)).toEqual([]);
  expect(targetingOf(geometry)).toContainEqual({ control: "you", type: "creature", subtype: "fractal" });
  expect(targetingOf(embers)).toContainEqual({ control: "you", type: "creature", subtype: "hero" });
  expect(rebuild.tags!.abilities.find((a) => a.effect.kind === "token-generation")?.effect.subject).toMatchObject({ token: true, type: ["creature", "land"] });
});

test("...so no heroic creature forms a cast edge with Rebuild the City or Will of the Temur, and does with Applied Geometry and Ember Island", () => {
  for (const c of [rebuild, will]) expect(pairReasons(c, crusader, H).some((r) => r.tag.startsWith("cast:")), c.card.name).toBe(false);
  expect(pairReasons(geometry, crusader, H).some((r) => r.tag.startsWith("cast:"))).toBe(true);
  expect(pairReasons(embers, crusader, H).some((r) => r.tag.startsWith("cast:"))).toBe(true);
});

/** AN ANIMATE'S RESULT HAS ITS OWN SLOT (#1364). What the object BECOMES (types, subtypes, P/T) is `Effect.becomes`, never the subject: the subject keeps what is targeted or affected, which is
 *  all `spellTargeting` may read. Real oracle text (Mongo `cards`), derived from the grammar's own records. */
/** The five #1352 cards are not grammar-complete: their STORED readings (Mongo `cardClauses`, verbatim) are derived, so the stored path states `becomes` too. */
function fromStored(name: string, typeLine: string, oracleText: string, records: unknown[]): DeckCard {
  const card = { name, typeLine, oracleText, keywords: [] as string[] };
  const tags = deriveCardTags(deriveInputOf(card as never, name, name, records as never)) as CardTags;
  return { card: { ...card, colors: [], manaValue: 0 } as unknown as DeckCard["card"], tags };
}
const act = (verb: string, object: string) => ({ verb, object, fromZone: null, toZone: null, amount: null, optional: false });
const uprising = fromStored("Elemental Uprising", "Instant", "Target land you control becomes a 4/4 Elemental creature with haste until end of turn. It's still a land. It must be blocked this turn if able.",
  [{ id: 1, abilityType: "spell", actions: [act("animate", "target land you control"), act("grant-ability", "target land you control"), act("cant", "not be blocked this turn if able")] }]);
const slumber = fromStored("Disturbed Slumber", "Instant", "Until end of turn, target land you control becomes a 4/4 Dinosaur creature with reach and haste. It's still a land. It must be blocked this turn if able.",
  [{ id: 1, abilityType: "spell", actions: [act("animate", "target land you control becomes a 4/4 Dinosaur creature with reach and haste"), act("cant", "it can be unblocked this turn")] }]);
const kamahl = fromStored("Kamahl's Will", "Instant", "Choose one. If you control a commander as you cast this spell, you may choose both instead.\n\u2022 Until end of turn, any number of target lands you control become 1/1 Elemental creatures with vigilance, indestructible, and haste. They're still lands.\n\u2022 Choose target creature you don't control. Each creature you control deals damage equal to its power to that creature.",
  [{ id: 1, abilityType: "spell" }, { id: 2, abilityType: "spell", actions: [{ verb: "animate", object: "any number of target lands you control", optional: false }, { verb: "grant-ability", object: "vigilance", optional: false }, { verb: "grant-ability", object: "indestructible", optional: false }, { verb: "grant-ability", object: "haste", optional: false }] },
    { id: 3, abilityType: "spell", actions: [{ verb: "deal-damage", object: "target creature you don't control", amount: "the total power of each creature you control", optional: false }] }]);
const jade = fromText("Jade Statue", "Artifact", "{2}: This artifact becomes a 3/6 Golem artifact creature until end of combat. Activate only during combat.");
const livingPlane = fromText("Living Plane", "World Enchantment", "All lands are 1/1 creatures that are still lands.");
const animateOfCard = (c: DeckCard) => c.tags!.abilities.find((a) => a.effect.kind === "animate")!.effect as { subject?: unknown; becomes?: unknown };

test("a TARGET animate states its result in `becomes` and keeps the land as its subject", () => {
  expect(animateOfCard(brave).becomes).toMatchObject({ type: "creature", subtype: "elemental", stats: [{ metric: "power", op: "eq", value: 3 }, { metric: "toughness", op: "eq", value: 3 }] });
  expect(animateOfCard(uprising).becomes).toMatchObject({ type: "creature", subtype: "elemental" });
  expect(animateOfCard(slumber).becomes).toMatchObject({ type: "creature", subtype: "dinosaur" });
  expect(animateOfCard(kamahl).becomes).toMatchObject({ type: "creature", subtype: "elemental" });
  for (const c of [brave, uprising, slumber]) expect(animateOfCard(c).subject, c.card.name).toMatchObject({ type: "land", scope: "target" });
});

test("...so its spell states no creature target and no heroic creature meets it", () => {
  for (const c of [brave, uprising, slumber, kamahl]) {
    expect(targetingOf(c), c.card.name).toEqual([]);
    expect(pairReasons(c, crusader, H).some((r) => r.tag.startsWith("cast:")), c.card.name).toBe(false);
  }
});

test("a SELF animate keeps its result in the subject, as the store writes it, and also states it in `becomes`", () => {
  expect(animateOfCard(jade).subject).toMatchObject({ self: true, subtype: "golem", type: ["creature", "artifact"] });
  expect(animateOfCard(jade).becomes).toMatchObject({ subtype: "golem", type: ["creature", "artifact"] });
});

test("a CLASS animate states its result in `becomes`, its subject stays the lands", () => {
  expect(animateOfCard(livingPlane).becomes).toMatchObject({ type: "creature", stats: [{ metric: "power", op: "eq", value: 1 }, { metric: "toughness", op: "eq", value: 1 }] });
  expect(animateOfCard(livingPlane).subject).toMatchObject({ type: "land" });
});
