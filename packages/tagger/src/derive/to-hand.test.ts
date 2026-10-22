/** `to-hand` (#1302, CR 121.5): cards put from the top of your own library into your hand without a search and without the word
 *  "draw". The action shapes below are the STORED clauses (Mongo `cardClauses.canonical`, 2026-10-22) and the grammar's records of the
 *  same cards, copied verbatim; the printed text is the card's Scryfall oracle text. */
import { describe, expect, test } from "vitest";
import type { Action, ClauseRecord } from "../canonicalize.js";
import { deriveAbilities, deriveCardTags } from "./derive.js";
import { deriveInputOf } from "../derive-input.js";
import { grammarClauseRecords } from "../grammar/clause-record.js";
import { actionEffectKind } from "./effect-kind.js";
import { toHandAmount, toHandChooses } from "./to-hand.js";

const put = (object: string, toZone: string, optional = false): Action =>
  ({ verb: "put", object, fromZone: "library", toZone, amount: null, optional } as unknown as Action);
const rec = (id: number, abilityType: ClauseRecord["abilityType"], actions: Action[], trigger?: ClauseRecord["trigger"]): ClauseRecord =>
  ({ id, abilityType, actions, ...(trigger ? { trigger } : {}) } as unknown as ClauseRecord);

const DARK_CONFIDANT = "At the beginning of your upkeep, reveal the top card of your library and put that card into your hand. You lose life equal to its mana value.";
const IMPULSE = "Look at the top four cards of your library. Put one of them into your hand and the rest on the bottom of your library in any order.";
const FACT_OR_FICTION = "Reveal the top five cards of your library. An opponent separates those cards into two piles. Put one pile into your hand and the other into your graveyard.";
const AD_NAUSEAM = "Reveal the top card of your library and put that card into your hand. You lose life equal to its mana value. You may repeat this process any number of times.";
const DIG = "Look at the top seven cards of your library. Put two of them into your hand and the rest on the bottom of your library in any order.";
const COILING = "When this creature enters, reveal the top card of your library. If it's a land card, put it onto the battlefield. Otherwise, put that card into your hand.";
const BROWSE = "Look at the top five cards of your library, put one of them into your hand, and exile the rest.";
const GOBLIN_GUIDE = "Whenever this creature attacks, defending player reveals the top card of their library. If it's a land card, that player puts it into their hand.";
const CULTIVATE = "Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.";
const GUIDED_PASSAGE = "Reveal the cards in your library. An opponent chooses from among them a creature card, a land card, and a noncreature, nonland card. You put the chosen cards into your hand. Then shuffle.";

describe("actionEffectKind: a put from the top of your library into your hand is to-hand", () => {
  test.each([
    ["Dark Confidant", "that card", DARK_CONFIDANT],
    ["Ad Nauseam", "that card", AD_NAUSEAM],
    ["Fact or Fiction", "one pile", FACT_OR_FICTION],
    ["Impulse", "one of the top four cards of your library", IMPULSE],
    ["Dig Through Time", "two of the top seven cards of your library", DIG],
    ["Coiling Oracle (the hand branch)", "that card", COILING],
    ["Browse", "one of them", BROWSE],
  ])("%s", (_name, object, text) => {
    expect(actionEffectKind(put(object, "hand"), text)).toBe("to-hand");
  });

  test("not a search: a search clause's put keeps null (the search ability claims it), and so does a put off the top", () => {
    expect(actionEffectKind(put("the other", "hand"), CULTIVATE)).toBeNull();
    // Guided Passage reveals the whole library: a tutor in all but the word, not the top.
    expect(actionEffectKind(put("chosen cards", "hand"), GUIDED_PASSAGE)).toBeNull();
  });

  test("not yours: another player's hand, and a card the opponent revealed from their own library", () => {
    expect(actionEffectKind(put("that card", "hand"), GOBLIN_GUIDE)).toBeNull();
    expect(actionEffectKind(put("the card target opponent revealed", "hand"),
      "At the beginning of your upkeep, you and target opponent each reveal the top card of your library. You each put the card you revealed into your hand.")).toBeNull();
    expect(actionEffectKind(put("the card you revealed", "hand"),
      "At the beginning of your upkeep, you and target opponent each reveal the top card of your library. You each put the card you revealed into your hand.")).toBe("to-hand");
  });

  test("not another zone: the same put to the graveyard or battlefield, a graveyard return, and a bounce keep their kinds", () => {
    expect(actionEffectKind(put("the rest", "graveyard"), IMPULSE)).toBe("mill");
    expect(actionEffectKind({ verb: "put", object: "target creature card", fromZone: "graveyard", toZone: "hand" } as Action, "Return target creature card from your graveyard to your hand.")).toBe("graveyard-recursion");
    expect(actionEffectKind({ verb: "put", object: "target creature", fromZone: "battlefield", toZone: "hand" } as Action, "Return target creature to its owner's hand.")).toBe("bounce");
  });

  test("a typed dig stays a search (owner ruling 2026-09-16): one action, one kind", () => {
    expect(actionEffectKind(put("an Elemental, Island, or Mountain card", "hand"),
      "Look at the top four cards of your library. You may reveal an Elemental, Island, or Mountain card from among them and put it into your hand.")).toBe("search");
  });
});

