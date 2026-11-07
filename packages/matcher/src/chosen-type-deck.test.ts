import { expect, test } from "vitest";
import { deriveCardTags, deriveInputOf } from "@edh-seer/tagger";
import type { CardTags, ClauseRecord } from "@edh-seer/tagger";
import type { CardLookup } from "@edh-seer/data/resolve";
import { normalizeName } from "@edh-seer/data/names";
import { analyzeDecklist } from "./orchestrate.js";
import { loadHierarchy, pairReasons } from "./index.js";
import { caresAboutCreatureType, refuseUnresolvedChosenTypes, resolveChosenTypes } from "./chosen-type.js";
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

// The same ruling for the other readers of an unresolved chosen creature type: a trigger that watches it (Kindred Discovery, the consumer side), a recursion that reaches it (Haunting Voyage), a cost reduction (Herald's Horn).
const pairOf = (a: string, b: string, tag: RegExp) => pairReasons(dc(a), dc(b), loadHierarchy()).filter((r) => tag.test(r.tag));

test("with no deck, a trigger on 'a creature of the chosen type' (Kindred Discovery) hears a creature that cares about a creature type and no other", () => {
  expect(pairOf("Kindred Discovery", "Elvish Archdruid", /^enters:creature/)).not.toEqual([]);
  for (const plain of ["Grizzly Bears", "Serra Angel", "Llanowar Elves"]) expect(pairOf("Kindred Discovery", plain, /^enters:creature/), plain).toEqual([]);
});

test("with no deck, Herald's Horn (cost reduction) and Haunting Voyage (recursion) pair with no creature that ignores creature types, and leave no tag behind that names no type", () => {
  for (const plain of ["Grizzly Bears", "Serra Angel", "Llanowar Elves"]) {
    expect(pairOf("Herald's Horn", plain, /cost-reduction/), plain).toEqual([]);
    expect(pairReasons(dc("Haunting Voyage"), dc(plain), loadHierarchy()).filter((r) => /recursion|__none__/.test(r.tag)), plain).toEqual([]);
  }
  expect(pairOf("Herald's Horn", "Elvish Archdruid", /cost-reduction/)).not.toEqual([]);
});

test("'odd or even' is not a creature-type choice: Extinction Event's tags are left exactly as they were, Haunting Voyage's are not", () => {
  const ee = dc("Extinction Event"), hv = dc("Haunting Voyage");
  expect(refuseUnresolvedChosenTypes(ee.tags!, ee.card.oracleText)).toBe(ee.tags);
  expect(refuseUnresolvedChosenTypes(hv.tags!, hv.card.oracleText)).not.toBe(hv.tags);
});

// DERIVE DOES NOT RECORD A TYPE NAMED ONLY IN A CONDITION, A COST OR A COUNT, so the printed text is read too (owner decision 2026-11-07, #1526 part 2): a kindred payoff the derived path misses still pairs.
test("with no deck, a kindred payoff derive does not see (type named in a trigger, a condition, a count or a reveal cost) still pairs with Metallic Mimic", () => {
  for (const payoff of ["Akki Ronin", "Academy Journeymage", "Goldmeadow Stalwart", "Sunderflock"]) expect(mimicStatic(payoff), payoff).not.toEqual([]);
});

test("with no deck, a card that only MAKES a creature of a type (Ambassador Oak's Elf Warrior token, Rhovanion Rampager's amass Goblins) is not a type-caring card", () => {
  for (const maker of ["Ambassador Oak", "Rhovanion Rampager"]) expect(mimicStatic(maker), maker).toEqual([]);
});

// REVIEW OF #1526 (Opus, BLOCK): the ruling is about CREATURE partners. A non-creature partner is paired exactly as it was.
test("with no deck, Metallic Mimic still pairs with a non-creature that cares about its counters (Hardened Scales, Doubling Season)", () => {
  expect(pairOf("Metallic Mimic", "Hardened Scales", /counter-added/)).not.toEqual([]);
  expect(pairReasons(dc("Metallic Mimic"), dc("Doubling Season"), loadHierarchy())).not.toEqual([]);
});

test("with no deck, a chosen-type card's SELF trigger survives (Elvish Soultiller's 'when this creature dies' still hears Viscera Seer's sacrifice)", () => {
  expect(pairOf("Elvish Soultiller", "Viscera Seer", /^dies:/)).not.toEqual([]);
});

test("'Heroes' is the plural of 'Hero': Captain America's 'other Heroes you control' is a creature-type payoff", () => {
  expect(mimicStatic("Captain America, Super-Soldier")).not.toEqual([]);
});

// #1568: THE DERIVED SUBJECT SAYS WHAT WAS CHOSEN (`chosenKind`), so neither the deck resolution nor the no-deck refusal reads the printed words.
const subjectsOfTags = (t: CardTags) => t.abilities.flatMap((a) => [a.trigger?.subject, a.effect.subject, a.doublesOf, ...(a.emits ?? []).map((e) => e.subject)]).filter((s) => s?.chosenType === true);

test("derive stamps the kind: Cloud Key chose a card type, Gathering Stone a creature type, Extinction Event odd or even", () => {
  expect(subjectsOfTags(tagsOf("Cloud Key")).map((s) => s!.chosenKind)).toEqual(["card-type"]);
  expect(subjectsOfTags(tagsOf("Stenn, Paranoid Partisan")).map((s) => s!.chosenKind)).toEqual(["card-type"]);
  expect(new Set(subjectsOfTags(tagsOf("Gathering Stone")).map((s) => s!.chosenKind))).toEqual(new Set(["creature-type"]));
  expect(new Set(subjectsOfTags(tagsOf("Extinction Event")).map((s) => s!.chosenKind))).toEqual(new Set(["parity"]));
  expect(new Set(subjectsOfTags(tagsOf("Kindred Discovery")).map((s) => s!.chosenKind))).toEqual(new Set(["creature-type"]));
});

