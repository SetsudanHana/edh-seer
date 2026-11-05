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

  test("Eradicate (model, the path its row ships on): the creature stays, and the cards named gain hand beside library (the copy was on the battlefield, CR 903.5b)", () => {
    const text = "Exile target nonblack creature. Search its controller's graveyard, hand, and library for all cards with the same name as that creature and exile them. Then that player shuffles.";
    const { abilities } = deriveAbilities([{ id: 1, abilityType: "spell", actions: [
      { verb: "exile", object: "target nonblack creature", fromZone: "battlefield", toZone: "exile", amount: null, optional: false },
      { verb: "search", object: "all cards with the same name as that creature", fromZone: "graveyard", toZone: null, amount: null, optional: false },
      { verb: "search", object: "all cards with the same name as that creature", fromZone: "hand", toZone: null, amount: null, optional: false },
      { verb: "search", object: "all cards with the same name as that creature", fromZone: "library", toZone: null, amount: null, optional: false },
      { verb: "exile", object: "all cards with the same name as that creature", fromZone: null, toZone: "exile", amount: null, optional: false },
      { verb: "shuffle", object: "that player's library", fromZone: null, toZone: null, amount: null, optional: false }] }] as never, "Eradicate", { 1: text }, undefined, text);
    expect(zonesOf(abilities).sort()).toEqual(["battlefield", "hand", "library"]);
  });

  test("Eradicate (grammar, the source its row derives from today): the same hand and library, opp", () => {
    const abilities = grammarTags("Eradicate", "Sorcery", "Exile target nonblack creature. Search its controller's graveyard, hand, and library for all cards with the same name as that creature and exile them. Then that player shuffles.");
    expect(zonesOf(abilities).sort()).toEqual(["battlefield", "hand", "library"]);
    expect(abilities.flatMap((a) => a.emits ?? []).filter((e) => e.verb === "exiled" && e.subject.fromZone !== "battlefield").every((e) => e.subject.control === "opp")).toBe(true);
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

  test("Surgical Extraction's 'its owner's' halves are the opponent's (owner ruling 2026-11-05)", () => {
    const { abilities } = deriveAbilities(surgical, "Surgical Extraction", { 2: SURGICAL_TEXT });
    expect(abilities.flatMap((a) => a.emits ?? []).filter((e) => e.verb === "exiled").every((e) => e.subject.control === "opp")).toBe(true);
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

// ---- #1311 fix round: stored shapes copied from Mongo (`cardClauses.canonical`, DERIVE 453 run) ----
type Ab = ReturnType<typeof deriveAbilities>["abilities"];
const exiledEmits = (abilities: Ab) => abilities.flatMap((a) => a.emits ?? []).filter((e) => e.verb === "exiled");
const half = (abilities: Ab, zone: string) => exiledEmits(abilities).find((e) => e.subject.fromZone === zone);
const hateEffects = (abilities: Ab) => abilities.filter((a) => a.effect?.kind === "graveyard-hate");
const A = (verb: string, object: string, fromZone: string | null = null, toZone: string | null = null, extra: object = {}) => ({ verb, object, fromZone, toZone, amount: null, optional: false, ...extra });

describe("the owner ruling (2026-11-05): 'its owner's / its controller's / that player's' on a hate card is the opponent's", () => {
  const OWNER = "Choose target card in a graveyard other than a basic land card. Search its owner's graveyard, hand, and library for all cards with the same name as that card and exile them. Then that player shuffles.";
  const extirpate = [{ id: 2, abilityType: "spell", actions: [A("search", "all cards with the same name as target card", "graveyard"), A("search", "all cards with the same name as target card", "hand"), A("search", "all cards with the same name as target card", "library"), A("exile", "all cards with the same name as target card", null, "exile"), A("shuffle", "that player's library")] }] as never;
  test("Extirpate and Surgical Extraction print the same 'its owner's' and agree: opp on every half, the graveyard-hate effect opp", () => {
    const e = deriveAbilities(extirpate, "Extirpate", { 2: OWNER }, undefined, OWNER).abilities;
    const s = deriveAbilities(surgical, "Surgical Extraction", { 2: SURGICAL_TEXT }, undefined, SURGICAL_TEXT).abilities;
    for (const abilities of [e, s]) {
      expect(exiledEmits(abilities).map((x) => x.subject.control)).toEqual(["opp", "opp", "opp"]);
      expect(hateEffects(abilities).every((a) => a.effect?.subject?.control === "opp")).toBe(true);
    }
  });

  test("Quash (model): its controller's graveyard is the opponent's, and the hand half is not typed 'spell'", () => {
    const text = "Counter target instant or sorcery spell. Search its controller's graveyard, hand, and library for all cards with the same name as that spell and exile them. Then that player shuffles.";
    const { abilities } = deriveAbilities([{ id: 1, abilityType: "spell", actions: [A("counter-spell", "target instant or sorcery spell"), A("search", "all cards with the same name as that spell", "graveyard"), A("search", "all cards with the same name as that spell", "hand"), A("search", "all cards with the same name as that spell", "library"), A("exile", "all cards with the same name as that spell"), A("shuffle", "that player's library")] }] as never, "Quash", { 1: text }, undefined, text);
    expect(exiledEmits(abilities).map((e) => e.subject.fromZone).sort()).toEqual(["graveyard", "hand", "library"]);
    expect(exiledEmits(abilities).every((e) => e.subject.control === "opp")).toBe(true);
    expect(half(abilities, "hand")!.subject.type).toBeUndefined();
  });

  test("Invasive Surgery: the graveyard searched is the spell's controller's, never YOUR graveyard (its delirium count names yours)", () => {
    const text = "Delirium — If there are four or more card types among cards in your graveyard, search the graveyard, hand, and library of that spell's controller for any number of cards with the same name as that spell, exile those cards, then that player shuffles.";
    const oracle = `Counter target sorcery spell.\n${text}`;
    const { abilities } = deriveAbilities([{ id: 1, abilityType: "spell", actions: [A("counter-spell", "target sorcery spell")] },
      { id: 2, abilityType: "spell", trigger: { event: "state", subject: "four or more card types among cards in your graveyard", control: "you" }, actions: [A("search", "any number of cards with the same name as that spell", "graveyard"), A("search", "any number of cards with the same name as that spell", "hand"), A("search", "any number of cards with the same name as that spell", "library"), A("exile", "those cards", null, "exile"), A("shuffle", "that player's library")] }] as never,
    "Invasive Surgery", { 1: "Counter target sorcery spell.", 2: text }, undefined, oracle);
    const yard = half(abilities, "graveyard")!;
    expect(yard.subject.control).toBe("opp");
    expect(yard.subject.owner).toBeUndefined();
    expect(abilities.flatMap((a) => a.emits ?? []).filter((e) => e.subject.zone === "graveyard" || e.subject.fromZone === "graveyard").every((e) => e.subject.control !== "you")).toBe(true);
    expect(hateEffects(abilities).every((a) => a.effect?.subject?.control === "opp")).toBe(true);
  });
});

describe("'that player' resolves to the clause's earlier opponent / target player / player dealt damage (#1311)", () => {
  const CASES: Array<[string, string, object[], string]> = [
    ["Lobotomy", "Target player reveals their hand, then you choose a card other than a basic land card from it. Search that player's graveyard, hand, and library for all cards with the same name as the chosen card and exile them. Then that player shuffles.",
      [A("search", "that player's graveyard, hand, and library for all cards with the same name as the chosen card"), A("exile", "those cards"), A("shuffle", "that player's library")], "Search that player's graveyard, hand, and library for all cards with the same name as the chosen card and exile them. Then that player shuffles."],
    ["Kotose, the Silent Spider", "When Kotose enters, exile target card other than a basic land card from an opponent's graveyard. Search that player's graveyard, hand, and library for any number of cards with the same name as that card and exile them. Then that player shuffles.",
      [A("search", "that player's graveyard, hand, and library for any number of cards with the same name as that card"), A("exile", "cards found by that search", null, "exile"), A("shuffle", "that player's library")], "Search that player's graveyard, hand, and library for any number of cards with the same name as that card and exile them. Then that player shuffles."],
    ["Thought Hemorrhage", "Choose a nonland card name. Target player reveals their hand. Thought Hemorrhage deals 3 damage to that player for each card with the chosen name revealed this way. Search that player's graveyard, hand, and library for all cards with that name and exile them. Then that player shuffles.",
      [A("search", "target player's graveyard, hand, and library"), A("exile", "all cards with the chosen name"), A("shuffle", "target player's library")], "Search that player's graveyard, hand, and library for all cards with that name and exile them. Then that player shuffles."],
  ];
  for (const [name, oracle, actions, text] of CASES) {
    test(`${name}: every zone half is the opponent's`, () => {
      const { abilities } = deriveAbilities([{ id: 1, abilityType: "spell", actions }] as never, name, { 1: text }, undefined, oracle);
      const es = exiledEmits(abilities).filter((e) => e.subject.fromZone !== "battlefield");
      expect(es.length).toBeGreaterThanOrEqual(2);
      expect(es.every((e) => e.subject.control === "opp" && e.subject.owner === undefined)).toBe(true);
    });
  }

  test("Reap Intellect: the search is the target opponent's", () => {
    const oracle = "Target opponent reveals their hand. You choose up to X nonland cards from it and exile them. For each card exiled this way, search that player's graveyard, hand, and library for any number of cards with the same name as that card and exile them. Then that player shuffles.";
    const text = "For each card exiled this way, search that player's graveyard, hand, and library for any number of cards with the same name as that card and exile them. Then that player shuffles.";
    const { abilities } = deriveAbilities([{ id: 1, abilityType: "spell", actions: [A("search", "target player's graveyard, hand, and library for any number of cards with the same name as each card exiled this way"), A("exile", "cards found this way", null, "exile"), A("shuffle", "that player's library")] }] as never, "Reap Intellect", { 1: text }, undefined, oracle);
    const es = exiledEmits(abilities);
    expect(es.map((e) => e.subject.fromZone).sort()).toEqual(["library", "hand"].sort());
    expect(es.every((e) => e.subject.control === "opp")).toBe(true);
  });

  test("Shimian Specter: the player it dealt combat damage to", () => {
    const oracle = "Flying\nWhenever this creature deals combat damage to a player, that player reveals their hand. You choose a nonland card from it. Search that player's graveyard, hand, and library for all cards with the same name as that card and exile them. Then that player shuffles.";
    const text = "Whenever this creature deals combat damage to a player, that player reveals their hand. You choose a nonland card from it. Search that player's graveyard, hand, and library for all cards with the same name as that card and exile them. Then that player shuffles.";
    const { abilities } = deriveAbilities([{ id: 2, abilityType: "triggered", trigger: { event: "damage-dealt", subject: "this creature", control: "you" }, actions: [A("search", "that player's graveyard, hand, and library for all cards with the same name as the chosen card"), A("exile", "all cards with the same name", null, "exile"), A("shuffle", "that player's library")] }] as never, "Shimian Specter", { 2: text }, undefined, oracle);
    expect(exiledEmits(abilities).length).toBeGreaterThanOrEqual(2);
    expect(exiledEmits(abilities).every((e) => e.subject.control === "opp")).toBe(true);
  });

  test("Thought Distortion: both halves of 'that player's hand and graveyard' are the opponent's", () => {
    const oracle = "This spell can't be countered.\nTarget opponent reveals their hand. Exile all noncreature, nonland cards from that player's hand and graveyard.";
    const { abilities } = deriveAbilities([{ id: 2, abilityType: "spell", actions: [A("exile", "all noncreature, nonland cards from that player's hand and graveyard")] }] as never,
    "Thought Distortion", { 2: "Target opponent reveals their hand. Exile all noncreature, nonland cards from that player's hand and graveyard." }, undefined, oracle);
    const es = exiledEmits(abilities);
    expect(es.map((e) => e.subject.fromZone).sort()).toEqual(["graveyard", "hand"]);
    expect(es.every((e) => e.subject.control === "opp")).toBe(true);
  });

  test("a 'that player' with no player named before it stays any", () => {
    const { abilities } = deriveAbilities([{ id: 1, abilityType: "spell", actions: [A("exile", "all cards from that player's hand and graveyard")] }] as never,
    "Test Mystery", { 1: "Exile all cards from that player's hand and graveyard." }, undefined, "Exile all cards from that player's hand and graveyard.");
    expect(exiledEmits(abilities).every((e) => e.subject.control === "any")).toBe(true);
  });
});

describe("the amount survives the opponent reading (#1311)", () => {
  test("Ancient Vendetta: 'up to four' on all three halves", () => {
    const text = "Search target opponent's graveyard, hand, and library for up to four cards with that name and exile them. Then that player shuffles.";
    const { abilities } = deriveAbilities([{ id: 1, abilityType: "spell", actions: [A("search", "up to four cards with a chosen name", "graveyard"), A("search", "up to four cards with a chosen name", "hand"), A("search", "up to four cards with a chosen name", "library"), A("exile", "those cards"), A("shuffle", "target opponent's library")] }] as never,
    "Ancient Vendetta", { 1: text }, undefined, `Choose a card name. ${text}`);
    const halves = abilities.filter((a) => (a.emits ?? []).some((e) => e.verb === "exiled"));
    expect(halves.flatMap((a) => (a.emits ?? []).filter((e) => e.verb === "exiled").map((e) => e.subject.fromZone)).sort()).toEqual(["graveyard", "hand", "library"]);
    expect(halves.length).toBe(3);
    for (const a of halves) {
      expect(a.emits!.every((e) => e.subject.control === "opp" || e.verb !== "exiled")).toBe(true);
      expect(a.amount).toBe("up to four");
      expect(a.count).toEqual({ floor: 0, ceiling: 4 });
    }
  });
});

describe("a card the search found on the battlefield or in a hand has no graveyard copy (CR 903.5b, #1311)", () => {
  const zonesOfHalves = (abilities: Ab) => exiledEmits(abilities).filter((e) => e.subject.fromZone !== "battlefield").map((e) => e.subject.fromZone).sort();
  test("Crumble to Dust (battlefield land): hand and library only", () => {
    const oracle = "Exile target nonbasic land. Search its controller's graveyard, hand, and library for any number of cards with the same name as that land and exile them. Then that player shuffles.";
    const { abilities } = deriveAbilities([{ id: 2, abilityType: "spell", actions: [A("exile", "target nonbasic land", "battlefield", "exile"), A("search", "cards with the same name as that land", "graveyard"), A("search", "cards with the same name as that land", "hand"), A("search", "cards with the same name as that land", "library"), A("exile", "cards found by search", null, "exile"), A("shuffle", "that player's library")] }] as never, "Crumble to Dust", { 2: oracle }, undefined, oracle);
    expect(zonesOfHalves(abilities)).toEqual(["hand", "library"]);
  });
  test("Eradicate (model, battlefield creature): hand and library only", () => {
    const oracle = "Exile target nonblack creature. Search its controller's graveyard, hand, and library for all cards with the same name as that creature and exile them. Then that player shuffles.";
    const { abilities } = deriveAbilities([{ id: 1, abilityType: "spell", actions: [A("exile", "target nonblack creature", "battlefield", "exile"), A("search", "all cards with the same name as that creature", "graveyard"), A("search", "all cards with the same name as that creature", "hand"), A("search", "all cards with the same name as that creature", "library"), A("exile", "all cards with the same name as that creature", null, "exile"), A("shuffle", "that player's library")] }] as never, "Eradicate", { 1: oracle }, undefined, oracle);
    expect(zonesOfHalves(abilities)).toEqual(["hand", "library"]);
  });
  test("Lobotomy (the chosen card came from a hand): hand and library only", () => {
    const oracle = "Target player reveals their hand, then you choose a card other than a basic land card from it. Search that player's graveyard, hand, and library for all cards with the same name as the chosen card and exile them. Then that player shuffles.";
    const { abilities } = deriveAbilities([{ id: 1, abilityType: "spell", actions: [A("search", "that player's graveyard, hand, and library for all cards with the same name as the chosen card"), A("exile", "those cards"), A("shuffle", "that player's library")] }] as never, "Lobotomy", { 1: "Search that player's graveyard, hand, and library for all cards with the same name as the chosen card and exile them. Then that player shuffles." }, undefined, oracle);
    expect(zonesOfHalves(abilities)).toEqual(["hand", "library"]);
  });
  test("Pick the Brain (delirium rider, the exiled card came from a hand): hand and library only", () => {
    const oracle = "Target opponent reveals their hand. You choose a nonland card from it and exile that card.\nDelirium — If there are four or more card types among cards in your graveyard, search that player's graveyard, hand, and library for any number of cards with the same name as the exiled card, exile those cards, then that player shuffles.";
    const text = "Delirium — If there are four or more card types among cards in your graveyard, search that player's graveyard, hand, and library for any number of cards with the same name as the exiled card, exile those cards, then that player shuffles.";
    const { abilities } = deriveAbilities([{ id: 2, abilityType: "spell", actions: [A("search", "target player's graveyard, hand, and library for any number of cards with the same name as the exiled card"), A("exile", "those cards"), A("shuffle", "target player's library")] }] as never, "Pick the Brain", { 2: text }, undefined, oracle);
    expect(zonesOfHalves(abilities)).toEqual(["hand", "library"]);
  });
  test("a name read off a graveyard card, a chosen name and a countered spell keep the graveyard half", () => {
    const quash = "Counter target instant or sorcery spell. Search its controller's graveyard, hand, and library for all cards with the same name as that spell and exile them. Then that player shuffles.";
    const q = deriveAbilities([{ id: 1, abilityType: "spell", actions: [A("counter-spell", "target instant or sorcery spell"), A("search", "all cards with the same name as that spell", "graveyard"), A("search", "all cards with the same name as that spell", "hand"), A("search", "all cards with the same name as that spell", "library"), A("exile", "all cards with the same name as that spell"), A("shuffle", "that player's library")] }] as never, "Quash", { 1: quash }, undefined, quash).abilities;
    expect(zonesOfHalves(q)).toEqual(["graveyard", "hand", "library"]);
    const lost = "Choose a nonartifact, nonland card name. Search target player's graveyard, hand, and library for any number of cards with that name and exile them. That player shuffles, then draws a card for each card exiled from their hand this way.";
    const l = deriveAbilities([{ id: 1, abilityType: "spell", actions: [A("search", "any number of cards with the chosen name", "graveyard"), A("search", "any number of cards with the chosen name", "hand"), A("search", "any number of cards with the chosen name", "library"), A("exile", "those cards")] }] as never, "Lost Legacy", { 1: lost }, undefined, lost).abilities;
    expect(zonesOfHalves(l)).toEqual(["graveyard", "hand", "library"]);
    const s = deriveAbilities(surgical, "Surgical Extraction", { 2: SURGICAL_TEXT }, undefined, `Split second\n${SURGICAL_TEXT}`).abilities;
    expect(zonesOfHalves(s)).toEqual(["graveyard", "hand", "library"]);
  });
});
