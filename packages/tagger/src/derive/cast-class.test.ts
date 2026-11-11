import { describe, expect, test } from "vitest";
import { deriveAsCorpus } from "../derive-worker.js";
import type { SubjectFilter } from "../schema.js";
import { castClassFromPrint } from "./cast-class.js";
import { parseSubject } from "./subject.js";
import fixtures from "./cast-class.fixtures.json" with { type: "json" };

/** #1608 item 1: A CAST EMIT THAT NAMES NO CLASS MEETS NO TYPED CAST PAYOFF. 107 stored rows carried one at DERIVE 501 (census of `cardTagsDerived`, 2026-11-11: a non-self `cast` emit with no type, subtype or anyOf).
 *  The class is read off the printed clause: the class the take names ("an instant or sorcery card"), `spell` where the take names a card of no class ("the top card of that player's library"), and nothing where the
 *  words leave it open. Card documents and stored `cardClauses` dumped from Mongo 2026-11-11 (DERIVE 501); derived as derive-corpus derives them (`deriveAsCorpus`). */
type Fx = { source: Record<string, unknown>; canonical?: unknown[]; segmentHash?: string };
const rowOf = (name: string) => {
  const f = (fixtures as unknown as Record<string, Fx>)[name]!;
  return deriveAsCorpus({ doc: { oracleId: name, name, canonical: f.canonical ?? [], segmentHash: f.segmentHash } as never, source: f.source, isToken: false });
};
const casts = (name: string): SubjectFilter[] => rowOf(name).tags.abilities.flatMap((a) => a.emits ?? []).filter((e) => e.verb === "cast" && e.subject.self !== true).map((e) => e.subject);
const classOf = (s: SubjectFilter) => ({ type: s.type, ...(s.notType !== undefined ? { notType: s.notType } : {}), ...(s.subtype !== undefined ? { subtype: s.subtype } : {}) });

// THE TAKE NAMES NO CLASS: any spell. The thieves the issue names, and the rest of the stolen rows of the census.
const STOLEN_ANY = [
  "Gonti, Lord of Luxury", "Thief of Sanity", "Ragavan, Nimble Pilferer", "Daxos of Meletis", "Vaan, Street Thief", "Robber of the Rich", "Ramirez DePietro, Pillager", "Cunning Rhetoric", "Opposition Agent", "Dream Harvest",
  "Bloodsoaked Insight // Sanguine Morass", "The Ruinous Powers", "Blightwing Bandit", "You Find Some Prisoners", "Apple of Eden, Isu Relic", "Outrageous Robbery", "Krang & Shredder",
];
test.each(STOLEN_ANY)("%s casts a stolen card of no named class: type spell, still an opponent's card", (name) => {
  const s = casts(name);
  expect(s.length).toBeGreaterThan(0);
  for (const x of s) expect({ type: x.type, control: x.control, owner: x.owner }).toEqual({ type: "spell", control: "you", owner: "opp" });
});

// THE TAKE NAMES A CLASS: the cast keeps it, and meets no other.
test.each([
  ["Planeswalker's Mischief", { type: ["instant", "sorcery"] }], // "If it's an instant or sorcery card, exile it. You may cast it"
  ["Rundvelt Hordemaster", { type: "creature", subtype: "goblin" }], // "If it's a Goblin creature card, you may cast that card"
  ["Discover the Impossible", { type: "instant" }], // "you may cast the exiled card ... if it's an instant spell with mana value 2 or less"
  ["Mysterious Stranger", { type: ["instant", "sorcery"] }], // the copy of an exiled instant or sorcery card
  ["Spelltwine", { type: ["instant", "sorcery"] }],
  ["Mnemonic Deluge", { type: ["instant", "sorcery"] }],
  ["Infinite Diversity", { type: ["instant", "sorcery"] }],
  ["Bloodthirsty Adversary", { type: ["instant", "sorcery"] }],
  ["Arcane Bombardment", { type: ["instant", "sorcery"] }],
  ["Chandra, Pyromaster", { type: ["instant", "sorcery"] }],
] as const)("%s casts only the class its take names", (name, cls) => {
  const s = casts(name);
  expect(s.length).toBeGreaterThan(0);
  for (const x of s) expect(classOf(x)).toEqual(cls);
});

// A PILE ANOTHER ABILITY OF THE CARD FILLS takes the class that ability names: Quintorius exiles "target noncreature, nonland card", Spellweaver Helix imprints "two target sorcery cards".
test("a pile's class is read off the ability that fills it", () => {
  expect(casts("Quintorius, Loremaster").map((x) => x.notType)).toEqual([["creature"]]);
  expect(casts("Spellweaver Helix").map((x) => x.type)).toEqual(["sorcery"]);
});

// YOUR OWN CARD OF NO NAMED CLASS is any spell too (the Etali, Primal Storm convention): it can be a deck-mate. Where the words take it from YOUR library, hand or graveyard the emit says `owner: you`, so "a spell you
// don't own" does not hear it; where they do not say whose ("discard a card", "each player mills", "that source's controller exiles a card from their hand") no owner is written.
test.each([
  ["Chandra, Torch of Defiance", "you"], ["Creative Technique", "you"], ["Yennett, Cryptic Sovereign", "you"], ["Conspiracy Theorist", "you"], ["Master of Predicaments", "you"],
  ["Malcolm, Alluring Scoundrel", undefined], ["The Ur-Sphinx", undefined], ["Rona, Herald of Invasion // Rona, Tolarian Obliterator", undefined],
] as const)("%s casts a card of no named class that can be yours: type spell, owner %s", (name, owner) => {
  const s = casts(name);
  expect(s.length).toBeGreaterThan(0);
  for (const x of s) expect({ type: x.type, control: x.control, owner: x.owner }).toEqual({ type: "spell", control: "you", owner });
});
test("a copy of a card from any graveyard, or from yours and an opponent's, names no owner (Mnemonic Deluge, Spelltwine)", () => {
  for (const name of ["Mnemonic Deluge", "Spelltwine"]) expect(casts(name).map((x) => x.owner), name).toEqual([undefined]);
});