test("in a deck of Elves, Cloud Key's card-type choice is NOT resolved to the Elf subtype; Kindred Discovery's creature-type choice is", () => {
  const counts = new Map([["elf", 9], ["goblin", 1]]);
  const key = resolveChosenTypes(tagsOf("Cloud Key"), counts, loadHierarchy());
  expect(JSON.stringify(key.abilities)).not.toContain('"subtype":"elf"');
  expect(subjectsOfTags(key).map((s) => s!.chosenKind)).toEqual(["card-type"]);
  const kd = resolveChosenTypes(tagsOf("Kindred Discovery"), counts, loadHierarchy());
  expect(JSON.stringify(kd.abilities)).toContain('"subtype":"elf"');
});

test("with no deck the refusal keys on the kind: a creature-type choice is refused whatever the subject's type or the printed words, a card-type or parity choice never is", () => {
  const gs = tagsOf("Gathering Stone"), ck = tagsOf("Cloud Key"), ee = tagsOf("Extinction Event");
  // Gathering Stone's chosen subjects are spells and untyped cards, not creatures: the old creature-subject scope left them the wildcard they were.
  expect(refuseUnresolvedChosenTypes(gs, "")).not.toBe(gs);
  // the words say "creature type" but the derived kind says what was chosen
  expect(refuseUnresolvedChosenTypes(ck, "creature type")).toBe(ck);
  expect(refuseUnresolvedChosenTypes(ee, "creature type")).toBe(ee);
});

test("a subject with NO kind falls back to the printed cue: 'creature type' in the words refuses it, other words do not", () => {
  const strip = (t: CardTags): CardTags => ({ ...t, abilities: JSON.parse(JSON.stringify(t.abilities).replaceAll(/"chosenKind":"[a-z-]+",?/g, "").replaceAll(",}", "}")) });
  // (the refusal is memoised on the tags object, so each reading gets its own copy)
  const [a, b] = [strip(tagsOf("Kindred Discovery")), strip(tagsOf("Kindred Discovery"))];
  expect(JSON.stringify(a)).not.toContain("chosenKind");
  expect(refuseUnresolvedChosenTypes(a, "choose a creature type")).not.toBe(a);
  expect(refuseUnresolvedChosenTypes(b, "choose a card type")).toBe(b);
});

test("Leyline of Transformation 'creatures you control are the chosen type in addition to their other types' is a type-grant, not a keyword-grant", () => {
  const kinds = tagsOf("Leyline of Transformation").abilities.map((a) => a.effect.kind);
  expect(kinds).toContain("type-grant");
  expect(kinds).not.toContain("keyword-grant");
});

test("a card whose own chosen type is a card type, a land type or odd or even does not CARE about a creature type; a creature-type choice does", () => {
  const cares = (n: string) => caresAboutCreatureType(tagsOf(n), F[n]!.source as never);
  for (const n of ["Cloud Key", "Stenn, Paranoid Partisan", "Shimmer", "Extinction Event"]) expect(cares(n), n).toBe(false);
  for (const n of ["Kindred Discovery", "Gathering Stone", "Herald's Horn"]) expect(cares(n), n).toBe(true);
});

test("an UNTYPED creature-type subject (Gathering Stone's 'put it into your graveyard', a graveyard fill of any card) is left the wildcard it was; a typed one is refused", () => {
  const gs = tagsOf("Gathering Stone");
  const untyped = (t: CardTags): CardTags => ({ ...t, abilities: t.abilities.filter((a) => a.effect.subject?.type === undefined && a.trigger?.subject?.type !== "spell") });
  const fills = untyped(gs);
  expect(fills.abilities.length).toBeGreaterThan(0);
  expect(refuseUnresolvedChosenTypes(fills, "")).toBe(fills);
  expect(JSON.stringify(refuseUnresolvedChosenTypes(gs, "").abilities)).toContain('"mill"');
});

// OWNER RULING 2026-11-07 (#1568): the no-deck refusal is of the chosen-type DEMAND (which creatures a card reaches), not of a side effect that does not depend on the chosen type. A counter a card puts on itself,
// life, a draw, a copy of the spell still pairs with any creature that uses it. (The brief named "Doc Samson, Soul Diviner"; the corpus card that uses counters is Doc Samson, Super Psychiatrist.)
test("with no deck, a chosen-type card's side effect still pairs with a creature that uses it (counters on itself, life gain), and its chosen-type demand still does not", () => {
  expect(pairOf("Door of Destinies", "Doc Samson, Super Psychiatrist", /counter-added/)).not.toEqual([]);
  expect(pairOf("Rimefire Torque", "Doc Samson, Super Psychiatrist", /counter-added/)).not.toEqual([]);
  expect(pairOf("Dawn-Blessed Pennant", "Oloro, Ageless Ascetic", /gain-life/)).not.toEqual([]);
  expect(mimicStatic("Grizzly Bears")).toEqual([]);
  expect(pairReasons(dc("Door of Destinies"), dc("Grizzly Bears"), loadHierarchy())).toEqual([]);
});
