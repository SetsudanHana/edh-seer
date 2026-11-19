import { expect, test } from "vitest";
import { grammarClauseRecords } from "./clause-record.js";
import { parseActions, unreadPhrases } from "./action.js";
import { isRestrictionSentence } from "./restriction.js";
import { selfAsTilde } from "./self-as-tilde.js";
import { deriveCardTags } from "../derive/derive.js";
import { deriveInputOf } from "../derive-input.js";

// #1678: one-off shapes the grammar blocked on. Every oracle text below is the corpus's own (Mongo `cards`, 2026-11-18).
const card = (name: string, typeLine: string, oracleText: string, keywords: string[] = []) => ({ name, typeLine, oracleText, keywords });

test("an anthem over a long list of subtypes reads, 'other' kept (Kirk, Man of Action)", () => {
  const [a] = parseActions("Other Officers, Artificers, Doctors, Pilots, Scientists, and Spacecraft creatures you control get +2/+2.", "static");
  expect(a).toMatchObject({ verb: "modify-pt", amount: "+2/+2", object: { control: "you", type: "creature", other: true, subtype: ["officer", "artificer", "doctor", "pilot", "scientist", "spacecraft"] } });
});

test("'During your turn, this X and creatures you control have ...' carries the condition on both readings (K'Vort-Class Raider)", () => {
  const r = parseActions("During your turn, this Spacecraft and creatures you control have hexproof.", "static");
  expect(r.map((a) => [a.verb, a.object?.self === true, a.condition])).toEqual([["grant-ability", true, "during your turn"], ["grant-ability", false, "during your turn"]]);
  expect(r[1]!.object).toMatchObject({ control: "you", type: "creature", scope: "all" });
});

test("a short name 'Grakk' is the card, never a class (Grakk the Pacifist)", () => {
  expect(selfAsTilde("Grakk can't attack or block.", "Grakk the Pacifist", "Legendary Creature — Orc")).toBe("~ can't attack or block.");
  // a class word that is also the first word of a "X the Y" name stays a class
  expect(selfAsTilde("Other Goblins you control get +1/+1, and each Goblin has haste.", "Goblin the Brave", "Legendary Creature — Goblin")).toBe("Other Goblins you control get +1/+1, and each Goblin has haste.");
  const g = grammarClauseRecords(card("Grakk the Pacifist", "Legendary Creature — Orc", "Grakk can't attack or block.\nWhenever you cast an Aura spell that targets a creature an opponent controls, draw a card. This ability triggers only once each turn."));
  expect(g.blocker).toBeUndefined();
  expect(g.complete).toBe(true);
});

test("ending the combat phase and removing from combat are recorded, claiming no event (Merciful Mandate, Nivea)", () => {
  expect(parseActions("you may end the combat phase", "spell")).toMatchObject([{ verb: "other", optional: true, text: "you may end the combat phase" }]);
  expect(parseActions("untap it and remove it from combat", "triggered").map((a) => a.verb)).toEqual(["untap", "other"]);
  expect(parseActions("remove it from combat", "triggered")[0]).toMatchObject({ verb: "other", text: "remove it from combat" });
  expect(grammarClauseRecords(card("Merciful Mandate", "Instant", "Untap all creatures you control. If it's a combat phase, you may end the combat phase. (Remove all attackers and blockers from combat. Exile all spells and abilities from the stack, including this spell.)")).complete).toBe(true);
  expect(grammarClauseRecords(card("Nivea, Beloved Battlemage", "Legendary Creature — Human Wizard Warrior", "Whenever a creature you control becomes blocked, you may untap it and remove it from combat.")).complete).toBe(true);
});

test("'it and up to one target creature you control phase out' is one phase-out each (U.S.S. Defiant)", () => {
  const r = parseActions("it and up to one target creature you control phase out", "triggered");
  expect(r.map((a) => a.verb)).toEqual(["phase-out", "phase-out"]);
  expect(r[0]!.object).toMatchObject({ ref: "sentence" });
  expect(r[1]!.object).toMatchObject({ control: "you", type: "creature", scope: "target" });
});

test("'remove them' after a count of counters on the card removes those counters from it (Rikala)", () => {
  const r = parseActions("Then if there are four or more tide counters on ~, remove them.", "triggered");
  expect(r).toMatchObject([{ verb: "remove-counter", counter: "tide", amount: "all", object: { self: true }, condition: "if there are four or more tide counters on ~" }]);
  // no count of counters before it, no antecedent: stays unread
  expect(unreadPhrases("remove them", "triggered")).toEqual(["remove them"]);
});

test("'you may pay {1} and exile a card from your graveyard': the exile is the optional action, the payment records none (Sylvia Tilly)", () => {
  const r = parseActions("you may pay {1} and exile a card from your graveyard", "triggered");
  expect(r).toMatchObject([{ verb: "exile", fromZone: "graveyard", optional: true }]);
  // a payment with nothing after it is still unread
  expect(unreadPhrases("you may pay {1}", "triggered")).toEqual(["you may pay {1}"]);
});

