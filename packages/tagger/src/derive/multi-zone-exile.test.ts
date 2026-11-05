/** One exile that takes cards from several zones is one `exiled` emit per zone (#1311). Stored shapes are copied from Mongo (`cardClauses.canonical`, DERIVE 452). */
import { describe, expect, test } from "vitest";
import type { ClauseRecord } from "../canonicalize.js";
import { deriveInputOf } from "../derive-input.js";
import { grammarClauseRecords } from "../grammar/clause-record.js";
import { deriveAbilities, deriveCardTags } from "./derive.js";

const zonesOf = (abilities: ReturnType<typeof deriveAbilities>["abilities"], type?: string): (string | undefined)[] =>
  abilities.flatMap((a) => a.emits ?? []).filter((e) => e.verb === "exiled" && (type === undefined || e.subject.fromZone !== "battlefield")).map((e) => e.subject.fromZone);

const SURGICAL_TEXT = "Choose target card in a graveyard other than a basic land card. Search its owner's graveyard, hand, and library for any number of cards with the same name as that card and exile them. Then that player shuffles.";
const surgical: ClauseRecord[] = [{ id: 2, abilityType: "spell", actions: [
  { verb: "search", object: "any number of cards with the same name as target card", fromZone: "graveyard", toZone: null, amount: null, optional: true },
  { verb: "search", object: "any number of cards with the same name as target card", fromZone: "hand", toZone: null, amount: null, optional: true },
  { verb: "search", object: "any number of cards with the same name as target card", fromZone: "library", toZone: null, amount: null, optional: true },
  { verb: "exile", object: "cards found", fromZone: null, toZone: "exile", amount: null, optional: false },
  { verb: "shuffle", object: "that player's library", fromZone: null, toZone: null, amount: null, optional: false }] }] as never;

function grammarTags(name: string, typeLine: string, oracleText: string) {
  const card = { name, typeLine, oracleText, keywords: [] as string[], manaCost: "{1}" };
  const g = grammarClauseRecords(card as never);
  expect(g.complete).toBe(true);
  return deriveCardTags(deriveInputOf(card as never, "x", name, g.records, undefined, g.readings)).abilities;
}

describe("a search-and-exile names its zones (#1311)", () => {
  test("Surgical Extraction (model): one exiled per searched zone, the graveyard one among them", () => {
    const { abilities } = deriveAbilities(surgical, "Surgical Extraction", { 2: SURGICAL_TEXT });
    expect(zonesOf(abilities).sort()).toEqual(["graveyard", "hand", "library"]);
  });

  test("Eradicate (grammar): the creature stays, and the cards named gain graveyard and hand beside library", () => {
    const abilities = grammarTags("Eradicate", "Sorcery", "Exile target nonblack creature. Search its controller's graveyard, hand, and library for all cards with the same name as that creature and exile them. Then that player shuffles.");
    expect(zonesOf(abilities).sort()).toEqual(["battlefield", "graveyard", "hand", "library"]);
  });

  test("Slaughter Games (model): one stored search with no origin takes its zones from the printed 'graveyard, hand, and library'", () => {
    const { abilities } = deriveAbilities([{ id: 2, abilityType: "spell", actions: [
      { verb: "search", object: "any number of cards with the chosen nonland card name", fromZone: null, toZone: null, amount: null, optional: false },
      { verb: "exile", object: "cards found this way", fromZone: null, toZone: null, amount: null, optional: false },
      { verb: "shuffle", object: "target opponent's library", fromZone: null, toZone: null, amount: null, optional: false }] }] as never,
    "Slaughter Games", { 2: "Search target opponent's graveyard, hand, and library for any number of cards with the chosen name and exile them. Then that player shuffles." });
    expect(zonesOf(abilities).sort()).toEqual(["graveyard", "hand", "library"]);
    // "target opponent's graveyard, hand, and library" is the opponent's on every half; "its owner's" (Surgical Extraction) can be yours and stays any.
    expect(abilities.flatMap((a) => a.emits ?? []).filter((e) => e.verb === "exiled").every((e) => e.subject.control === "opp")).toBe(true);
  });

  test("Surgical Extraction's 'its owner's' halves stay any: the owner can be you", () => {
    const { abilities } = deriveAbilities(surgical, "Surgical Extraction", { 2: SURGICAL_TEXT });
    expect(abilities.flatMap((a) => a.emits ?? []).filter((e) => e.verb === "exiled").every((e) => e.subject.control === "any")).toBe(true);
  });

  test("Cranial Extraction (model): the exile's own wording ('the chosen nonland card name') is not the search's, still the cards found", () => {
    const { abilities } = deriveAbilities([{ id: 1, abilityType: "spell", actions: [
      { verb: "search", object: "all cards with the chosen nonland card name", fromZone: "graveyard", toZone: null },
      { verb: "search", object: "all cards with the chosen nonland card name", fromZone: "hand", toZone: null },
      { verb: "search", object: "all cards with the chosen nonland card name", fromZone: "library", toZone: null },
      { verb: "exile", object: "all cards with the chosen nonland card name", fromZone: null, toZone: "exile" },
      { verb: "shuffle", object: "target player's library", fromZone: null, toZone: null }] }] as never,
    "Cranial Extraction", { 1: "Search target player's graveyard, hand, and library for all cards with that name and exile them. Then that player shuffles." });
    expect(zonesOf(abilities).sort()).toEqual(["graveyard", "hand", "library"]);
  });

  test("Pick the Brain: 'that player's graveyard' is not YOUR graveyard though a delirium count names yours", () => {
    const { abilities } = deriveAbilities([{ id: 2, abilityType: "spell", actions: [
      { verb: "search", object: "target player's graveyard, hand, and library for any number of cards with the same name as the exiled card", fromZone: null, toZone: null, amount: null, optional: false },
      { verb: "exile", object: "those cards", fromZone: null, toZone: null, amount: null, optional: false }] }] as never,
    "Pick the Brain", { 2: "Delirium — If there are four or more card types among cards in your graveyard, search that player's graveyard, hand, and library for any number of cards with the same name as the exiled card, exile those cards, then that player shuffles." });
    const yard = abilities.flatMap((a) => a.emits ?? []).filter((e) => e.verb === "exiled" && e.subject.fromZone === "graveyard");
    expect(yard.length).toBe(1);
    expect(yard[0]!.subject.owner).toBeUndefined();
  });

  test("a library-only search-and-exile gains no graveyard emit (Neverending Torment)", () => {
    const { abilities } = deriveAbilities([{ id: 1, abilityType: "spell", actions: [
      { verb: "search", object: "target player's library", fromZone: "library", toZone: null, amount: null, optional: false },
      { verb: "exile", object: "X cards", fromZone: "library", toZone: "exile", amount: null, optional: false },
      { verb: "shuffle", object: "target player's library", fromZone: null, toZone: null, amount: null, optional: false }] }] as never,
    "Neverending Torment", { 1: "Search target player's library for X cards, where X is the number of cards in your hand, and exile them. Then that player shuffles." });
    expect(zonesOf(abilities)).toEqual(["library"]);
  });

  test("a single-zone graveyard exile is unchanged (Bojuka Bog)", () => {
    const { abilities } = deriveAbilities([{ id: 2, abilityType: "triggered", trigger: { event: "enters", subject: "this land", control: "you" },
      actions: [{ verb: "exile", object: "target player's graveyard", fromZone: "graveyard", toZone: "exile", amount: null, optional: false }] }] as never,
    "Bojuka Bog", { 2: "When this land enters, exile target player's graveyard." });
    expect(zonesOf(abilities)).toEqual(["graveyard"]);
  });
});

