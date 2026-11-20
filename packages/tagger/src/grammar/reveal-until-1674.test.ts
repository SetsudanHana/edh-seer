import { expect, test } from "vitest";
import { grammarClauseRecords } from "./clause-record.js";
import { unreadPhrases } from "./action.js";
import { deriveCardTags } from "../derive/derive.js";
import { deriveInputOf } from "../derive-input.js";
import { deriveDiff } from "./derive-diff.js";

// #1674: "reveal cards from the top of your library until you reveal a <class> card", then "put that card ..., the rest on the bottom". Every oracle text is the corpus's own (Mongo `cards`, 2026-11-20).
const card = (name: string, typeLine: string, oracleText: string, keywords: string[] = []) => ({ name, typeLine, oracleText, keywords });
const JANICE = card("Janice Rand, Essential Aide", "Legendary Creature — Human Officer", "Whenever a commander you control enters or attacks, put a +1/+1 counter on it, then reveal cards from the top of your library until you reveal a land card. Put that card onto the battlefield tapped and the rest on the bottom of your library in a random order.");
const RIKER = card("Will Riker, First in the Field", "Legendary Creature — Human Pilot", "At the beginning of combat on your turn, reveal cards from the top of your library until you reveal two land cards. Put those land cards onto the battlefield and the rest on the bottom of your library in a random order. Sacrifice those lands at the beginning of your next end step.");
const CHEKOV = card("Pavel Chekov, First Posting", "Legendary Creature — Human Pilot", "If you would draw a card, you may instead choose land or nonland and reveal cards from the top of your library until you reveal a card of the chosen kind. Put that card into your hand and put all other cards revealed this way on the bottom of your library in a random order.");
const HERMIT = card("Hermit Druid", "Creature — Human Druid", "{G}, {T}: Reveal cards from the top of your library until you reveal a basic land card. Put that card into your hand and all other cards revealed this way into your graveyard.");

const tags = (c: ReturnType<typeof card>) => { const g = grammarClauseRecords(c); return deriveCardTags(deriveInputOf(c as never, c.name, c.name, g.records, undefined, g.readings), { foldGrantTwins: false, collapseZoneSearches: false }).abilities; };

test("the reveal-until sentence is read whole, and the puts that follow it are cards of the library", () => {
  expect(unreadPhrases("reveal cards from the top of your library until you reveal a land card. Put that card onto the battlefield tapped and the rest on the bottom of your library in a random order.", "triggered")).toEqual([]);
  for (const c of [JANICE, RIKER, CHEKOV, HERMIT]) expect(grammarClauseRecords(c).blocker, c.name).toBeUndefined();
});

test("Janice Rand and Will Riker put land cards from the library onto the battlefield", () => {
  const janice = tags(JANICE).filter((a) => a.emits?.some((e) => e.verb === "enters"));
  expect(janice.length).toBeGreaterThan(0);
  for (const a of janice) expect(a.emits![0]!.subject).toMatchObject({ type: "land", fromZone: "library", entersTapped: true });
  expect(tags(RIKER).find((a) => a.emits?.some((e) => e.verb === "enters"))!.emits![0]!.subject).toMatchObject({ type: "land", fromZone: "library" });
});

test("Pavel Chekov's draw replacement is card selection: a typed dig that is not hand-fill", () => {
  const dig = tags(CHEKOV).find((a) => a.effect?.kind === "search");
  expect(dig).toBeDefined();
  expect(dig!.netZero).toBe(true);
});

test("a stored reveal-until (Hermit Druid) derives the same from the grammar", () => {
  const g = grammarClauseRecords(HERMIT);
  expect(g.complete).toBe(true);
  const stored = [{ id: 1, abilityType: "activated", actions: [
    { verb: "put", object: "that basic land card", fromZone: "library", toZone: "hand", amount: null, optional: false },
    { verb: "put", object: "all other cards revealed this way", fromZone: "library", toZone: "graveyard", amount: null, optional: false }] }];
  const opt = { foldGrantTwins: false, collapseZoneSearches: false };
  const s = deriveCardTags(deriveInputOf(HERMIT as never, "h", "Hermit Druid", stored as never), opt).abilities;
  expect(deriveDiff(s, tags(HERMIT))).toBeNull();
});

const GIFT = card("Gift of Perfection", "Sorcery", "Each opponent reveals cards from the top of their library until they reveal a creature card. Assimilate one of the creature cards revealed this way. Then each opponent puts the other cards they revealed this way on the bottom of their library in a random order. (To assimilate a card, put it onto the battlefield under your control with a +1/+1 counter. It's a Borg artifact creature and loses all other creature types.)");
const VOYAGER = card("U.S.S. Voyager, Lone Wanderer", "Legendary Artifact — Spacecraft", "When U.S.S. Voyager enters, reveal cards from the top of your library until you reveal two land cards. Put those land cards onto the battlefield tapped and the rest on the bottom of your library in a random order.");
const POLYMORPH = card("Polymorph", "Sorcery", "Destroy target creature. It can't be regenerated. Its controller reveals cards from the top of their library until they reveal a creature card. The player puts that card onto the battlefield, then shuffles all other cards revealed this way into their library.");

test("U.S.S. Voyager puts the two land cards from the library, tapped", () => {
  expect(grammarClauseRecords(VOYAGER).blocker).toBeUndefined();
  expect(tags(VOYAGER)[0]!.emits![0]!.subject).toMatchObject({ type: "land", fromZone: "library", entersTapped: true });
});

test("Gift of Perfection: the assimilated card, its counter and its Borg animate are the opponent's (owner opp), and enter under your control", () => {
  expect(grammarClauseRecords(GIFT).blocker).toBeUndefined();
  const a = tags(GIFT);
  expect(a.flatMap((x) => x.emits ?? []).filter((e) => e.verb === "enters")).toMatchObject([{ subject: { control: "you", owner: "opp", fromZone: "library", type: "creature" } }]);
  expect(a.flatMap((x) => x.emits ?? []).filter((e) => e.verb === "counter-added")).toMatchObject([{ subject: { owner: "opp" } }]);
  expect(a.find((x) => x.effect.kind === "animate")!.effect.subject).toMatchObject({ owner: "opp", subtype: "borg" });
});

test("a reveal-until after a target (Polymorph) reads the revealed class, not the target", () => {
  const enters = tags(POLYMORPH).flatMap((x) => x.emits ?? []).find((e) => e.verb === "enters");
  expect(enters?.subject.scope).toBeUndefined();
  expect(enters?.subject).toMatchObject({ type: "creature", fromZone: "library" });
});
