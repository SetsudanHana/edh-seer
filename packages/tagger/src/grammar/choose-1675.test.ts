import { expect, test } from "vitest";
import { grammarClauseRecords } from "./clause-record.js";
import { parseActions, unreadPhrases } from "./action.js";
import { deriveCardTags } from "../derive/derive.js";
import { deriveInputOf } from "../derive-input.js";

// #1675: "choose <target>" names the targets and the verb comes in the next sentence, on "it", "them", "the chosen creatures" or "each of them"; and a modal rider. Every oracle text below is the corpus's own
// (Mongo `cards`, 2026-11-19).
const card = (name: string, typeLine: string, oracleText: string, keywords: string[] = []) => ({ name, typeLine, oracleText, keywords });

const DATHON = card("Dathon, His Heart Open", "Legendary Creature — Tamarian Officer", "Whenever you cast an enchantment spell, draw a card. If it's a Saga spell, Dathon deals 2 damage to each opponent.\n{2}: Choose a counter on target enchantment you control. Put another counter of that kind on it. Activate only as a sorcery.");
const DOMINION = card("Dominion Infiltration", "Sorcery", "Choose X target creatures your opponents control. For each of them, create a token that's a copy of that creature, except it has changeling. Those tokens gain haste. Exile those tokens at the beginning of the next end step. (They're every creature type.)");
const MCCOY = card("Dr. Leonard \"Bones\" McCoy", "Legendary Creature — Human Doctor", "Flash\nWhen Dr. McCoy enters, choose one —\n• Return target non-Doctor permanent card from your graveyard to your hand.\n• Choose up to one other target creature. When it dies this turn, return that card to the battlefield under its owner's control with a +1/+1 counter on it at the beginning of the next end step.", ["Flash"]);
const TPRING = card("T'Pring, Never Parted", "Legendary Creature — Vulcan Citizen", "Kal-if-fee — When T'Pring enters, choose another target creature you control and target creature an opponent controls. You may have the chosen creatures fight each other. Whenever a creature that fought this way dies this turn, you draw a card.", ["Fight", "Kal-if-fee"]);
const TUVOK = card("Tuvok, Chief Tactical Officer", "Legendary Creature — Vulcan Officer", "Flash\nWhen Tuvok enters during the declare attackers step, choose up to two target attacking creatures. For each of them, you may reselect which player or permanent that creature is attacking. (A creature can't attack its controller.)", ["Flash"]);
const KANG = card("Kang, Suspicious Captain", "Legendary Creature — Klingon Warrior Officer", "When Kang enters, choose target creature an opponent controls. Kang and that creature are goaded for as long as you control Kang. (They attack each combat if able and attack a player other than you if able.)\nWhenever one or more goaded creatures attack, put a +1/+1 counter on target creature you control.", ["Goad"]);
const CHEKOV = card("Ensign Pavel Chekov", "Legendary Creature — Human Pilot", "Strange new worlds — When Ensign Chekov enters, each opponent exiles the top X cards of their library, where X is the number of differently named lands you control. For each opponent, choose a land card that player owns exiled this way. You may play the chosen cards for as long as they remain exiled.", ["Strange new worlds"]);
const OVERRIDE = card("Collective Override", "Instant", "Choose one. If you control a commander as you cast this spell, you may choose both instead.\n• Create a 1/1 colorless Borg artifact creature token for each attacking creature.\n• Draw a card for each attacking creature.");
const CHEKOV_FP = card("Pavel Chekov, First Posting", "Legendary Creature — Human Pilot", "If you would draw a card, you may instead choose land or nonland and reveal cards from the top of your library until you reveal a card of the chosen kind. Put that card into your hand and put all other cards revealed this way on the bottom of your library in a random order.");

const CHIRA = card("Chira, All In", "Legendary Creature — Human Rogue", "Whenever you discard one or more cards at random, select one or more targets at random, choose one or more modes at random, flip one or more coins, or roll one or more dice, put a +1/+1 counter on Chira and create a tapped Treasure token.", ["Treasure"]);

const actionsOf = (c: ReturnType<typeof card>) => grammarClauseRecords(c).records.flatMap((r) => r.actions ?? []);

test("a modal rider 'you may choose both instead' is a mode-count rider, not an action (Collective Override)", () => {
  const g = grammarClauseRecords(OVERRIDE);
  expect(g.blocker).toBeUndefined();
  expect(g.complete).toBe(true);
  // the modes keep their own readings, the intro and its rider record no action
  expect(g.records.flatMap((r) => (r.actions ?? []).map((a) => a.verb))).toEqual(expect.arrayContaining(["create", "draw"]));
  expect(g.records.flatMap((r) => (r.actions ?? []).map((a) => a.verb))).not.toContain("other");
  // the same rider with the other printed conditions (Jeska's Will, See Double, Prophetic Titan, the teamwork cards)
  for (const rider of ["If you control a commander as you cast this spell, you may choose both instead.", "If an opponent has eight or more cards in their graveyard, you may choose both instead.", "If this spell was cast using teamwork, choose both instead.", "If you control a commander, you may choose both instead."]) {
    expect(unreadPhrases(rider, "spell"), rider).toEqual([]);
  }
  // a rider with no modal intro before it is an unread phrase still
  expect(unreadPhrases("you may choose both instead", "spell")).toEqual(["you may choose both instead"]);
});