describe("amount and choice", () => {
  test.each([
    ["that card", "1"], ["it", "1"], ["the top card of your library", "1"], ["the other", "1"], ["one", "1"],
    ["one of the top three cards of your library", "1"], ["one of them", "1"], ["a historic card", "1"], ["a card from the top four cards of your library", "1"],
    ["two of the top seven cards of your library", "2"], ["two of them", "2"], ["up to two of the top x cards of your library", "2"],
    ["three of the top X cards of your library, where X is three plus the number of creatures in your party", "3"],
    ["one of the top x cards of your library", "1"], ["X cards from among them", "X"], ["that many cards from the top of your library", "X"],
    ["any number of the top five cards of your library", "X"],
    ["one pile", "pile"], ["one pile of the top four cards of your library", "pile"], ["the chosen pile", "pile"], ["the pile chosen by the defending player", "pile"],
    ["the rest", "all"], ["the rest of the top three cards of your library", "all"], ["all cards revealed this way", "all"], ["each of those cards", "all"], ["the revealed cards", "all"],
    ["one of them chosen at random", "1"],
  ])("amount of %j is %s", (object, amount) => {
    expect(toHandAmount(object)).toBe(amount);
  });

  test("chooses: a pick from a larger look, by anyone; not a pile, not everything, not the one card a reveal found", () => {
    expect(toHandChooses("one of the top four cards of your library", IMPULSE)).toBe(true);
    expect(toHandChooses("two of the top seven cards of your library", DIG)).toBe(true);
    expect(toHandChooses("one of them", BROWSE)).toBe(true);
    expect(toHandChooses("a historic card", "Look at the top five cards of your library. You may reveal a historic card from among them and put it into your hand.")).toBe(true);
    expect(toHandChooses("the other", "Look at the top two cards of your library. Exile one of them and put the other into your hand.")).toBe(true);
    expect(toHandChooses("that card", DARK_CONFIDANT)).toBe(false);
    expect(toHandChooses("that card", COILING)).toBe(false);
    expect(toHandChooses("one pile", FACT_OR_FICTION)).toBe(false);
    expect(toHandChooses("all cards revealed this way", "Reveal cards from the top of your library until you reveal a nonland card, then put all cards revealed this way into your hand.")).toBe(false);
    expect(toHandChooses("the rest", "Look at the top five cards of your library. For each card, put that card into your graveyard unless you pay 2 life. Then put the rest into your hand.")).toBe(false);
    // "Exile the top six cards" is not a look, and the reveal-until card is found by the rule, not picked.
    expect(toHandChooses("that card", "Choose a card name. Exile the top six cards of your library, then reveal cards from the top of your library until you reveal a card with the chosen name. Put that card into your hand and exile all other cards revealed this way.")).toBe(false);
    expect(toHandChooses("one of them chosen at random", "Search your library for three creature cards and reveal them. If you reveal three cards with different names, choose one of them at random and put that card into your hand.")).toBe(false);
    // The pick can be made in an earlier sentence and pointed back at: Nessian Wanderer, Karn (an opponent picks), Stargaze (twice X).
    expect(toHandChooses("that card", "Whenever an enchantment you control enters, look at the top three cards of your library. You may reveal a land card from among them and put that card into your hand. Put the rest on the bottom of your library in a random order.")).toBe(true);
    expect(toHandChooses("that card", "Reveal the top two cards of your library. An opponent chooses one of them. Put that card into your hand and exile the other with a silver counter on it.")).toBe(true);
    expect(toHandChooses("X cards from among them", "Look at twice X cards from the top of your library. Put X cards from among them into your hand and the rest into your graveyard. You lose X life.")).toBe(true);
    // A single card looked at is not a choice among cards.
    expect(toHandChooses("it", "Look at the top card of your library. If it's a creature card, you may reveal it and put it into your hand.")).toBe(false);
  });
});

