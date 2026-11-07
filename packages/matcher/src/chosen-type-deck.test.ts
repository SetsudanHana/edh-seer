import { expect, test } from "vitest";
import { deriveCardTags, deriveInputOf } from "@edh-seer/tagger";
import type { CardTags, ClauseRecord } from "@edh-seer/tagger";
import type { CardLookup } from "@edh-seer/data/resolve";
import { normalizeName } from "@edh-seer/data/names";
import { analyzeDecklist } from "./orchestrate.js";
import { loadHierarchy, pairReasons } from "./index.js";
import type { DeckCard } from "./types.js";
import fixtures from "./fixtures/chosen-type-deck.json" with { type: "json" };

/** #1526 part 2, owner ruling 2026-11-07: "creatures of the chosen type" (Metallic Mimic, the chosen-type lords) is the DECK'S MAIN creature type -- its most common creature type -- and the card pairs
 *  only with creatures of that type. Neither an anthem over every creature (Mimic paired with 547 creature consumers) nor a refusal.
 *  Source documents and stored `cardClauses.canonical` dumped from Mongo 2026-11-07. */
const F = fixtures as unknown as Record<string, { source: Record<string, unknown> & { _id: string }; canonical: ClauseRecord[] }>;
const tagsOf = (name: string): CardTags => deriveCardTags(deriveInputOf(F[name]!.source as never, name, name, F[name]!.canonical)) as CardTags;
const dc = (name: string): DeckCard => ({ card: F[name]!.source as unknown as DeckCard["card"], tags: tagsOf(name) });

/** The REAL orchestrate path (`analyzeDecklist` -> `analyzeResolvedDeck` -> `analyzeDeckStructured`), fed stored documents and the tags derived from their stored clauses. */
async function mimicConsumers(decklist: string): Promise<string[]> {
  const byName = new Map(Object.entries(F).map(([n, f]) => [normalizeName(n), { ...f.source, searchNames: [normalizeName(n)], tags: { produces: [], cares: [] } }]));
  const tagsById = new Map(Object.entries(F).map(([n, f]) => [f.source._id, tagsOf(n)]));
  const lookup: CardLookup = { async findByName(n: string) { return (byName.get(n) ?? null) as never; }, async allCombos() { return []; } };
  const sources = { lookup, tagsLookup: { findOne: async (id: string) => tagsById.get(id) ?? null }, tokenTags: () => null, tokenArt: async () => new Map<string, string>() } as never;
  const { report } = await analyzeDecklist(decklist, undefined, async () => sources);
  return report.edges.flatMap((e) => e.reasons)
    .filter((r) => r.producer === "Metallic Mimic" && r.tag === "static:enters-with-counters")
    .map((r) => r.consumer!).sort();
}

const ELF_DECK = ["Metallic Mimic", "Llanowar Elves", "Elvish Mystic", "Elvish Archdruid", "Generous Patron", "Grizzly Bears", "Serra Angel", "Kros, Defense Contractor"].map((n) => `1 ${n}`).join("\n");

test("in a deck whose main creature type is Elf, Metallic Mimic pairs with the Elves and with no other creature", async () => {
  // Generous Patron is an Elf Advisor (stored type line), so it belongs on the paired side; the non-Elves are Bear, Angel and Cat Advisor.
  expect(await mimicConsumers(ELF_DECK)).toEqual(["Elvish Archdruid", "Elvish Mystic", "Generous Patron", "Llanowar Elves"]);
});

test("the chosen type follows the deck: with two Advisors as the most common type Mimic pairs with the Advisors only, not the lone Elf", async () => {
  // Kros (Cat Advisor) and Generous Patron (Elf Advisor) make Advisor the deck's main type; Patron is paired as an Advisor, and Bear and Angel are not.
  const deck = ["Metallic Mimic", "Kros, Defense Contractor", "Generous Patron", "Grizzly Bears", "Serra Angel"].map((n) => `1 ${n}`).join("\n");
  expect(await mimicConsumers(deck)).toEqual(["Generous Patron", "Kros, Defense Contractor"]);
});

// No deck, no main type (a card page, a partner suggestion, the compass's pair isolation): `pairReasons` is handed two cards and the chosen type is unresolved.
// OWNER RULING 2026-11-07 (#1526 part 2, no-deck view): an unresolved chosen-type creature subject pairs ONLY with creatures that themselves care about a creature type -- other lords and kindred
// payoffs. Not every creature (Mimic paired with 547), and not nothing.
const mimicStatic = (c: string) => pairReasons(dc("Metallic Mimic"), dc(c), loadHierarchy()).filter((r) => r.producer === "Metallic Mimic" && r.consumer === c && r.tag === "static:enters-with-counters");

test("with no deck, Metallic Mimic pairs with a creature that cares about a creature type (a lord) and with no other creature", () => {
  expect(mimicStatic("Elvish Archdruid")).not.toEqual([]);
  for (const plain of ["Grizzly Bears", "Serra Angel", "Llanowar Elves", "Elvish Mystic"]) expect(mimicStatic(plain), plain).toEqual([]);
});