test("'Kang and that creature are goaded' is a goad of the card and a goad of the chosen target (Kang, Suspicious Captain)", () => {
  const g = grammarClauseRecords(KANG);
  expect(g.blocker).toBeUndefined();
  expect(g.complete).toBe(true);
  const goads = actionsOf(KANG).filter((a) => a.verb === "goad");
  expect(goads.map((a) => a.object)).toEqual(["this", "target creature an opponent controls"]);
  const tags = deriveCardTags(deriveInputOf(KANG as never, "x", KANG.name, g.records, undefined, g.readings));
  expect(JSON.stringify(tags.abilities)).toContain("goad");
});

test("'Choose X target creatures. For each of them, create a token that's a copy of that creature' keeps the targets in the copy (Dominion Infiltration)", () => {
  const g = grammarClauseRecords(DOMINION);
  expect(g.blocker).toBeUndefined();
  expect(g.complete).toBe(true);
  const [create] = actionsOf(DOMINION);
  expect(create).toMatchObject({ verb: "create" });
  expect(create!.object).toContain("each of X target creatures your opponents control");
  expect(create!.object).toContain("except it has changeling");
  // X targets make X copies: the amount is the X paid, and the copy is of OPPONENTS' creatures only (the matcher refuses its pairs with deck-mates' own enters triggers on that control)
  expect(create!.amount).toBe("X");
  const tags = deriveCardTags(deriveInputOf(DOMINION as never, "x", DOMINION.name, g.records, undefined, g.readings));
  const make = tags.abilities.find((a) => a.effect.kind === "token-generation");
  expect(make?.effect.subject?.copyOf).toMatchObject({ type: "creature", control: "opp" });
  expect(make).toMatchObject({ amount: "X", count: { floor: 0, ceiling: null, scalesWith: "mana" } });
});

test("T'Pring reads completely: the fight, and the draw behind a trigger no engine event carries (Whenever a creature that fought this way dies this turn)", () => {
  const g = grammarClauseRecords(TPRING);
  expect(g.blocker).toBeUndefined();
  expect(g.complete).toBe(true);
  expect(actionsOf(TPRING).map((a) => a.verb)).toEqual(["fight", "draw"]);
  const tags = deriveCardTags(deriveInputOf(TPRING as never, "x", TPRING.name, g.records, undefined, g.readings));
  // "that fought this way ... this turn" is a narrowing nothing checks: the draw claims no trigger, as every unread narrowing does
  expect(tags.unknownTriggers).toEqual(["narrowing:dies"]);
});

test("'You may have the chosen creatures fight each other' after two targets is a fight between them (T'Pring, Never Parted)", () => {
  const read = unreadPhrases("choose another target creature you control and target creature an opponent controls. You may have the chosen creatures fight each other.", "triggered");
  expect(read).toEqual([]);
  const [fight] = parseActions("choose another target creature you control and target creature an opponent controls. You may have the chosen creatures fight each other.", "triggered");
  expect(fight).toMatchObject({ verb: "fight", optional: true });
  expect(fight!.text).toBe("another target creature you control and target creature an opponent controls");
  // anything else said of two chosen targets stays unread: "it" does not say which
  expect(unreadPhrases("choose another target creature you control and target creature an opponent controls. Destroy the chosen creatures.", "triggered")).not.toEqual([]);
  expect(unreadPhrases("choose target creature you control and target creature an opponent controls. Draw a card.", "triggered")).not.toEqual([]);
});

test("'Choose a counter on target X. Put another counter of that kind on it' puts a counter of no named kind on the target (Dathon)", () => {
  const g = grammarClauseRecords(DATHON);
  expect(g.blocker).toBeUndefined();
  expect(g.complete).toBe(true);
  const add = actionsOf(DATHON).find((a) => a.verb === "add-counter");
  expect(add).toMatchObject({ verb: "add-counter", object: "target enchantment you control" });
  // nothing refers back to the chosen counter: unread
  expect(unreadPhrases("choose a counter on target enchantment you control. Draw a card.", "activated")).not.toEqual([]);
});

