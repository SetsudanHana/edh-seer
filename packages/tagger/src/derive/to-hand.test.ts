/** `to-hand` (#1302, CR 121.5): cards put from the top of your own library into your hand without a search and without the word
 *  "draw". The action shapes below are the STORED clauses (Mongo `cardClauses.canonical`, 2026-10-22) and the grammar's records of the
 *  same cards, copied verbatim; the printed text is the card's Scryfall oracle text. */
import { describe, expect, test } from "vitest";
import type { Action, ClauseRecord } from "../canonicalize.js";
import { deriveAbilities, deriveCardTags } from "./derive.js";
import { deriveInputOf } from "../derive-input.js";
import { grammarClauseRecords } from "../grammar/clause-record.js";
import { actionEffectKind, handFillRead } from "./effect-kind.js";
import { classIn, readToHand, toHandAmount, toHandChooses } from "./to-hand.js";

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

  test("a dig the card's TEXT types stays a search, whatever the stored object says (2026-09-16 and 2026-10-22; Archghoul of Thraben, Dryad Greenseeker, Nessian Wanderer, the #1302 review's misses)", () => {
    for (const [object, text] of [
      ["it", "Whenever this creature or another Zombie you control dies, look at the top card of your library. If it's a Zombie card, you may reveal it and put it into your hand. If you don't put the card into your hand, you may put it into your graveyard."],
      ["it", "{T}: Look at the top card of your library. If it's a land card, you may reveal it and put it into your hand."],
      ["that card", "Whenever an enchantment you control enters, look at the top three cards of your library. You may reveal a land card from among them and put that card into your hand. Put the rest on the bottom of your library in a random order."],
      ["the revealed card", "Look at the top three cards of your library. You may reveal a creature or land card from among them and put it into your hand. Put the rest on the bottom of your library in any order."],
      // The misses of the first typing: a comma inside the condition, a card of the chosen type, a shared type, a revealed-this-way class, a reveal-until class, a predicate pick.
      ["it", "Look at the top card of your library. If it's a noncreature, nonland card, you may reveal it and put it into your hand."],
      ["a card of the chosen type", "When this artifact enters and at the beginning of your upkeep, look at the top card of your library. If it's a card of the chosen type, you may reveal it and put it into your hand."],
      ["that card", "Whenever another permanent you control enters, look at the top card of your library. If it shares a card type with that permanent, you may reveal that card and put it into your hand."],
      ["it", "Scry 4, then you may reveal the top card of your library. If a planeswalker card is revealed this way, put it into your hand."],
      ["revealed cards of the chosen type", "Choose a creature type. Look at the top six cards of your library. You may reveal any number of cards of the chosen type from among them and put the revealed cards into your hand."],
      ["the revealed cards", "Look at the top six cards of your library. You may reveal up to two creature cards with mana value X or less from among them. Put the revealed cards into your hand, then shuffle."],
      ["that card", "Reveal cards from the top of your library until you reveal a creature card. Put that card into your hand and the rest on the bottom of your library in a random order."],
      ["that card", "Reveal cards from the top of your library until you reveal an Elf or Elemental card. Put that card into your hand and the rest on the bottom of your library in a random order."],
      ["that card", "Choose land or nonland. Reveal cards from the top of your library until you reveal a card of the chosen kind. Put that card into your hand and the rest on the bottom of your library in a random order."],
      ["a card of that type from among the revealed cards", "Reveal the top ten cards of your library. For each card type, you may put a card of that type from among the revealed cards into your hand."],
      ["a card that's exactly two colors", "Look at the top six cards of your library. You may reveal a card that's exactly two colors from among them and put it into your hand."],
    ] as const) expect(actionEffectKind(put(object, "hand"), text), text).toBe("search");
    // An untyped pick from among them, an "Otherwise" branch beside a typed condition, a "the rest" beside a typed sibling, and the "If you don't" fallback are not typed.
    expect(actionEffectKind(put("it", "hand"), "Look at the top three cards of your library. You may reveal a card from among them and put it into your hand.")).toBe("to-hand");
    expect(actionEffectKind(put("the rest", "hand"), "Look at the top five cards of your library. Put any number of permanent cards from among them onto the battlefield and the rest into your hand.")).toBe("to-hand");
    expect(actionEffectKind(put("it", "hand"), "Look at the top card of your library. If it's a land card, you may put it onto the battlefield tapped. If you don't, put it into your hand.")).toBe("to-hand");
  });

  test("the riders: named (reveal until a named card), netZero (a draw replaced, a swap), an opponent's pick is not yours", () => {
    const run = (object: string, text: string) => readToHand(object, text, false)!;
    expect(run("that card", "Choose a card name. Exile the top six cards of your library, then reveal cards from the top of your library until you reveal a card with the chosen name. Put that card into your hand and exile all other cards revealed this way.").named).toBe(true);
    expect(run("that card", "Choose a card name. Reveal cards from the top of your library until you reveal a card with that name, then put that card into your hand.").named).toBe(true);
    // Taking every hit of a name from a look is not a guaranteed find.
    expect(run("all of them with the chosen name", "Choose a card name other than a basic land card name. Reveal the top seven cards of your library and put all of them with that name into your hand. Exile the rest.").named).toBe(false);
    expect(run("that many cards from the top of your library", "Exile any number of cards from your hand face down. Put that many cards from the top of your library into your hand. Then look at the exiled cards and put them on top of your library in any order.").netZero).toBe(true);
    expect(run("one of those cards", "If you would draw a card, look at the top three cards of your library instead. Put one of those cards into your hand and the rest on the bottom of your library in any order.").netZero).toBe(true);
    expect(run("that card", DARK_CONFIDANT).netZero).toBe(false);
    // Karn: the opponent picks. Eye of Yawgmoth: "a number of cards", your pick.
    expect(run("that card", "Reveal the top two cards of your library. An opponent chooses one of them. Put that card into your hand and exile the other with a silver counter on it.").chooses).toBe(false);
    // Truth or Tale: the opponent picks the PILE, you pick the card from it (ruling 4 reads only YOUR one-of-N pick as the Impulse line): see the review block below.
    expect(run("one", "Reveal a number of cards from the top of your library equal to the sacrificed creature's power. Put one into your hand and exile the rest.").chooses).toBe(true);
    // Atraxa: one per card type, not one.
    expect(run("a card of that type from among the revealed cards", "Reveal the top ten cards of your library. For each card type, you may put a card of that type from among the revealed cards into your hand.").amount).toBe("X");
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
    // The pick can be made in an earlier sentence and pointed back at: Nessian Wanderer, Stargaze (twice X).
    expect(toHandChooses("that card", "Whenever an enchantment you control enters, look at the top three cards of your library. You may reveal a land card from among them and put that card into your hand. Put the rest on the bottom of your library in a random order.")).toBe(true);
    // ...but not when the OPPONENT picks (Karn, Scion of Urza, owner 2026-10-22): `chooses` means YOU choose.
    expect(toHandChooses("that card", "Reveal the top two cards of your library. An opponent chooses one of them. Put that card into your hand and exile the other with a silver counter on it.")).toBe(false);
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

/** THE REVIEW OF d7f7a5c5 (#1302): the count and the choice are read from the PICK SENTENCE when the clause holds the pick, not from the stored object's spelling. Real clause texts and real stored objects. */
describe("count and choice come from the pick sentence", () => {
  const read = (object: string, text: string, nth = 0) => handFillRead(put(object, "hand"), text, nth)!;
  const AUGUR = "When this creature enters, look at the top three cards of your library. You may reveal an instant or sorcery card from among them and put it into your hand. Put the rest on the bottom of your library in any order.";
  const KIORA = "Reveal the top four cards of your library. You may put a creature card and/or a land card from among them into your hand. Put the rest into your graveyard.";
  const LUMARETS = "Look at the top four cards of your library. You may reveal a creature or land card from among them and put it into your hand. If you gained life this turn, you may instead reveal two creature and/or land cards from among them and put them into your hand. Put the rest on the bottom of your library in a random order.";
  const MEMORIES = "Reveal the top five cards of your library. Put one of them into your hand. Then choose an opponent. They put one on the bottom of your library. Then you put one into your hand. Then they put one on the bottom of your library. Put the other into your hand.";

  test("YOUR one-of-N pick is chosen whatever the object says: Augur of Bolas, Boughside Wanderers, Calix, Break Out", () => {
    for (const [object, text] of [
      ["the revealed instant or sorcery card", AUGUR],
      ["the revealed permanent card", "When this creature enters, look at the top four cards of your library. You may reveal a permanent card from among them and put it into your hand. Put the rest on the bottom of your library in a random order."],
      ["enchantment card", "Look at the top four cards of your library. You may reveal an enchantment card from among them and put that card into your hand. Put the rest on the bottom of your library in a random order."],
      ["the revealed creature card not put onto the battlefield", "Look at the top six cards of your library. You may reveal a creature card from among them. If that card has mana value 2 or less, you may put it onto the battlefield and it gains haste until end of turn. If you didn't put the revealed card onto the battlefield this way, put it into your hand. Put the rest on the bottom of your library in a random order."],
    ] as const) {
      const r = read(object, text);
      expect([r.amount, r.chooses, r.typed !== undefined], text).toEqual(["1", true, true]);
    }
    expect(read("the revealed creature card not put onto the battlefield", "Look at the top six cards of your library. You may reveal a creature card from among them. If you didn't put the revealed card onto the battlefield this way, put it into your hand.").typed?.cls).toBe("creature");
  });

  test("two named classes are two cards: Kiora, Benefaction of Rhonas, In the Presence of Ages, Relentless Pursuit, Gift of the Gargantuan", () => {
    const r = read("a creature card and/or a land card from among them", KIORA);
    expect([r.amount, r.chooses, r.typed?.cls]).toEqual(["2", true, "creature or land"]);
    expect(read("a creature card and/or an enchantment card from among them", KIORA.replace("land", "enchantment")).amount).toBe("2");
    expect(read("revealed creature card(s) and/or land card(s)", "Look at the top four cards of your library. You may reveal a creature card and/or a land card from among them and put the revealed cards into your hand. Put the rest on the bottom of your library in any order.").amount).toBe("2");
  });

  test("a card's second alternative has its own count (Follow the Lumarets: one, or two instead)", () => {
    expect([read("revealed creature or land card", LUMARETS, 0).amount, read("revealed creature or land card", LUMARETS, 0).chooses]).toEqual(["1", true]);
    expect([read("revealed creature and/or land cards", LUMARETS, 1).amount, read("revealed creature and/or land cards", LUMARETS, 1).typed?.cls]).toEqual(["2", "creature or land"]);
  });

  test("three picks in a row are cards to hand, not one pick (Memories Returning: 3 of 5)", () => {
    for (const nth of [0, 1, 2]) { const r = read("one", MEMORIES, nth); expect([r.amount, r.chooses]).toEqual(["1", false]); }
  });

  test("'any number of' is all; a literal number is that number (Karumonix, Lead the Stampede, Forging the Anchor, You Meet in a Tavern, Fathom Trawl)", () => {
    for (const [object, text] of [
      ["revealed Rat cards", "When Karumonix enters, look at the top five cards of your library. You may reveal any number of Rat cards from among them and put the revealed cards into your hand. Put the rest on the bottom of your library in a random order."],
      ["the revealed creature cards", "Look at the top five cards of your library. You may reveal any number of creature cards from among them and put the revealed cards into your hand. Put the rest on the bottom of your library in any order."],
      ["creature cards from the top five cards of your library", "Form a Party \u2014 Look at the top five cards of your library. You may reveal any number of creature cards from among them and put them into your hand. Put the rest on the bottom of your library in a random order."],
    ] as const) expect(read(object, text).amount, text).toBe("all");
    expect(read("the nonland cards revealed this way", "Reveal cards from the top of your library until you reveal three nonland cards. Put the nonland cards revealed this way into your hand, then put the rest of the revealed cards on the bottom of your library in any order.").amount).toBe("3");
  });

  test("a predicate pick: 'with the chosen name' is not a class (Tamiyo), a list is one anyOf (Harper Recruiter), Niv-Mizzet's class is unreadable", () => {
    const TAMIYO = "Choose a nonland card name, then reveal the top four cards of your library. Put all cards with the chosen name from among them into your hand and the rest into your graveyard.";
    expect(read("all cards with the chosen name from among them", TAMIYO).typed).toBeUndefined();
    expect(actionEffectKind(put("all cards with the chosen name from among them", "hand"), TAMIYO)).toBe("to-hand");
    const HARPER = "Whenever this creature attacks, look at the top four cards of your library. You may reveal a Cleric card, a Rogue card, a Warrior card, and/or a Wizard card from among them and put those cards into your hand. Put the rest on the bottom of your library in a random order.";
    expect(read("revealed cards", HARPER).typed?.cls).toBe("Cleric, Rogue, Warrior, or Wizard");
    expect(read("revealed cards", HARPER).amount).toBe("4");
    const NIV = "When Niv-Mizzet enters, reveal the top ten cards of your library. For each color pair, choose a card that's exactly those colors from among them. Put the chosen cards into your hand and the rest on the bottom of your library in a random order.";
    expect(read("the chosen cards", NIV).typed?.cls).toBe("");
  });

  test("regression guards found by re-deriving: 'or' is one card, a reveal-until lists classes but takes one, X is no class, a plural pointer at 'each opponent chooses a card' is all, a fallback hand-put points back at its pick", () => {
    const FRONTIER = "When this creature enters, look at the top five cards of your library. You may reveal a Mount creature card or a Plains card from among them and put it into your hand. Put the rest on the bottom of your library in a random order.";
    expect(read("a Mount creature card or a Plains card", FRONTIER).amount).toBe("1");
    expect(read("a Mount creature card or a Plains card", FRONTIER).typed?.cls).toBe("Mount creature or Plains");
    const CHILD = "Reveal cards from the top of your library until you reveal a Doctor card, a card with doctor's companion, or a Vehicle card. Put that card into your hand and the rest on the bottom of your library in a random order.";
    expect(read("that card", CHILD).amount).toBe("1");
    const STARGAZE = "Look at twice X cards from the top of your library. Put X cards from among them into your hand and the rest into your graveyard. You lose X life.";
    expect([read("X cards from among them", STARGAZE).amount, read("X cards from among them", STARGAZE).typed]).toEqual(["X", undefined]);
    const MANIFOLD = "Reveal the top ten cards of your library. Starting with the next opponent in turn order, each opponent chooses a different nonland card from among them. Put the chosen cards into your hand and the rest on the bottom of your library in a random order.";
    expect(read("the chosen cards", MANIFOLD).amount).toBe("all");
    const SONGBIRDS = "Whenever enchanted creature attacks, reveal cards from the top of your library until you reveal an Aura card. You may put that card onto the battlefield. If you don't, put it into your hand. Put the rest on the bottom of your library in a random order.";
    expect([read("it", SONGBIRDS).typed?.cls, read("it", SONGBIRDS).amount]).toEqual(["Aura", "1"]);
    // Coiling Oracle's condition is not pointed back at: its "Otherwise" hand-put stays untyped.
    expect(read("that card", COILING).typed).toBeUndefined();
  });

  test("Truth or Tale: the opponent picks the PILE, you pick the card from it: your own one-of-N pick", () => {
    const r = read("a card from the chosen pile", "Reveal the top five cards of your library and separate them into two piles. An opponent chooses one of those piles. Put a card from the chosen pile into your hand, then put all other cards revealed this way on the bottom of your library in any order.");
    expect([r.amount, r.chooses]).toEqual(["1", true]);
    // ...while an opponent who picks the CARD (Karn, Scion of Urza) is not you.
    expect(read("that card", "Reveal the top two cards of your library. An opponent chooses one of them. Put that card into your hand and exile the other with a silver counter on it.").chooses).toBe(false);
  });

  test("the 'Otherwise' of an alternative is not a second pick in a row (Advice from the Fae keeps its pick)", () => {
    const ADVICE = "Look at the top five cards of your library. If you control more creatures than each other player, put two of those cards into your hand. Otherwise, put one of them into your hand. Then put the rest on the bottom of your library in any order.";
    expect(read("two of those cards", ADVICE, 0).chooses).toBe(true);
    expect(read("one of those cards", ADVICE, 1).chooses).toBe(true);
    // Without the alternative marker the same two sentences are a sequence.
    expect(read("one of those cards", ADVICE.replace("Otherwise, put", "Put"), 1).chooses).toBe(false);
  });
});

describe("no regex here is super-linear (CodeQL js/polynomial-redos; 40k characters, 200 ms)", () => {
  const SHAPES: [string, string][] = [
    ["spaces", " ".repeat(40000)], ["articles", "a ".repeat(20000)], ["cards", "card ".repeat(8000)], ["commas", "a card, ".repeat(5000)],
    ["until", "until you reveal " + "a ".repeat(20000)], ["opponent", "an opponent chooses " + "of ".repeat(13000)], ["if", "if it's a " + "x ".repeat(20000)],
    ["from among", "put a " + "creature ".repeat(4000) + "card from among"], ["revealed", "they revealed " + "x".repeat(40000)],
  ];
  const clause = (tail: string) => `Look at the top five cards of your library. ${tail} Put it into your hand.`;
  test.each(SHAPES)("%s", (_name, tail) => {
    const t0 = performance.now();
    classIn(tail); classIn(tail, false); readToHand("that card", clause(tail), false); readToHand("a creature card and/or a land card from among them", clause(tail), false, 1);
    toHandChooses("one", clause(tail));
    expect(performance.now() - t0).toBeLessThan(200);
  });
});
