import { describe, expect, test } from "vitest";
import { deriveCardTags, deriveInputOf } from "@edh-seer/tagger";
import type { CardTags, ClauseRecord } from "@edh-seer/tagger";
import { loadHierarchy, pairReasons } from "./index.js";
import type { DeckCard } from "./types.js";
import fixtures from "./fixtures/stolen-cast-pairs.json" with { type: "json" };

/** #1592 fix round: "You may cast that card" of a card taken from an OPPONENT's hand, graveyard or library (Covetous Urge, Psychic Intrusion, Stolen Goods) is your cast of a card that opponent owns
 *  (CR 108.3: a card's owner is the player who started the game with it in their deck). It is never a card of YOUR deck, so it fires no deck-mate's own "when you cast this spell" (Artisan of Kozilek, Echo Storm);
 *  you still cast it, so every class trigger hears it ("whenever you cast an instant or sorcery spell", prowess, "a spell you don't own"). A cast off your OWN library (Hidetsugu and Kairi) can be a deck-mate.
 *  Source documents and stored `cardClauses.canonical` dumped from Mongo 2026-11-10. */
const F = fixtures as unknown as Record<string, { source: Record<string, unknown>; canonical: ClauseRecord[] }>;
const dc = (name: string): DeckCard => ({
  card: F[name]!.source as unknown as DeckCard["card"],
  tags: deriveCardTags(deriveInputOf(F[name]!.source as never, name, name, F[name]!.canonical)) as CardTags,
});
const H = loadHierarchy();
const castTags = (producer: string, consumer: string) => pairReasons(dc(producer), dc(consumer), H).map((r) => r.tag).filter((t) => t.startsWith("cast:") || t.startsWith("prowess:"));

describe.each(["Covetous Urge", "Psychic Intrusion", "Stolen Goods"])("%s casts a card an opponent owns", (thief) => {
  test.each(["Artisan of Kozilek", "Echo Storm"])("no self reason with %s's own 'when you cast this spell'", (self) => {
    expect(castTags(thief, self)).toEqual([]);
  });
  test.each(["Talrand, Sky Summoner", "Monastery Swiftspear", "Nita, Forum Conciliator"])("still feeds %s, which hears any spell you cast", (payoff) => {
    expect(castTags(thief, payoff)).not.toEqual([]);
  });
});
// Hidetsugu and Kairi casts off YOUR library, so a deck-mate is possible, but only "if it's an instant or sorcery card": the cast emit carries that type. A creature's own "when you cast or cycle this"
// (Drownyard Lurker, Warped Tusker) is never what it casts; an instant's own cast trigger is (Contractual Safeguard's addendum).
test.each(["Drownyard Lurker", "Warped Tusker"])("Hidetsugu and Kairi casts only an instant or sorcery: no self reason with the creature %s", (creature) => {
  expect(castTags("Hidetsugu and Kairi", creature)).toEqual([]);
});
test("Hidetsugu and Kairi can cast a deck-mate instant: Contractual Safeguard's own cast trigger hears it", () => {
  expect(castTags("Hidetsugu and Kairi", "Contractual Safeguard")).not.toEqual([]);
});