describe("deriveAbilities on the stored clauses", () => {
  const derive = (records: ClauseRecord[], name: string, text: string) => deriveAbilities(records, name, { 1: text }, undefined, text);
  const toHand = (r: ReturnType<typeof deriveAbilities>) => r.abilities.filter((a) => a.effect.kind === "to-hand");

  test("Dark Confidant: one ability, amount 1, no choice, and nothing left unclaimed", () => {
    const r = derive([rec(1, "triggered", [put("that card", "hand")], { event: "beginning-of-upkeep", subject: "your upkeep" } as never)], "Dark Confidant", DARK_CONFIDANT);
    const [a] = toHand(r);
    expect(toHand(r)).toHaveLength(1);
    expect(a!.amount).toBe("1");
    expect(a!.chooses).toBeUndefined();
    expect(a!.effect.subject).toMatchObject({ control: "you" });
    expect(r.unclaimed).toEqual([]);
  });

  test("Ad Nauseam: a spell, amount 1, no choice", () => {
    const r = derive([rec(1, "spell", [put("that card", "hand")])], "Ad Nauseam", AD_NAUSEAM);
    expect(toHand(r).map((a) => [a.kind, a.amount, a.chooses])).toEqual([["on-cast", "1", undefined]]);
  });

  test("Fact or Fiction: a pile, no choice flag; the other pile to the graveyard is not to-hand", () => {
    const r = derive([rec(1, "spell", [put("one pile", "hand"), put("the other pile", "graveyard")])], "Fact or Fiction", FACT_OR_FICTION);
    expect(toHand(r).map((a) => [a.amount, a.chooses])).toEqual([["pile", undefined]]);
  });

  test("Impulse and Dig Through Time: a pick from a larger look, with the count that reaches the hand", () => {
    const imp = derive([rec(1, "spell", [put("one of the top four cards of your library", "hand"), put("the rest of the top four cards of your library", "library")])], "Impulse", IMPULSE);
    expect(toHand(imp).map((a) => [a.amount, a.chooses])).toEqual([["1", true]]);
    const dig = derive([rec(1, "spell", [put("two of the top seven cards of your library", "hand"), put("the rest of the top seven cards of your library", "library")])], "Dig Through Time", DIG);
    expect(toHand(dig).map((a) => [a.amount, a.chooses])).toEqual([["2", true]]);
  });

  test("Coiling Oracle: the hand branch is to-hand, the battlefield branch is an enters, not both", () => {
    const r = derive([rec(1, "triggered", [put("it", "battlefield"), put("that card", "hand")], { event: "enters", subject: "this creature" } as never)], "Coiling Oracle", COILING);
    expect(toHand(r)).toHaveLength(1);
    expect(r.abilities.filter((a) => a.effect.kind !== "to-hand").some((a) => (a.emits ?? []).some((e) => e.verb === "enters"))).toBe(true);
  });

  test("a tutor derives its search, never a to-hand (Cultivate)", () => {
    const r = derive([rec(1, "spell", [
      { verb: "search", object: "up to two basic land cards", fromZone: "library", toZone: null, amount: null, optional: false } as unknown as Action,
      put("one", "battlefield"), put("the other", "hand")])], "Cultivate", CULTIVATE);
    expect(toHand(r)).toEqual([]);
    expect(r.abilities.some((a) => a.effect.kind === "search")).toBe(true);
  });

  test("another player's put stays unclaimed (Goblin Guide)", () => {
    const r = derive([rec(1, "triggered", [put("that card", "hand")], { event: "attacks", subject: "this creature" } as never)], "Goblin Guide", GOBLIN_GUIDE);
    expect(toHand(r)).toEqual([]);
    expect(r.unclaimed).toHaveLength(1);
  });
});

describe("the printed-text grammar reads the same cards the same way (Mongo clauseSource: grammar, 2026-10-22)", () => {
  const fromGrammar = (name: string, typeLine: string, oracleText: string) => {
    const card = { name, typeLine, oracleText, keywords: [] as string[] };
    const g = grammarClauseRecords(card);
    expect(g.complete, `${name} is read completely`).toBe(true);
    return deriveCardTags(deriveInputOf(card as never, "x", name, g.records, undefined, g.readings));
  };
  test.each([
    ["Dark Confidant", "Creature \u2014 Human Wizard", DARK_CONFIDANT, "1", undefined],
    ["Impulse", "Instant", IMPULSE, "1", true],
    ["Dig Through Time", "Instant", DIG, "2", true],
  ])("%s", (name, typeLine, text, amount, chooses) => {
    const tags = fromGrammar(name, typeLine, text);
    const mine = tags.abilities.filter((a) => a.effect.kind === "to-hand");
    expect(mine.map((a) => [a.amount, a.chooses])).toEqual([[amount, chooses]]);
    expect((tags.unclaimed ?? []).filter((u) => u.toZone === "hand")).toEqual([]);
  });
  test("Coiling Oracle: the hand branch is to-hand and the land branch still enters", () => {
    const tags = fromGrammar("Coiling Oracle", "Creature \u2014 Snake Elf Druid", COILING);
    expect(tags.abilities.filter((a) => a.effect.kind === "to-hand")).toHaveLength(1);
  });
});