describe("an exile whose object names a hand AND a graveyard is one emit per zone (#1311)", () => {
  test("Decree of Annihilation keeps battlefield, graveyard and hand", () => {
    const abilities = grammarTags("Decree of Annihilation", "Sorcery", "Exile all artifacts, creatures, and lands from the battlefield, all cards from all graveyards, and all cards from all hands.");
    expect(zonesOf(abilities).sort()).toEqual(["battlefield", "graveyard", "hand"]);
  });

  test("Identity Crisis (grammar): 'target player's hand and graveyard' is a hand emit and a graveyard emit, both the opponent's", () => {
    const abilities = grammarTags("Identity Crisis", "Sorcery", "Exile all cards from target player's hand and graveyard.");
    const es = abilities.flatMap((a) => a.emits ?? []).filter((e) => e.verb === "exiled");
    expect(es.map((e) => e.subject.fromZone).sort()).toEqual(["graveyard", "hand"]);
    expect(es.every((e) => e.subject.control === "opp" && e.subject.scope === "target")).toBe(true);
  });

  test("Thought Distortion (model): the typed class is kept on both halves", () => {
    const { abilities } = deriveAbilities([{ id: 2, abilityType: "spell", actions: [
      { verb: "exile", object: "all noncreature, nonland cards from that player's hand and graveyard", fromZone: null, toZone: null, amount: null, optional: false }] }] as never,
    "Thought Distortion", { 2: "Exile all noncreature, nonland cards from that player's hand and graveyard." });
    const es = abilities.flatMap((a) => a.emits ?? []).filter((e) => e.verb === "exiled");
    expect(es.map((e) => e.subject.fromZone).sort()).toEqual(["graveyard", "hand"]);
    expect(es[0]!.subject.notType).toEqual(es[1]!.subject.notType);
  });

  test("'graveyard or hand' is a choice and names no second emit (Memory Leak shape)", () => {
    const { abilities } = deriveAbilities([{ id: 1, abilityType: "spell", actions: [
      { verb: "exile", object: "a nonland card from that player's graveyard or hand", fromZone: null, toZone: null, amount: null, optional: false }] }] as never,
    "Test Leak", { 1: "You choose a nonland card from that player's graveyard or hand and exile it." });
    expect(abilities.flatMap((a) => a.emits ?? []).filter((e) => e.verb === "exiled").length).toBeLessThanOrEqual(1);
  });
});