test("tokens that are copies, except they are ... (Uugguu, the Omniplasm)", () => {
  const r = parseActions("create two tokens that are copies of that creature, except they're 2/2 and they aren't legendary", "triggered");
  expect(r).toMatchObject([{ verb: "create", amount: "2", object: { token: true, ref: "sentence", copyOf: { type: "creature" } } }]);
  // an exception the exception reader cannot read keeps the phrase unread
  expect(unreadPhrases("create two tokens that are copies of that creature, except they fly in circles", "triggered")).not.toEqual([]);
});

test("'any player may activate this ability but only as a sorcery' is an activation rider (Sash and Waistcoat)", () => {
  expect(isRestrictionSentence("Any player may activate this ability but only as a sorcery.")).toBe(true);
  expect(isRestrictionSentence("Any player may activate this ability but only as a sorcery and draw a card.")).toBe(false);
  expect(isRestrictionSentence("Any player may activate this ability.")).toBe(false);
});

test("'that nonland card gains \"...\"' grants to the card the sentence before found (Q, Stacking the Deck)", () => {
  const r = parseActions('that nonland card gains "Exile a card from your hand: Create a copy of this card. You may cast the copy. Activate only during your turn and only if this card is exiled."', "triggered");
  expect(r).toMatchObject([{ verb: "grant-ability", object: { ref: "sentence" } }]);
});

// Review round (derive-impact vs 2edfaad7): what the first cut moved that it should not have.
test("'except for ~' keeps Mageta the Lion's grammar reading now that its short name is the card", () => {
  expect(parseActions("Destroy all creatures except for ~.", "activated")[0]).toMatchObject({ verb: "destroy", object: { except: [{ named: "~" }] } });
  expect(grammarClauseRecords(card("Mageta the Lion", "Legendary Creature — Human Spellshaper", "{2}{W}{W}, {T}, Discard two cards: Destroy all creatures except for Mageta. Those creatures can't be regenerated.")).complete).toBe(true);
});

test("a list whose first limb is colours alone shares the closing noun: left unread, never two moves (Balthor the Defiled)", () => {
  expect(unreadPhrases("Each player returns all black and all red creature cards from their graveyard to the battlefield.", "activated")).toHaveLength(1);
  // a list of two real objects still splits
  expect(parseActions("Return target creature card and all artifact cards from your graveyard to your hand.", "spell").length).toBe(2);
});

test("'you may pay {W} and tap ... rather than pay this spell's mana cost' is an alternative cost, not a pay-and-act (Sephara, the Borderposts)", () => {
  expect(unreadPhrases("You may pay {W} and tap four untapped creatures you control with flying rather than pay this spell's mana cost.", "static")).toEqual(["you may pay {W}"]);
});

// Round 2 (coordinator): the short name is for LEGENDARY cards only; Uugguu's copies keep their class.
test("an 'X the Y' short name needs a Legendary type line: Destroy the Evidence (a sorcery, corpus) never answers to 'Destroy'", () => {
  expect(selfAsTilde("Destroy target land.", "Destroy the Evidence", "Sorcery")).toBe("Destroy target land.");
  expect(selfAsTilde("Destroy target land.", "Destroy the Evidence")).toBe("Destroy target land.");
  expect(selfAsTilde("Grakk can't attack or block.", "Grakk the Pacifist", "Legendary Creature — Orc")).toBe("~ can't attack or block.");
  // without the type line the short name is not assumed
  expect(selfAsTilde("Grakk can't attack or block.", "Grakk the Pacifist")).toBe("Grakk can't attack or block.");
  for (const [name, type, text] of [
    ["Bontu the Glorified", "Legendary Creature — God", "Bontu the Glorified can't attack or block unless you sacrifice another creature."],
    ["Mageta the Lion", "Legendary Creature — Human Spellshaper", "{2}{W}{W}, {T}, Discard two cards: Destroy all creatures except for Mageta. Those creatures can't be regenerated."],
  ] as const) expect(selfAsTilde(text, name, type), name).toContain("~");
});

test("derive: Uugguu's copies carry the copied class and no 'all' scope, and meet no non-Ooze self-ETB creature", async () => {
  const [a] = derived("Uugguu, the Omniplasm", "Legendary Creature — Ooze", "Whenever another nontoken Ooze creature you control dies, create two tokens that are copies of that creature, except they're 2/2 and they aren't legendary.");
  expect(a!.effect.subject).toMatchObject({ token: true, legendary: false, copyOf: { type: "creature" } });
  expect(a!.effect.subject).not.toHaveProperty("scope");
});

