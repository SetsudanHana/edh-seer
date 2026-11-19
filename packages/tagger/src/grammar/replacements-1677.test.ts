import { expect, test } from "vitest";
import { grammarClauseRecords } from "./clause-record.js";
import { parseActions, unreadPhrases } from "./action.js";
import { parse } from "./filter.js";
import { deriveCardTags } from "../derive/derive.js";
import { deriveInputOf } from "../derive-input.js";

// #1677: replacement-shaped lines the grammar blocked on. Every oracle text below is the corpus's own (Mongo `cards`, 2026-11-19).
const card = (name: string, typeLine: string, oracleText: string, keywords: string[] = []) => ({ name, typeLine, oracleText, keywords });
const actionsOf = (c: ReturnType<typeof card>) => grammarClauseRecords(c).records.flatMap((r) => (r.actions ?? []).map((a) => ({ ...a, abilityType: r.abilityType })));

test("'deals 4 damage to that creature instead if ...' is the improved amount, one deal-damage more (Planetary Bombardment, Steer Clear)", () => {
  const pb = card("Planetary Bombardment", "Sorcery", "Planetary Bombardment deals 2 damage to target creature. Planetary Bombardment deals 4 damage to that creature instead if a creature died this turn.");
  const g = grammarClauseRecords(pb);
  expect(g.blocker).toBeUndefined();
  expect(g.complete).toBe(true);
  expect(g.records.flatMap((r) => (r.actions ?? []).map((a) => [a.verb, a.amount]))).toEqual([["deal-damage", "2"], ["deal-damage", "4"]]);
  expect(g.records[0]!.actions!.map((a) => a.object)).toEqual(["target creature", "that creature"]);
  const sc = grammarClauseRecords(card("Steer Clear", "Instant", "Steer Clear deals 2 damage to target attacking or blocking creature. Steer Clear deals 4 damage to that creature instead if you controlled a Mount as you cast this spell."));
  expect(sc.complete).toBe(true);
});

test("'that player loses 2 life instead if ...' is the improved amount on the same player (Vengeance Mission)", () => {
  const vm = card("Vengeance Mission", "Enchantment", "Whenever a creature dies, put a quest counter on this enchantment. Target opponent loses 1 life. That player loses 2 life instead if there are seven or more quest counters on this enchantment.");
  const g = grammarClauseRecords(vm);
  expect(g.blocker).toBeUndefined();
  const lose = g.records.flatMap((r) => r.actions ?? []).filter((a) => a.verb === "lose-life");
  expect(lose.map((a) => [a.amount, a.object])).toEqual([["1", "target opponent"], ["2", "that player"]]);
});

test("an 'instead if' tail on anything but damage or life loss stays unread: it changes what happens, not an amount", () => {
  expect(unreadPhrases("create three 2/2 green Wolf creature tokens instead if a creature died this turn", "spell")).not.toEqual([]);
  expect(unreadPhrases("put three +1/+1 counters on that creature instead if a creature died this turn", "spell")).not.toEqual([]);
});

test("'each nontoken creature you control that wasn't cast from your hand enters with two additional +1/+1 counters on it' (Venser)", () => {
  const r = parseActions("Each nontoken creature you control that wasn't cast from your hand enters with two additional +1/+1 counters on it.", "static");
  expect(r).toMatchObject([{ verb: "add-counter", counter: "+1/+1", amount: "2", object: { control: "you", type: "creature", token: false, scope: "each", notFromZone: "hand" } }]);
  // the narrowing is never dropped: without it the line would claim counters on every creature
  expect(parse("each nontoken creature you control that wasn't cast from your hand")).toMatchObject({ notFromZone: "hand", token: false });
});

test("'that artifact creature enters with a finality counter on it' is the creature cast this way, never the card itself (Overflow Submatrix)", () => {
  const r = parseActions("that artifact creature enters with a finality counter on it", "static", "if you cast a spell this way");
  expect(r).toMatchObject([{ verb: "add-counter", counter: "finality", amount: "1", object: { ref: "sentence" } }]);
  expect(r[0]!.object?.self).toBeUndefined();
  const g = grammarClauseRecords(card("Overflow Submatrix", "Artifact Creature — Borg", "Once during each of your turns, you may cast an artifact creature spell from your graveyard. If you cast a spell this way, that artifact creature enters with a finality counter on it. (If a creature with a finality counter on it would die, exile it instead.)"));
  expect(g.blocker).toBeUndefined();
});

test("'lands you control enter untapped' is recorded and claims no event (Warp Speed)", () => {
  expect(parseActions("lands you control enter untapped", "static")).toMatchObject([{ verb: "other", object: { control: "you", type: "land", scope: "all" }, text: "lands you control enter untapped" }]);
  // not a tap: the stored reading of 'enter tapped' says the permanents are tapped, the opposite of this
  expect(parseActions("lands you control enter untapped", "static").map((a) => a.verb)).not.toContain("tap");
  // a subject the filter grammar cannot read stays unread
  expect(unreadPhrases("lands you can't name enter untapped", "static")).not.toEqual([]);
  const g = grammarClauseRecords(card("Warp Speed", "Enchantment", "Lands you control enter untapped.\nWhen this enchantment enters, search your library for a basic land card or Planet card, reveal it, put it into your hand, then shuffle."));
  expect(g.blocker).toBeUndefined();
});

