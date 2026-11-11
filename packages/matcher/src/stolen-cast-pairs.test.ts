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

// A COPY OF A CARD ANOTHER PLAYER OWNS IS NEVER A DECK-MATE (#1594 review). You own the copy you cast (CR 112.2), so `owner: "opp"` would be untrue; the emit says what it is a copy OF (`copyOf: { owner: "opp" }`),
// and the self join refuses it as it refuses a stolen card. Every class trigger still hears the cast.
const COPY_CASTERS = ["Flawless Forgery", "Blue Mage's Cane", "Reversal of Fortune", "Saruman of Many Colors"];
describe.each(COPY_CASTERS)("%s casts a copy of a card an opponent owns", (caster) => {
  test("the cast emit is yours, owns nothing of theirs, and says what it copies", () => {
    for (const s of castEmits(caster)) expect({ control: s.control, owner: s.owner, copyOf: s.copyOf }).toEqual({ control: "you", owner: undefined, copyOf: { owner: "opp" } });
  });
  test("no self reason with Echo Storm's own 'when you cast this spell'", () => {
    expect(castTags(caster, "Echo Storm")).toEqual([]);
  });
  test.each(["Talrand, Sky Summoner", "Monastery Swiftspear"])("still feeds %s", (payoff) => {
    expect(castTags(caster, payoff)).not.toEqual([]);
  });
});
test("Wildfire Devils copies a card of a player chosen at random, who can be you: nothing says whose card the copy is of", () => {
  for (const s of castEmits("Wildfire Devils")) expect(s.copyOf).toBeUndefined();
});

// #1596 item 2: "WHENEVER YOU CAST A SPELL FROM ANYWHERE OTHER THAN YOUR HAND" (Osgood, Operation Double's Paradox) hears a stolen cast. A card an opponent owns is never in YOUR hand (CR 400.3: an object that would go to
// a hand other than its owner's goes to its owner's), so a cast out of an opponent's hand (`fromZone: hand, owner: opp`: Extract Brain, Mindleech Mass, Silent-Blade Oni) is from somewhere other than your hand, and so is a cast
// of a card the ability exiled (Black Widow, Null Summoner, Kheru Mind-Eater, Maralen, Laughing Jasper Flint). #1594 lost these 8 pairs: their only join had been Osgood's false self trigger.
describe("Osgood, Operation Double's Paradox hears a stolen cast", () => {
  test.each(["Extract Brain", "Mindleech Mass", "Silent-Blade Oni"])("%s casts out of an opponent's hand, which is not your hand", (thief) => {
    expect(castTags(thief, "Osgood, Operation Double")).not.toEqual([]);
  });
  test.each(["Black Widow, Super Spy", "Null Summoner", "Kheru Mind-Eater", "Maralen, Fae Ascendant", "Laughing Jasper Flint"])("%s casts the card it exiled", (thief) => {
    expect(castTags(thief, "Osgood, Operation Double")).not.toEqual([]);
  });
  test("your OWN card cast out of exile is Paradox too: Hidetsugu and Kairi exiles the top card of your library and casts it", () => {
    expect(castTags("Hidetsugu and Kairi", "Osgood, Operation Double")).not.toEqual([]);
  });
  // The refusal that stays (a cast with no origin and no other owner is from your hand) is pinned on the filter itself, subject.test.ts.
});

// #1596 review, block 1: THE PLAYED CARD KEEPS THE CLASS IT WAS TAKEN AS. "Search that player's library for an artifact card and exile it ... you may play that card" (Thada Adel, Acquisitor) casts an artifact, never an instant.
describe("a play of a taken card casts only the class the take names", () => {
  test("Thada Adel takes an artifact card: no instant-or-sorcery payoff hears it (Talrand)", () => {
    expect(castEmits("Thada Adel, Acquisitor").filter((s) => s.type !== "land").map((s) => s.type)).toEqual(["artifact"]);
    expect(castTags("Thada Adel, Acquisitor", "Talrand, Sky Summoner")).toEqual([]);
  });
  test("a take that names no class still casts any spell: Brainstealer Dragon feeds Talrand", () => {
    expect(castTags("Brainstealer Dragon", "Talrand, Sky Summoner")).not.toEqual([]);
  });
});
// #1596 review, block 2: "FROM YOUR LIBRARY / HAND / GRAVEYARD" IS NEVER A CARD AN OPPONENT OWNS (CR 400.3): each of those zones holds only its owner's cards, so a cast with `owner: "opp"` is from the opponent's.
describe("a 'whenever you cast a spell from YOUR <zone>' trigger does not hear a cast of an opponent's card", () => {
  test("Xanathar plays the top of an OPPONENT's library: not Melek's 'from your library'", () => {
    expect(castTags("Xanathar, Guild Kingpin", "Melek, Izzet Paragon")).toEqual([]);
  });
  test("Mindleech Mass casts out of an OPPONENT's hand: not Harness the Storm's 'from your hand'", () => {
    expect(castTags("Mindleech Mass", "Harness the Storm")).toEqual([]);
  });
  test("Memory Plunder casts from an OPPONENT's graveyard: not Secrets of the Dead's 'from your graveyard'", () => {
    expect(castTags("Memory Plunder", "Secrets of the Dead")).toEqual([]);
  });
  test("'whenever A PLAYER casts a spell from a graveyard' still hears it: Memory Plunder -> River Kelpie", () => {
    expect(castTags("Memory Plunder", "River Kelpie")).not.toEqual([]);
  });
  test("your own cast from your graveyard still feeds Secrets of the Dead: Harness the Storm", () => {
    expect(castTags("Harness the Storm", "Secrets of the Dead")).not.toEqual([]);
  });
});
// #1596 review, fix 3: Azula's cast named no class, and a cast emit with no class joins nothing.
test("Azula, Cunning Usurper's cast of the exiled cards is a spell cast: Nita's 'a spell you don't own' and Talrand hear it", () => {
  expect(castTags("Azula, Cunning Usurper", "Nita, Forum Conciliator")).not.toEqual([]);
});