test("a clause that cannot be read honestly stays a blocker", () => {
  for (const [name, type, text] of [
    ["The Holodeck", "Legendary Artifact", "Once during each of your turns, you may play a permanent card you own from outside the game or from your graveyard."],
    ["Sulu, Heroic Helmsman", "Legendary Creature — Human Officer", "Sulu stations Spacecraft and crews Vehicles as though his power were tripled."],
    ["The Muckslinger Gang", "Legendary Creature — Goblin Lizard Beast", "Creature spells you control and creature cards you own in any zone other than the battlefield or the stack get +3/+3."],
  ] as const) expect(grammarClauseRecords(card(name, type, text)).complete, name).toBe(false);
});

// DERIVE LEVEL: what the grammar's records become. Each reading below is the card's own words and no more.
const derived = (name: string, typeLine: string, oracleText: string) => {
  const c = card(name, typeLine, oracleText);
  const g = grammarClauseRecords(c);
  expect(g.complete, name).toBe(true);
  return deriveCardTags(deriveInputOf(c as never, "x", name, g.records, undefined, g.readings)).abilities;
};

test("derive: Grakk can't attack or block is a restriction on itself, no class", () => {
  const a = derived("Grakk the Pacifist", "Legendary Creature — Orc", "Grakk can't attack or block.");
  expect(a).toMatchObject([{ kind: "static", effect: { kind: "restriction" }, restricts: ["attack", "block"] }]);
});

test("derive: Kirk's anthem is every creature of any listed subtype, other than itself", () => {
  const [a] = derived("Kirk, Man of Action", "Legendary Creature — Human Officer", "Other Officers, Artificers, Doctors, Pilots, Scientists, and Spacecraft creatures you control get +2/+2.");
  expect(a).toMatchObject({ kind: "static", effect: { kind: "pump", subject: { control: "you", type: "creature", other: true, subtype: ["officer", "artificer", "doctor", "pilot", "scientist", "spacecraft"] } }, amount: "+2/+2" });
});

test("derive: 'this Spacecraft and creatures you control have hexproof' does not make Spacecraft the recipient class (K'Vort-Class Raider)", () => {
  const [a] = derived("K'Vort-Class Raider", "Artifact — Spacecraft", "During your turn, this Spacecraft and creatures you control have hexproof.");
  expect(a).toMatchObject({ kind: "static", effect: { kind: "keyword-grant", subject: { control: "you", type: "creature", scope: "all" } }, grants: ["hexproof"] });
  expect(a!.effect).not.toHaveProperty("subject.subtype");
});

test("derive: 'it and up to one target creature you control phase out' is two phase-outs (U.S.S. Defiant)", () => {
  const a = derived("U.S.S. Defiant, Mirror Migrant", "Legendary Artifact — Spacecraft", "When U.S.S. Defiant enters, it and up to one target creature you control phase out.");
  expect(a.map((x) => x.emits?.map((e) => e.verb))).toEqual([["phases-out"], ["phases-out"]]);
  expect(a[0]!.emits![0]!.subject).toMatchObject({ self: true });
  expect(a[1]!.emits![0]!.subject).toMatchObject({ control: "you", type: "creature", scope: "target" });
});

test("derive: Rikala removes every tide counter, gated by the count", () => {
  const a = derived("Rikala, Homarid King", "Legendary Creature — Lobster Noble", "At the beginning of your upkeep, put a tide counter on Rikala. Then if there are four or more tide counters on Rikala, remove them.");
  expect(a[1]).toMatchObject({ amount: "all", emits: [{ verb: "counter-removed", subject: { counter: "tide" } }], gate: { kind: "unknown" } });
});

test("derive: Sylvia's exile is a graveyard exile of your own; the {1} is no event", () => {
  const a = derived("Sylvia Tilly, Joy of Discovery", "Legendary Creature — Human Scientist Artificer", "At the beginning of combat on your turn, you may pay {1} and exile a card from your graveyard. When you do, put a +1/+1 counter on target creature.");
  expect(a[0]!.emits!.map((e) => e.verb)).toEqual(["exiled", "leaves"]);
  expect(a[0]!.emits![0]!.subject).toMatchObject({ fromZone: "graveyard" });
});

test("derive: 'they aren't legendary' makes the tokens NON-legendary, never legendary (Uugguu)", () => {
  const [a] = derived("Uugguu, the Omniplasm", "Legendary Creature — Ooze", "Whenever another nontoken Ooze creature you control dies, create two tokens that are copies of that creature, except they're 2/2 and they aren't legendary.");
  expect(a).toMatchObject({ kind: "triggered", amount: "2", effect: { kind: "token-generation", subject: { token: true, legendary: false } } });
});

test("derive: 'Any player may activate this ability but only as a sorcery' is sorcery speed (Sash and Waistcoat)", () => {
  const a = derived("Sash and Waistcoat, Unmen", "Legendary Creature — Insect Rogue", "{3}: Manifest the top card of your library. Any player may activate this ability but only as a sorcery.");
  expect(a[0]!.emits![0]).not.toHaveProperty("instantSpeed");
});
