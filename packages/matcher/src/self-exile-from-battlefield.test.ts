import { expect, test } from "vitest";
import { clauseTexts, deriveCardTags } from "@edh-seer/tagger";
import type { Characteristics, ClauseRecord, CardTags } from "@edh-seer/tagger";
import { loadHierarchy, pairReasons } from "./index.js";
import type { DeckCard } from "./types.js";

/** #1495: "When X dies or is put into exile from the battlefield" lost its zone, so a card exiled from a GRAVEYARD fed it.
 *  Oracle text and clause records are the corpus's own (cards.oracleText, cardClauses.canonical, DERIVE 447). */
const chars = (types: string[]): Characteristics => ({
  types, subtypes: [], colors: [], identity: [], cmc: 0, power: null, toughness: null, token: false, keywords: [],
});
function card(name: string, types: string[], oracleText: string, clauses: ClauseRecord[]): DeckCard {
  const texts = clauseTexts({ oracleText, keywords: [], typeLine: types.join(" ") });
  const tags = deriveCardTags({ oracleId: name, name, clauses, clauseTexts: texts, characteristics: chars(types) }) as CardTags;
  return { card: { name, typeLine: types.join(" "), oracleText, keywords: [], colors: [], manaValue: 0 } as unknown as DeckCard["card"], tags };
}
const H = loadHierarchy();

const bontu = card("God-Eternal Bontu", ["creature"],
  "Menace\nWhen God-Eternal Bontu enters, sacrifice any number of other permanents, then draw that many cards.\nWhen God-Eternal Bontu dies or is put into exile from the battlefield, you may put her into her owner's library third from the top.",
  [
    { id: 1, abilityType: "none", actions: [{ verb: "none", object: "Menace" }] },
    { id: 2, abilityType: "triggered", trigger: { event: "enters", subject: "God-Eternal Bontu", control: "you" }, actions: [{ verb: "sacrifice", object: "any number of other permanents", optional: true }, { verb: "draw", object: "cards", amount: "that many" }] },
    { id: 3, abilityType: "triggered", trigger: { event: "dies", subject: "God-Eternal Bontu", control: "you" }, actions: [{ verb: "put", object: "God-Eternal Bontu", fromZone: "graveyard", toZone: "library", optional: true }] },
    { id: 4, abilityType: "triggered", trigger: { event: "exiled", subject: "God-Eternal Bontu", control: "you" }, actions: [{ verb: "put", object: "God-Eternal Bontu", fromZone: "exile", toZone: "library", optional: true }] },
  ] as ClauseRecord[]);

const necropotence = card("Necropotence", ["enchantment"],
  "Skip your draw step.\nWhenever you discard a card, exile that card from your graveyard.\nPay 1 life: Exile the top card of your library face down. Put that card into your hand at the beginning of your next end step.",
  [
    { id: 1, abilityType: "static", actions: [{ verb: "cant", object: "draw during your draw step" }] },
    { id: 2, abilityType: "triggered", trigger: { event: "discarded", subject: "a card", control: "you" }, actions: [{ verb: "exile", object: "that card", fromZone: "graveyard", toZone: "exile" }] },
    { id: 3, abilityType: "activated", actions: [{ verb: "lose-life", object: "you", amount: "1" }, { verb: "exile", object: "the top card of your library", fromZone: "library", toZone: "exile" }, { verb: "put", object: "that card", fromZone: "exile", toZone: "hand" }] },
  ] as ClauseRecord[]);

/** Exiles YOUR creature from the battlefield: the printed zone on the action (Ephemerate's record) and no zone at all (Cloudshift's, the model stored none). */
const ephemerate = card("Ephemerate", ["instant"], "Exile target creature you control, then return it to the battlefield under its owner's control.",
  [{ id: 1, abilityType: "spell", actions: [{ verb: "exile", object: "target creature you control", fromZone: "battlefield", toZone: "exile" }, { verb: "return", object: "it", fromZone: "exile", toZone: "battlefield" }] }] as ClauseRecord[]);
const cloudshift = card("Cloudshift", ["instant"], "Exile target creature you control, then return that card to the battlefield under your control.",
  [{ id: 1, abilityType: "spell", actions: [{ verb: "exile", object: "target creature you control" }, { verb: "return", object: "that card", toZone: "battlefield" }] }] as ClauseRecord[]);

const exileTags = (a: DeckCard, b: DeckCard) => pairReasons(a, b, H).filter((r) => r.tag.startsWith("exiled"));

test("Bontu's exile trigger carries fromZone battlefield; its dies trigger is kept", () => {
  const triggers = bontu.tags!.abilities!.map((a) => a.trigger).filter(Boolean);
  const exiles = triggers.filter((t) => t!.verbs.includes("exiled"));
  expect(exiles.length).toBeGreaterThan(0);
  expect(exiles.every((t) => t!.subject.fromZone === "battlefield" && t!.subject.self === true)).toBe(true);
  expect(triggers.some((t) => t!.verbs.includes("dies") && t!.subject.self === true)).toBe(true);
});

test("a graveyard exile (Necropotence) does not feed Bontu's exile-from-the-battlefield trigger", () => {
  expect(exileTags(necropotence, bontu)).toEqual([]);
});

test("an exile of your creature from the battlefield still feeds it, zone stated (Ephemerate) or not (Cloudshift)", () => {
  expect(exileTags(ephemerate, bontu).length).toBeGreaterThan(0);
  expect(exileTags(cloudshift, bontu).length).toBeGreaterThan(0);
});
