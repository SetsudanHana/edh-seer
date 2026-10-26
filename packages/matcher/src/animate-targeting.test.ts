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
