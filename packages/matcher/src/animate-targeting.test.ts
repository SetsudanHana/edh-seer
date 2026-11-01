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
const embers = fromText("Ember Island Production", "Sorcery", "Choose one —\n• Create a token that's a copy of target creature you control, except it's not legendary and it's a 4/4 Hero in addition to its other types.\n• Create a token that's a copy of target creature an opponent controls, except it's not legendary and it's a 2/2 Coward in addition to its other types.");
const targetingOf = (c: DeckCard): unknown[] => producerEvents(c.tags!).flatMap((e) => (e as { targeting?: unknown[] }).targeting ?? []);

test("Rebuild the City and Applied Geometry state no creature target; a token copy of a target creature still does", () => {
  expect(targetingOf(rebuild)).toEqual([]);
  expect(targetingOf(geometry)).toEqual([]);
  expect(targetingOf(embers)).toContainEqual({ control: "you", type: "creature", subtype: "hero" });
  expect(rebuild.tags!.abilities.find((a) => a.effect.kind === "token-generation")?.effect.subject).toMatchObject({ token: true, type: ["creature", "land"] });
});

test("...so no heroic creature forms a cast edge with the first two, and does with the third", () => {
  for (const c of [rebuild, geometry]) expect(pairReasons(c, crusader, H).some((r) => r.tag.startsWith("cast:")), c.card.name).toBe(false);
  expect(pairReasons(embers, crusader, H).some((r) => r.tag.startsWith("cast:"))).toBe(true);
});