test("'For each of them, you may reselect which player or permanent that creature is attacking' records the reselection, claiming nothing (Tuvok)", () => {
  const g = grammarClauseRecords(TUVOK);
  expect(g.blocker).toBeUndefined();
  expect(g.complete).toBe(true);
  const other = actionsOf(TUVOK).find((a) => a.verb === "other");
  expect(other?.object).toContain("target attacking creatures");
  expect(other?.optional).toBe(true);
  // not a control change (Misleading Signpost's stored reading is a gain-control)
  expect(actionsOf(TUVOK).map((a) => a.verb)).not.toContain("gain-control");
});

test("'choose a land card that player owns exiled this way ... play the chosen cards' is a play of those cards (Ensign Pavel Chekov)", () => {
  const g = grammarClauseRecords(CHEKOV);
  expect(g.blocker).toBeUndefined();
  expect(g.complete).toBe(true);
  expect(actionsOf(CHEKOV).map((a) => [a.verb, a.object])).toEqual([["exile", "the top X cards of each opponent's library"], ["play", "land cards exiled this way"]]);
});

test("a delayed trigger that names the chosen creature stays a blocker (McCoy), as does a reveal-until draw replacement (Chekov, First Posting)", () => {
  expect(grammarClauseRecords(MCCOY).blocker).toMatchObject({ kind: "action", phrase: "choose up to one other target creature" });
  expect(grammarClauseRecords(CHEKOV_FP).complete).toBe(false);
});

test("a chosen creature that a LATER sentence's own delayed trigger names is still refused; one that does not is carried", () => {
  // "those tokens" in a delayed sentence is not the chosen creature: carried
  expect(unreadPhrases("Choose target creature you control. Tap it. Exile that token at the beginning of the next end step.", "spell")).toEqual([]);
  // "it" in a delayed sentence is: refused
  expect(unreadPhrases("Choose target creature you control. At the beginning of the next end step, sacrifice it.", "spell")).not.toEqual([]);
});

test("Chira's five-way trigger is read whole: a coin flip and a die roll are triggers, the random picks claim nothing (Chira, All In)", () => {
  const g = grammarClauseRecords(CHIRA);
  expect(g.blocker).toBeUndefined();
  expect(g.complete).toBe(true);
  expect(g.records[0]!.actions!.map((a) => a.verb)).toEqual(["add-counter", "create", "tap"]);
  const tags = deriveCardTags(deriveInputOf(CHIRA as never, "x", CHIRA.name, g.records, undefined, g.readings));
  // every printed alternative is a trigger of the card: the flip and the roll claim their events, the three "at random" ones are named and claim nothing
  const verbs = tags.abilities.flatMap((a) => a.trigger?.verbs ?? []);
  // exactly the flip and the roll, once per effect (counter, Treasure): the discard at random is REFUSED (a narrowed trigger claims nothing), and so are the two random picks
  expect(verbs).toEqual(["flip-coin", "dice-rolled", "flip-coin", "dice-rolled"]);
  expect(verbs).not.toContain("discarded");
  expect(tags.unknownTriggers).toEqual(["narrowing:discarded", "other", "other"]);
});

test("'mills twice X cards' keeps its amount, the stored '2X': Drown in Dreams keeps its mill magnitude through the modal-rider flip", () => {
  const DROWN = card("Drown in Dreams", "Instant", "Choose one. If you control a commander as you cast this spell, you may choose both instead.\n• Target player draws X cards.\n• Target player mills twice X cards.");
  const g = grammarClauseRecords(DROWN);
  expect(g.complete).toBe(true);
  expect(g.records.flatMap((r) => r.actions ?? []).map((a) => [a.verb, a.amount])).toEqual(expect.arrayContaining([["draw", "X"], ["mill", "2X"]]));
  expect(parseActions("Target player mills twice X cards.", "spell")[0]).toMatchObject({ verb: "mill", amount: "2X" });
});

test("a numeric multiple of X is still the X the player paid: Master of Keys and Drown in Dreams keep `scaling x-cost` and a mana-scaled count", () => {
  const KEYS = card("The Master of Keys", "Legendary Creature — Human Rogue", "Flying\nWhen The Master of Keys enters, put X +1/+1 counters on it and mill twice X cards.\nEach enchantment card in your graveyard has escape. The escape cost is equal to the card's mana cost plus exile three other cards from your graveyard.");
  const DROWN = card("Drown in Dreams", "Instant", "Choose one. If you control a commander as you cast this spell, you may choose both instead.\n• Target player draws X cards.\n• Target player mills twice X cards.");
  for (const c of [KEYS, DROWN]) {
    const g = grammarClauseRecords(c);
    const tags = deriveCardTags(deriveInputOf(c as never, "x", c.name, g.records, undefined, g.readings));
    const mill = tags.abilities.find((a) => a.emits?.some((e) => e.verb === "mill"));
    expect(mill, c.name).toMatchObject({ amount: "2X", effect: { scaling: "x-cost" }, count: { scalesWith: "mana" } });
  }
});