// #1608 item 1: A STOLEN CAST THAT NAMES NO CLASS IS A SPELL. "You may cast that card" of "the top card of that player's library" carried no type at all, and an unclassed cast emit meets no typed cast payoff: Gonti,
// Thief of Sanity and Ragavan formed no pair with Talrand, prowess or Nita's "a spell you don't own". The card can be of any class, so the emit reads `spell`. Still never a deck-mate's own cast.
describe.each(["Gonti, Lord of Luxury", "Thief of Sanity", "Ragavan, Nimble Pilferer", "Rashmi and Ragavan"])("%s casts a stolen card of no named class", (thief) => {
  test.each(["Talrand, Sky Summoner", "Monastery Swiftspear", "Nita, Forum Conciliator"])("feeds %s", (payoff) => {
    expect(castTags(thief, payoff)).not.toEqual([]);
  });
  test.each(["Artisan of Kozilek", "Echo Storm"])("no self reason with %s's own 'when you cast this spell'", (self) => {
    expect(castTags(thief, self)).toEqual([]);
  });
  test("is your cast: no 'whenever an opponent casts a spell' for Rhystic Study", () => {
    expect(castTags(thief, "Rhystic Study")).toEqual([]);
  });
});
// ...and A CLASS-LIMITED TAKE MEETS ONLY ITS CLASS: "If it's an instant or sorcery card, exile it. You may cast it" (Planeswalker's Mischief), "Exile target instant or sorcery card from a graveyard ... cast the copies"
// (Mnemonic Deluge) never cast a creature spell.
test.each(["Planeswalker's Mischief", "Mnemonic Deluge"])("%s casts an instant or sorcery: Talrand hears it, Beast Whisperer's 'a creature spell' does not", (source) => {
  expect(castTags(source, "Talrand, Sky Summoner")).not.toEqual([]);
  expect(castTags(source, "Beast Whisperer")).toEqual([]);
});
// DISCOVER (CR 701.57a) exiles cards until a nonland card and lets YOU cast it: any spell, from exile. Its cast named no class, no origin and no caster.
test("Trumpeting Carnosaur's discover is your cast of a spell from exile: Talrand and Quintorius Kand's 'a spell from exile' hear it, Rhystic Study's 'an opponent casts' does not", () => {
  expect(castTags("Trumpeting Carnosaur", "Talrand, Sky Summoner")).not.toEqual([]);
  expect(castTags("Trumpeting Carnosaur", "Quintorius Kand")).not.toEqual([]);
  expect(castTags("Trumpeting Carnosaur", "Rhystic Study")).toEqual([]);
});
// ...AND "A SPELL YOU DON'T OWN" NEVER HEARS A CARD THAT IS CERTAINLY YOURS (#1608): discover digs YOUR library, Chandra exiles "the top card of your library". Typed `spell`, both would have met Nita and
// Vaan, Street Thief's "whenever you cast a spell you don't own"; the emit says `owner: you` and the matcher refuses it. A stolen card (Gonti) and a pile that can hold either (Etali, Primal Storm) still feed them.
// (Pinned on the discover: Chandra's own emblem hears the spells Vaan steals, a real pair the other way round. Her emit's `owner: you` is pinned in the tagger, cast-class.test.ts.)
test("Trumpeting Carnosaur's discover casts your own card: Talrand hears it, 'a spell you don't own' (Nita, Vaan) does not", () => {
  expect(castTags("Trumpeting Carnosaur", "Talrand, Sky Summoner")).not.toEqual([]);
  expect(castTags("Trumpeting Carnosaur", "Nita, Forum Conciliator")).toEqual([]);
  expect(castTags("Trumpeting Carnosaur", "Vaan, Street Thief")).toEqual([]);
});
test.each(["Gonti, Lord of Luxury", "Etali, Primal Storm"])("%s can cast a card you don't own: Nita and Vaan hear it", (source) => {
  expect(castTags(source, "Nita, Forum Conciliator")).not.toEqual([]);
  expect(castTags(source, "Vaan, Street Thief")).not.toEqual([]);
});