test("'put it into your hand or graveyard' is a put to each zone, both optional: one of them happens (Hela // Dark Tutor, Dina's Guidance)", () => {
  const r = parseActions("put it into your hand or graveyard", "spell");
  expect(r.map((a) => [a.verb, a.toZone, a.optional, a.object?.ref])).toEqual([["put", "hand", true, "sentence"], ["put", "graveyard", true, "sentence"]]);
  expect(parseActions("put it into your graveyard or hand", "spell").map((a) => a.toZone)).toEqual(["graveyard", "hand"]);
  // only the player's own two zones; another owner's is unread
  expect(unreadPhrases("put it into target player's hand or graveyard", "spell")).not.toEqual([]);
  const g = grammarClauseRecords(card("Hela, Mistress of Darkness // Dark Tutor", "Legendary Creature — God Sorcerer Villain // Sorcery — Vengeance", "Whenever a player loses life during your turn, you may create that many tapped 2/2 black Zombie creature tokens. Do this only once each turn.\n//\n(Cast only from your graveyard. Then exile it.)\nSearch your library for a card, put it into your hand or graveyard, then shuffle. You lose 3 life."));
  expect(g.blocker).toBeUndefined();
  expect(actionsOf(card("Hela, Mistress of Darkness // Dark Tutor", "Sorcery", "Search your library for a card, put it into your hand or graveyard, then shuffle. You lose 3 life.")).map((a) => [a.verb, a.toZone ?? null, a.amount ?? null])
  ).toEqual([["search", null, "1"], ["put", "hand", null], ["put", "graveyard", null], ["shuffle", null, null], ["lose-life", null, "3"]]);
});

test("a TEMPORARY counter replacement and a destroy replacement with 'healed' damage stay blockers (Brad Boimler, Dr. McCoy)", () => {
  const brad = grammarClauseRecords(card("Brad Boimler, Eager Ensign", "Legendary Creature — Human Officer", "Lifelink\nWhenever Brad Boimler becomes tapped, until end of turn, if one or more counters would be put on a permanent you control, that many plus one of each of those kinds of counters are put on that permanent instead."));
  expect(brad.complete).toBe(false);
  const mc = grammarClauseRecords(card("Dr. McCoy, Surly Surgeon", "Legendary Creature — Human Doctor", "When Dr. McCoy enters, put a +1/+1 counter on another target creature you control.\nIf another creature you control with a +1/+1 counter on it would be destroyed, instead remove all +1/+1 counters from it and all damage already dealt to it is healed."));
  expect(mc.complete).toBe(false);
});

// DERIVE LEVEL: what the records become, the acting player and the zones as the card says them.
const derived = (name: string, typeLine: string, oracleText: string) => {
  const c = card(name, typeLine, oracleText);
  const g = grammarClauseRecords(c);
  expect(g.complete, name).toBe(true);
  return deriveCardTags(deriveInputOf(c as never, "x", name, g.records, undefined, g.readings)).abilities;
};
const emitsOf = (a: ReturnType<typeof derived>) => a.flatMap((x) => x.emits ?? []);

test("derive: Venser's counters go on creatures that were NOT cast from the hand (never fromZone hand)", () => {
  const e = emitsOf(derived("Venser, Visionary Traveler", "Legendary Planeswalker — Venser", "Each nontoken creature you control that wasn't cast from your hand enters with two additional +1/+1 counters on it."));
  expect(e).toMatchObject([{ verb: "counter-added", subject: { control: "you", type: "creature", token: false, scope: "each", counter: "+1/+1", notFromZone: "hand" } }]);
  expect(e[0]!.subject.fromZone).toBeUndefined();
});

test("derive: Vengeance Mission's second loss is an opponent's too (the back-referenced player), 2 life, and the first is 1", () => {
  const a = derived("Vengeance Mission", "Enchantment", "Whenever a creature dies, put a quest counter on this enchantment. Target opponent loses 1 life. That player loses 2 life instead if there are seven or more quest counters on this enchantment.");
  const lose = a.filter((x) => x.emits?.some((e) => e.verb === "lose-life"));
  expect(lose.map((x) => [x.amount, x.emits![0]!.subject.control, x.emits![0]!.subject.scope])).toEqual([["1", "opp", "target"], ["2", "opp", undefined]]);
});

test("derive: Planetary Bombardment deals 2 and 4 to a creature, the card the dealer", () => {
  const a = derived("Planetary Bombardment", "Sorcery", "Planetary Bombardment deals 2 damage to target creature. Planetary Bombardment deals 4 damage to that creature instead if a creature died this turn.");
  expect(a.map((x) => [x.amount, x.emits![0]!.verb, x.emits![0]!.subject.type, x.emits![0]!.dealer?.self])).toEqual([["2", "non-combat-damage", "creature", true], ["4", "non-combat-damage", "creature", true]]);
});

test("derive: Overflow Submatrix puts a finality counter on a creature it cast, claiming no counter on itself", () => {
  const a = derived("Overflow Submatrix", "Artifact Creature — Borg", "Once during each of your turns, you may cast an artifact creature spell from your graveyard. If you cast a spell this way, that artifact creature enters with a finality counter on it. (If a creature with a finality counter on it would die, exile it instead.)");
  const c = emitsOf(a).filter((e) => e.verb === "counter-added");
  expect(c).toMatchObject([{ subject: { counter: "finality" } }]);
  expect(c[0]!.subject.self).toBeUndefined();
});

test("derive: Warp Speed's untapped lands claim nothing; Dark Tutor puts to the hand or the graveyard, yours", () => {
  expect(emitsOf(derived("Warp Speed", "Enchantment", "Lands you control enter untapped.")).map((e) => e.verb)).not.toContain("tap");
  const t = derived("Dark Tutor", "Sorcery", "Search your library for a card, put it into your hand or graveyard, then shuffle. You lose 3 life.");
  expect(emitsOf(t).map((e) => [e.verb, e.subject.control])).toEqual(expect.arrayContaining([["lose-life", "you"]]));
});