// DISCOVER (CR 701.57a): "Exile cards from the top of your library until you exile a nonland card with mana value N or less. You may cast that card without paying its mana cost." Your cast of any spell, from exile.
test.each(["Trumpeting Carnosaur", "Hit the Mother Lode", "Quintorius Kand", "Chimil, the Inner Sun", "Brass's Tunnel-Grinder // Tecutlan, the Searing Rift", "U.S.S. Discovery, at Black Alert"])("%s discovers: your cast of a spell you own, from exile", (name) => {
  const s = casts(name);
  expect(s.length).toBeGreaterThan(0);
  for (const x of s) expect({ type: x.type, control: x.control, fromZone: x.fromZone, owner: x.owner }).toEqual({ type: "spell", control: "you", fromZone: "exile", owner: "you" });
});
test("Zoyowa's Justice: 'that player discovers' is that player's cast, whoever they are", () => {
  expect(casts("Zoyowa's Justice").map((x) => ({ type: x.type, control: x.control, fromZone: x.fromZone, owner: x.owner }))).toEqual([{ type: "spell", control: "any", fromZone: "exile", owner: "you" }]);
});
// A PLAYER WHO CASTS OFF THEIR OWN LIBRARY OR HAND casts a card they own: any player's cast (`control: any`) of the caster's own card (`owner: you`), never "a spell you don't own".
test.each(["Omen Machine", "Wild Evocation"])("%s: each player casts their own card", (name) => {
  expect(casts(name).map((x) => ({ type: x.type, control: x.control, owner: x.owner }))).toEqual([{ type: "spell", control: "any", owner: "you" }]);
});

// CEILING pinned (the list in cast-class.ts): the words leave the class open, so the emit stays unclassed and silent. A condition filed as a cast, a class that depends on another card, a back-reference no word of the
// clause resolves, a card named another way.
test.each([
  "Drowner of Truth // Drowned Jungle", "Revenant Patriarch", "Iridescent Tiger", // "if {C} was spent to cast it", "if you cast it": no cast is granted
  "Possibility Storm", "Unpredictable Cyclone", "Swindler's Scheme", "Gale, Waterdeep Prodigy", "Magar of the Magic Strings", "Garth One-Eye", // the class depends on another card
  "Power Pack", "Baron Helmut Zemo", "Gale's Redirection", "Zethi, Arcane Blademaster", "River Song's Diary", // no word of the clause names the card
  "Alaundo the Seer", "Hildibrand Manderville // Gentleman's Rise", "Geode Golem", "Aether Searcher", // the trigger's own card, the commander, a named card
])("%s: the class is not read, the cast stays unclassed", (name) => {
  const s = casts(name).filter((x) => x.type === undefined && x.subtype === undefined);
  expect(s.length).toBeGreaterThan(0);
});
test("Wizard's Spellbook: 'Copy that card' names no card here (unread); 'Copy each card exiled with this artifact' is the pile its {T} ability fills with instant or sorcery cards", () => {
  expect(casts("Wizard's Spellbook").map((x) => x.type)).toEqual([undefined, undefined, ["instant", "sorcery"]]);
});

describe("castClassFromPrint", () => {
  const cls = (text: string, piles: string[] = []) => castClassFromPrint(text, piles, parseSubject);
  test("a card of no class is any spell", () => {
    expect(cls("When Gonti enters, look at the top four cards of target opponent's library, exile one of them face down, then put the rest on the bottom of that library in a random order. You may cast that card for as long as it remains exiled.")).toEqual({ type: "spell" });
  });
  test("'if it's a land card ... Otherwise, you may cast it' is any spell, never a land", () => {
    expect(cls("Whenever a source deals damage to Rona, that source's controller exiles a card from their hand at random. If it's a land card, you may put it onto the battlefield under your control. Otherwise, you may cast it without paying its mana cost.")).toEqual({ type: "spell" });
  });
  test("no permission to cast, no class: 'if {C} was spent to cast it', 'if you cast it'", () => {
    expect(cls("When you cast this spell, if {C} was spent to cast it, create two 0/1 colorless Eldrazi Spawn creature tokens.")).toBeUndefined();
    expect(cls("When this creature enters, if you cast it, add {W}{U}{B}{R}{G}.")).toBeUndefined();
  });
  test("no antecedent in the clause: unread", () => {
    expect(cls("At the beginning of your next upkeep, you may cast that card without paying its mana cost. If that spell would be put into your graveyard, exile it instead.")).toBeUndefined();
  });
  test("a trigger's 'whenever an opponent casts a spell' is no permission, and its spell no take (Swindler's Scheme, Spellweaver Helix)", () => {
    expect(cls("Whenever an opponent casts a spell from their hand, you may reveal the top card of your library. If it shares a card type with that spell, counter that spell and that opponent may cast the revealed card without paying its mana cost.")).toBeUndefined();
    expect(cls("Whenever a player casts a card, if it has the same name as one of the cards exiled with this artifact, you may copy the other. If you do, you may cast the copy without paying its mana cost.", ["Imprint — When this artifact enters, you may exile two target sorcery cards from a single graveyard."])).toEqual({ type: "sorcery" });
  });
  test("a class that depends on another card ('shares a card type with it'): unread", () => {
    expect(cls("Whenever a player casts a spell from their hand, that player exiles it, then exiles cards from the top of their library until they exile a card that shares a card type with it. That player may cast that card without paying its mana cost.")).toBeUndefined();
  });
});
