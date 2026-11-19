import { expect, test } from "vitest";
import { grammarClauseRecords } from "./clause-record.js";
import { parseActions, unreadPhrases } from "./action.js";
import { deriveCardTags } from "../derive/derive.js";
import { deriveInputOf } from "../derive-input.js";

// #1672: a cast keyword given to a class of SPELLS, its cost sentence, an activation-cost reducer, a tax on a card cast
// "this way", and the value of X. Every oracle text below is the corpus's own (Mongo `cards`, 2026-11-19).
const card = (name: string, typeLine: string, oracleText: string, keywords: string[] = []) => ({ name, typeLine, oracleText, keywords });
const derived = (name: string, typeLine: string, oracleText: string, keywords: string[] = []) => {
  const c = card(name, typeLine, oracleText, keywords);
  const g = grammarClauseRecords(c);
  expect(g.blocker, name).toBeUndefined();
  expect(g.complete, name).toBe(true);
  return deriveCardTags(deriveInputOf(c as never, "x", name, g.records, undefined, g.readings)).abilities;
};
// A keyword given to a spell is never a keyword on a permanent: nothing it reads is a grant to the board.
const grantsNothing = (r: { verb: string }[]) => expect(r.map((a) => a.verb)).not.toContain("grant-ability");

test("'each sea monster spell you cast has emerge' is a cost note on those spells, no grant (Zekes)", () => {
  const r = parseActions("each sea monster spell you cast has emerge", "static");
  expect(r).toMatchObject([{ verb: "cost-modify", text: expect.stringContaining("emerge") }]);
  grantsNothing(r);
  expect(parseActions("the emerge cost is equal to its mana cost", "static")).toMatchObject([{ verb: "cost-modify" }]);
  // a keyword the grammar has no reading for stays unread
  expect(unreadPhrases("each sea monster spell you cast has frobnicate", "static")).not.toEqual([]);
});

test("'the first nonlegendary creature spell you cast each turn has demonstrate' claims no cost change (Elda)", () => {
  const r = parseActions("the first nonlegendary creature spell you cast each turn has demonstrate", "static");
  expect(r).toMatchObject([{ verb: "other", text: expect.stringContaining("demonstrate") }]);
  grantsNothing(r);
  derived("Elda, Conjurer of Spectacle", "Legendary Creature — Human Wizard", "The first nonlegendary creature spell you cast each turn has demonstrate. (When you cast that spell, you may copy it. If you do, choose an opponent to also copy it. Each copy becomes a token.)");
});

test("'the next artifact creature spell and the next Spacecraft spell you cast this turn have undaunted' (Võx)", () => {
  const r = parseActions("the next artifact creature spell and the next Spacecraft spell you cast this turn have undaunted", "triggered");
  expect(r).toMatchObject([{ verb: "cost-modify", text: expect.stringContaining("undaunted") }]);
  grantsNothing(r);
  derived("Võx, Child of the Collective", "Legendary Artifact Creature — Borg", "When Võx enters and at the beginning of your first main phase, the next artifact creature spell and the next Spacecraft spell you cast this turn have undaunted. (They cost {1} less to cast for each opponent.)");
});

test("'the first spell you cast during each of your turns has assist' (Yume)", () => {
  const r = parseActions("the first spell you cast during each of your turns has assist", "static");
  expect(r).toMatchObject([{ verb: "cost-modify", text: expect.stringContaining("assist") }]);
  grantsNothing(r);
});

test("a keyword granted to spells is not read for a class of permanents ('creatures you control have assist' stays a grant)", () => {
  expect(parseActions("creatures you control have flying", "static")).toMatchObject([{ verb: "grant-ability" }]);
  expect(parseActions("each creature spell you cast has emerge", "static").map((a) => a.verb)).not.toContain("grant-ability");
});