// #1594: the rest of the steal-and-cast population. Whose card a cast takes is read off the words, four ways: the cast's own object names another player's zone or ownership ("from an opponent's graveyard",
// "cards your opponents own"), the cast points back at cards the same ability took from another player ("from among them", "the exiled card"), or it points at cards another ability of the card took
// ("cards exiled with this enchantment"). Added fixtures dumped from Mongo 2026-11-10.
const castEmits = (name: string) => (dc(name).tags?.abilities ?? []).flatMap((a) => a.emits ?? []).filter((e) => (e.verb === "cast" || e.verb === "land-play") && e.subject.self !== true).map((e) => e.subject);
const THIEVES = [
  "Villainous Wealth", "Mnemonic Betrayal", "Kefka, Dancing Mad", "Mindclaw Shaman", "Black Widow, Super Spy", "Outrageous Robbery", // points back at what this ability took
  "Memory Plunder", "Wrexial, the Risen Deep", "Flotsam // Jetsam", "Draugr Necromancer", "Sen Triplets", "Shaman's Trance", // the cast names the other player's zone / ownership
  "Hedonist's Trove", "Nightveil Specter", "Kheru Mind-Eater", "Null Summoner", "Talent of the Telepath", "Court of Locthwain", // points at what another ability of the card took
];
describe.each(THIEVES)("%s casts only cards another player owns", (thief) => {
  test("every cast / land-play emit is YOUR cast of a card an opponent owns", () => {
    const emits = castEmits(thief);
    expect(emits.length).toBeGreaterThan(0);
    for (const s of emits) expect({ control: s.control, owner: s.owner }).toEqual({ control: "you", owner: "opp" });
  });
  // Sen Triplets derives a land-play only: it has no cast reason to lose, so the self cases would pass whatever the owner says.
  test.skipIf(thief === "Sen Triplets").each(["Artisan of Kozilek", "Echo Storm"])("no self reason with %s's own 'when you cast this spell'", (self) => {
    expect(castTags(thief, self)).toEqual([]);
  });
});
test.each(["Villainous Wealth", "Mnemonic Betrayal", "Memory Plunder", "Wrexial, the Risen Deep", "Hedonist's Trove"])("%s still feeds the class triggers: Talrand, prowess, Nita's 'a spell you don't own'", (thief) => {
  for (const payoff of ["Talrand, Sky Summoner", "Monastery Swiftspear", "Nita, Forum Conciliator"]) expect(castTags(thief, payoff), payoff).not.toEqual([]);
});
test("Memory Plunder is your cast, so it is no 'whenever an opponent casts a spell' for Rhystic Study", () => {
  expect(castTags("Memory Plunder", "Rhystic Study")).toEqual([]);
});
// A MIXED SOURCE PROVES NOTHING: "each player's library" and "target player's graveyard" include yours, and a pile fed by "whenever a player casts" (River Song's Diary) holds your own spells too.
// ...and so does a player the words leave open: "Target player reveals their hand" (Psychic Theft) can be you, and "that source's controller exiles a card from their hand" (Rona, Tolarian Obliterator) is you when your own source dealt the damage.
test.each(["Etali, Primal Conqueror // Etali, Primal Sickness", "Shadow of the Enemy", "Jeleva, Nephalia's Scourge", "River Song's Diary", "Psychic Theft", "Rona, Herald of Invasion // Rona, Tolarian Obliterator"])("%s can cast your own card: no owner is written", (mixed) => {
  const emits = castEmits(mixed);
  expect(emits.length).toBeGreaterThan(0);
  for (const s of emits) expect(s.owner).toBeUndefined();
});
test("Etali, Primal Conqueror can cast a deck-mate off your own library: Artisan of Kozilek's cast trigger hears it", () => {
  expect(castTags("Etali, Primal Conqueror // Etali, Primal Sickness", "Artisan of Kozilek")).not.toEqual([]);
});
test("Spellshift's cast is the other player's ('that player may cast that card'): not yours, no owner", () => {
  for (const s of castEmits("Spellshift")) { expect(s.control).not.toBe("you"); expect(s.owner).toBeUndefined(); }
});
test.each(["Psychic Theft", "Rona, Herald of Invasion // Rona, Tolarian Obliterator"])("%s is still your cast, whoever the card is taken from", (thief) => {
  for (const s of castEmits(thief)) expect(s.control).toBe("you");
});

// "YOU MAY CAST" IS YOUR CAST WHETHER OR NOT THE OWNER IS PROVEN (#1594 review): the caster is read off the permission alone. A spell an opponent only CONTROLS (Smirking Spelljacker), a copy (CR 112.2: the
// copy's owner is whoever put it on the stack, you) and a pile that can hold your own card (Etali, Primal Storm; The Ur-Sphinx) write no owner, and none of them is an opponent's cast.
test.each(["Smirking Spelljacker", "Flawless Forgery", "Blue Mage's Cane", "Saruman of Many Colors", "Reversal of Fortune", "Etali, Primal Storm", "The Ur-Sphinx"])("%s: 'you may cast' is your cast, with no owner written", (caster) => {
  const emits = castEmits(caster).filter((s) => s.token !== true);
  expect(emits.length).toBeGreaterThan(0);
  for (const s of emits) { expect(s.control).toBe("you"); expect(s.owner).toBeUndefined(); expect(s.scope).not.toBe("target"); }
});
test.each(["Smirking Spelljacker", "Flawless Forgery"])("%s is no 'whenever an opponent casts a spell' for Rhystic Study", (caster) => {
  expect(castTags(caster, "Rhystic Study")).toEqual([]);
});
test("Smirking Spelljacker still feeds Talrand: you cast the exiled instant or sorcery", () => {
  expect(castTags("Smirking Spelljacker", "Talrand, Sky Summoner")).not.toEqual([]);
});