test("'a spell cast this way costs {2} more to cast' is a tax on the card, not on every spell (Zero)", () => {
  const r = parseActions("a spell cast this way costs {2} more to cast", "triggered");
  expect(r).toMatchObject([{ verb: "other", text: "a spell cast this way costs {2} more to cast" }]);
  const a = derived("Zero, Incorporeal Sensate", "Legendary Artifact Creature — Medusan Scientist", "Lifelink\nWhen Zero enters, look at target opponent's hand. You may exile a nonland card from it. For as long as that card remains exiled, its owner may play it. A spell cast this way costs {2} more to cast.", ["Lifelink"]);
  expect(JSON.stringify(a)).not.toMatch(/"kind":"tax"/);
});

test("'this ability costs {X} less to activate, where X is ...' is a cost note on its own ability (Astute Terraformer, Suus Mahna Practitioner)", () => {
  expect(parseActions("this ability costs {X} less to activate, where X is the number of differently named lands you control", "static")).toEqual([]);
  expect(unreadPhrases("this ability costs {X} less to activate, where X is the number of differently named lands you control", "static")).toEqual([]);
  // an "if" condition, not a "where X is", is another shape and stays unread
  expect(unreadPhrases("this ability costs {3} less to activate if you had 200 or more cards in your starting deck", "static")).not.toEqual([]);
  derived("Suus Mahna Practitioner", "Creature — Vulcan Officer", "Strange new worlds — {4}{U}, {T}: Tap target creature. This ability costs {X} less to activate, where X is the number of differently named lands you control.", ["Strange new worlds"]);
  derived("Astute Terraformer", "Creature — Vulcan Scientist", "Strange new worlds — {6}: This creature gets +2/+2 until end of turn. This ability costs {X} less to activate, where X is the number of differently named lands you control. Activate only once each turn.", ["Strange new worlds"]);
});

test("'you may have the value of X become 5' is an optional unclaimed choice (Glava)", () => {
  expect(parseActions("you may have the value of X become 5", "triggered")).toMatchObject([{ verb: "other", optional: true, text: "you may have the value of X become 5" }]);
  expect(unreadPhrases("you may have the value of X become 5", "triggered")).toEqual([]);
});

test("Scotty stays blocked: beam me up is no Comprehensive Rules keyword, so its grant is not read", () => {
  const g = grammarClauseRecords(card("Scotty, Miracle Worker", "Legendary Creature — Human Artificer", "During your main phase, each card in your graveyard has beam me up. The beam me up cost is equal to that spell's mana cost. Scotty can't be beamed up to cast a spell this way. (Only instant and sorcery spells can be cast this way. You may cast a card from your graveyard for its beam me up cost if you also return another creature you control to its owner's hand. Then exile that spell.)"));
  expect(g.complete).toBe(false);
  expect(g.blocker).toBeDefined();
});

// Round 2: "exile a nonland card from it" after "look at target opponent's hand" is a card from THAT hand (Zero, Incorporeal Sensate).
test("Zero's exile is a card from the looked-at opponent's hand: control opp, fromZone hand (never any, no zone)", () => {
  const r = parseActions("look at target opponent's hand. You may exile a nonland card from it. For as long as that card remains exiled, its owner may play it. A spell cast this way costs {2} more to cast.", "triggered");
  expect(r[0]).toMatchObject({ verb: "exile", optional: true, object: { control: "opp", fromZone: "hand" } });
  const a = derived("Zero, Incorporeal Sensate", "Legendary Artifact Creature — Medusan Scientist", "Lifelink\nWhen Zero enters, look at target opponent's hand. You may exile a nonland card from it. For as long as that card remains exiled, its owner may play it. A spell cast this way costs {2} more to cast.", ["Lifelink"]);
  const emits = a.flatMap((x) => x.emits ?? []).filter((e) => e.verb === "exiled");
  expect(emits.length).toBeGreaterThan(0);
  for (const e of emits) { expect(e.subject?.control).toBe("opp"); expect(e.subject?.fromZone).toBe("hand"); }
  // "from it" with no hand looked at is not given a hand
  expect(parseActions("you may exile a nonland card from it", "triggered")[0]!.object).not.toMatchObject({ control: "opp" });
});
