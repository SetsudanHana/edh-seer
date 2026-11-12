import { describe, expect, test } from "vitest";
import { deriveAsCorpus } from "../derive-worker.js";
import type { SubjectFilter } from "../schema.js";
import fixtures from "./stolen-play.fixtures.json" with { type: "json" };

/** #1596 item 1: "YOU MAY PLAY THAT CARD / THOSE CARDS" OF A CARD TAKEN FROM ANOTHER PLAYER derived no cast and no land play at all (a `play` emitted only where its object was a land). To play a card is to play it as a land or
 *  cast it as a spell (CR 701.18b), so such a permission is both: a cast and a land play, yours (CR 112.2), of a card its owner still owns (CR 108.3).
 *  Card documents and stored `cardClauses` dumped from Mongo 2026-11-11 (DERIVE 496); derived as derive-corpus derives them (`deriveAsCorpus`: the grammar's records where the grammar reads the card completely). */
type Fx = { source: Record<string, unknown>; canonical?: unknown[]; segmentHash?: string };
const rowOf = (name: string) => {
  const f = (fixtures as unknown as Record<string, Fx>)[name]!;
  return deriveAsCorpus({ doc: { oracleId: name, name, canonical: f.canonical ?? [], segmentHash: f.segmentHash } as never, source: f.source, isToken: false });
};
const emits = (name: string, verb: string): SubjectFilter[] => rowOf(name).tags.abilities.flatMap((a) => a.emits ?? []).filter((e) => e.verb === verb && e.subject.self !== true).map((e) => e.subject);

const THIEVES = [
  // the permission points back at what this ability took: "that card", "those cards", "it", "the exiled card(s)", "one of those cards"
  "Brainstealer Dragon", "Praetor's Grasp", "Siphon Insight", "Gonti, Canny Acquisitor", "Thada Adel, Acquisitor", "Fiend of the Shadows", "Knacksaw Clique", "Petty Larceny", "Ornate Kanzashi", "Fallen Shinobi", "Fire Lord Ozai",
  "Edward Kenway", "Korvold and the Noble Thief", "Kotose, the Silent Spider", "Breeches, Brazen Plunderer", "Reno and Rude", "Inside Information",
  // the stored answer left the permission out, or filed it as a grant: read off the printed sentence
  "Black Cat, Cunning Thief", "Dream-Thief's Bandana", "Mindleecher", "Predators' Hour", "Decadent Dragon // Expensive Taste", "Klaw, Master of Sound", "Ixhel, Scion of Atraxa", "Grinning Totem",
  // the permission names a pile another ability of the card fills, or the owner
  "Lobelia, Defender of Bag End", "Rogue Class", "Valgavoth, Terror Eater", "Dauthi Voidwalker", "Tinybones, Bauble Burglar", "Xanathar, Guild Kingpin",
];
describe.each(THIEVES)("%s: 'you may play' a card another player owns", (thief) => {
  test("is YOUR cast of a card an opponent owns", () => {
    const cast = emits(thief, "cast");
    expect(cast.length).toBeGreaterThan(0);
    for (const s of cast) expect({ control: s.control, owner: s.owner }).toEqual({ control: "you", owner: "opp" });
  });
  test("and YOUR land play of a land an opponent owns", () => {
    const land = emits(thief, "land-play");
    expect(land.length).toBeGreaterThan(0);
    for (const s of land) expect({ control: s.control, owner: s.owner, type: s.type }).toEqual({ control: "you", owner: "opp", type: "land" });
  });
});
test("Azula, Cunning Usurper: 'you may cast cards exiled with Azula' is a cast though the sentence also grants flash; 'cast' is no land play", () => {
  const cast = emits("Azula, Cunning Usurper", "cast");
  expect(cast.length).toBeGreaterThan(0);
  // `type: spell` (#1596 review): a cast emit that names no class joins no cast payoff. The real pair is pinned in the matcher, stolen-cast-pairs.test.ts (Azula -> Nita, Forum Conciliator's "a spell you don't own").
  for (const s of cast) expect({ control: s.control, owner: s.owner, type: s.type }).toEqual({ control: "you", owner: "opp", type: "spell" });
  expect(emits("Azula, Cunning Usurper", "land-play")).toEqual([]);
});
// A MIXED SOURCE: each player's library, a target player's cards. You may play your own card too, so no owner is written.
describe.each(["Mezzio Mugger", "Lidless Gaze", "Evelyn, the Covetous", "Extract Power", "Nashi, Moon Sage's Scion", "Rakdos, the Muscle", "Muse Vessel", "Triple Triad"])("%s: a source that can hold your own card", (mixed) => {
  test("is your cast and your land play, with no owner", () => {
    const cast = emits(mixed, "cast"), land = emits(mixed, "land-play");
    expect(cast.length).toBeGreaterThan(0);
    expect(land.length).toBeGreaterThan(0);
    for (const s of [...cast, ...land]) expect({ control: s.control, owner: s.owner }).toEqual({ control: "you", owner: undefined });
  });
});
// CEILING pinned: a play of a card off YOUR OWN library derives no cast, as before (296 corpus cards print "you may play" with no cast emit at DERIVE 496; the thieves and the mixed sources are the ones this change reads).
test.each(["Professional Face-Breaker", "Jeska's Will", "Light Up the Stage", "Act on Impulse"])("%s plays cards off your own library: unchanged, no cast and no land play", (own) => {
  expect(emits(own, "cast")).toEqual([]);
  expect(emits(own, "land-play")).toEqual([]);
});

// #1596 item 2: A CAST OF AN EXILED CARD SAYS SO. "The exiled card", "cards exiled with this creature", "from among those cards" after the ability's own exile: the cast is from exile, which "whenever you cast a spell from anywhere
// other than your hand" (Osgood, Operation Double) and "from exile" payoffs read. These five carried no origin, and an unstated origin is the hand.
test.each(["Black Widow, Super Spy", "Null Summoner", "Kheru Mind-Eater", "Maralen, Fae Ascendant", "Laughing Jasper Flint"])("%s casts the card it exiled: fromZone exile", (thief) => {
  const s = [...emits(thief, "cast"), ...emits(thief, "land-play")];
  expect(s.length).toBeGreaterThan(0);
  for (const x of s) expect({ fromZone: x.fromZone, owner: x.owner }).toEqual({ fromZone: "exile", owner: "opp" });
});
// A cast out of an OPPONENT's hand keeps `fromZone: hand` beside `owner: opp`: that is where the card is (CR 400.3: only its owner's hand can hold it). The matcher reads the two together.
test.each(["Extract Brain", "Mindleech Mass", "Silent-Blade Oni"])("%s casts from an opponent's hand: fromZone hand, owner opp", (thief) => {
  const s = emits(thief, "cast");
  expect(s.length).toBeGreaterThan(0);
  for (const x of s) expect({ fromZone: x.fromZone, owner: x.owner }).toEqual({ fromZone: "hand", owner: "opp" });
});

// #1596 item 3: A PILE NAMED BY ITS COUNTER. "You may cast a spell from among cards in exile with page counters on them" (Tasha, the Witch Queen) names no player, but the only ability that puts a page counter on a card exiles it
// "from that player's graveyard" "for each opponent": the pile holds opponents' cards only.
test("Tasha, the Witch Queen: the page-counter pile is fed from opponents' graveyards only, so the cast is of a card an opponent owns", () => {
  const s = emits("Tasha, the Witch Queen", "cast");
  expect(s.length).toBeGreaterThan(0);
  for (const x of s) expect({ control: x.control, owner: x.owner, counter: x.counter, fromZone: x.fromZone }).toEqual({ control: "you", owner: "opp", counter: "page", fromZone: "exile" });
});
test("a counter pile fed from each player's library (Evelyn's collection counters), or by another card (Haldan's fetch counters, put by Pako), proves no owner", () => {
  for (const name of ["Evelyn, the Covetous", "Haldan, Avid Arcanist"]) {
    const s = [...emits(name, "cast"), ...emits(name, "land-play")];
    expect(s.length, name).toBeGreaterThan(0);
    for (const x of s) expect(x.owner, name).toBeUndefined();
  }
});

// #1596 item 4: A REPEATED CAST PRONOUN IS THE SAME CARD. "Exile the top card of target opponent's library and create a Treasure token. Then you may cast the exiled card ... If you don't cast it this way, you may cast it this turn"
// (Rashmi and Ragavan): the second cast's "it" walked back past "the exiled card" (a reference) to the nearest named thing, the Treasure token, so the engine cast a Treasure.
test("Rashmi and Ragavan: both casts are of the exiled card an opponent owns, never of the Treasure token", () => {
  const s = emits("Rashmi and Ragavan", "cast");
  expect(s.length).toBeGreaterThan(0);
  for (const x of s) {
    expect({ control: x.control, owner: x.owner, fromZone: x.fromZone }).toEqual({ control: "you", owner: "opp", fromZone: "exile" });
    expect(x.token).not.toBe(true);
    expect(x.subtype).toBeUndefined();
  }
  // The Treasure is still created.
  expect(emits("Rashmi and Ragavan", "create-token").some((x) => x.subtype === "treasure")).toBe(true);
});

// #1596 item 5 (pin, no engine change): "THEY MAY CAST IT" IS NOT YOUR CAST. Audacious Swap ("The owner of target nonenchantment permanent ... they may cast it without paying its mana cost") and Tibalt's Trickery ("Its controller
// ... They may cast that card") let ANOTHER player cast. Since DERIVE 494 (#1591) a pronoun actor no longer takes the controller default, so the caster stays `any` (the target's owner or the spell's controller can be you or an
// opponent); nothing writes `you`, and no owner is claimed. Stored rows at 497 read the same (queried 2026-11-11).
// #1608 review: Audacious Swap's caster exiles the top card of THEIR OWN library, so the card cast is the caster's (`owner: you` beside `control: any`: the caster's own card, never "a spell you don't own").
// Tibalt's Trickery reveals cards from "its controller"'s library, the same; nothing wrote an owner for it and none is claimed.
test.each([["Audacious Swap", "you"], ["Tibalt's Trickery", undefined]] as const)("%s: 'they may cast' reads the caster as any player, never as you; owner %s", (name, owner) => {
  const s = emits(name, "cast");
  expect(s.length).toBeGreaterThan(0);
  for (const x of s) expect({ control: x.control, owner: x.owner }).toEqual({ control: "any", owner });
});

// #1596 item 7 (CEILING pinned, see ANOTHER_PLAYERS_CARD in derive.ts): "that player's" / "their" is read as another player's with no antecedent check. The two corpus rows a naive check would strip of their owner are right as
// they stand: Grenzo's "that player" is the damaged player its modal header names (another clause), Elder Brain's the player it attacked. A future antecedent check must keep both.
test.each(["Grenzo, Havoc Raiser", "Elder Brain"])("%s: 'that player' is an opponent though this clause does not say so; the cast keeps owner opp", (name) => {
  const s = [...emits(name, "cast"), ...emits(name, "land-play")];
  expect(s.length).toBeGreaterThan(0);
  for (const x of s) expect({ control: x.control, owner: x.owner }).toEqual({ control: "you", owner: "opp" });
});

// #1596 review, fix 4: ONE STORED `play` THAT HOLDS BOTH HALVES. "You may play lands and cast spells from among cards exiled this way" stored as a single play ("lands and spells from among ...") derived the land play and no cast.
test.each([["Gix, Yawgmoth Praetor", "opp"], ["Sen Triplets", "opp"], ["Magus of the Mind", undefined], ["Jacob Hauken, Inspector // Hauken's Insight", undefined]] as const)("%s: 'play lands and cast spells' is a cast too (owner %s)", (name, owner) => {
  const cast = emits(name, "cast"), land = emits(name, "land-play");
  expect(land.length).toBeGreaterThan(0);
  expect(cast.length).toBeGreaterThan(0);
  for (const x of cast) expect({ control: x.control, owner: x.owner, type: x.type }).toEqual({ control: "you", owner, type: "spell" });
});
// ...and the origin is read off each permission's own sentence: "You may play those cards this turn. You may play an additional land this turn" (Sword of Forge and Frontier): the additional land is no exiled card.
test("Sword of Forge and Frontier: the additional land play is not 'from exile'", () => {
  const land = emits("Sword of Forge and Frontier", "land-play");
  expect(land.length).toBeGreaterThan(0);
  for (const x of land) expect(x.fromZone).toBeUndefined();
});

// #1596 review, block 1: the cast of a played card names the class its take names. Of the 39 play permissions read at 497, Thada Adel's is the only take that names one ("an artifact card").
const MIXED = ["Mezzio Mugger", "Lidless Gaze", "Evelyn, the Covetous", "Extract Power", "Nashi, Moon Sage's Scion", "Rakdos, the Muscle", "Muse Vessel", "Triple Triad"];
test("Thada Adel, Acquisitor casts an artifact; every other play permission names no class and casts any spell", () => {
  expect(emits("Thada Adel, Acquisitor", "cast").map((x) => x.type)).toEqual(["artifact"]);
  for (const name of [...THIEVES, ...MIXED].filter((n) => n !== "Thada Adel, Acquisitor")) expect(emits(name, "cast").map((x) => x.type), name).toEqual(["spell"]);
});

// #1608 item 3: THE BOTH-HALVES PERMISSION STATES ITS ORIGIN. "You may play lands and cast spells from that player's hand" (Sen Triplets) is cast out of the opponent's hand; "from among cards you own in exile with croak
// counters on them" (Grolnok, the Omnivore) out of exile. Both emits carried no origin, which reads as your own hand.
test("Sen Triplets plays and casts from that player's hand: fromZone hand beside owner opp", () => {
  const s = [...emits("Sen Triplets", "cast"), ...emits("Sen Triplets", "land-play")];
  expect(s.length).toBe(2);
  for (const x of s) expect({ fromZone: x.fromZone, owner: x.owner, control: x.control }).toEqual({ fromZone: "hand", owner: "opp", control: "you" });
});
test("Grolnok, the Omnivore plays and casts cards you own in exile: fromZone exile, owner you", () => {
  const s = [...emits("Grolnok, the Omnivore", "cast"), ...emits("Grolnok, the Omnivore", "land-play")];
  expect(s.length).toBe(2);
  for (const x of s) expect({ fromZone: x.fromZone, owner: x.owner, control: x.control }).toEqual({ fromZone: "exile", owner: "you", control: "you" });
});

// #1608 item 4: THE CARD CAST IS THE ONE EXILED, NOT THE PERMANENT TARGETED. "The owner of target nonenchantment permanent shuffles it into their library, then exiles the top card of their library. If it's a land card, they
// put it onto the battlefield. Otherwise, they may cast it" (Audacious Swap): the cast's "it" is the exiled top card, of any class. The emit carried the target's class (`notType: enchantment`, `scope: target`).
test("Audacious Swap: the cast is of the exiled top card, any spell, not of the targeted nonenchantment permanent", () => {
  const s = emits("Audacious Swap", "cast");
  expect(s.length).toBe(1);
  expect({ type: s[0]!.type, notType: s[0]!.notType, scope: s[0]!.scope, fromZone: s[0]!.fromZone, control: s[0]!.control }).toEqual({ type: "spell", notType: undefined, scope: undefined, fromZone: "exile", control: "any" });
});

// #1611: GROLNOK'S PILE HOLDS PERMANENT CARDS ONLY. "Whenever a permanent card is put into your graveyard from your library, exile it with a croak counter on it. You may play lands and cast spells from among cards you own
// in exile with croak counters on them": the only ability that puts a croak counter on a card exiles a permanent card, so the cast is of a permanent spell, never of an instant or sorcery.
test("Grolnok, the Omnivore casts permanent spells only: the class of the card its own ability exiles with a croak counter", () => {
  const cast = emits("Grolnok, the Omnivore", "cast");
  expect(cast.map((x) => ({ type: x.type, umbrella: x.umbrella }))).toEqual([{ type: ["creature", "artifact", "enchantment", "planeswalker", "battle"], umbrella: "permanent" }]);
  // The land play is untouched: a land is a permanent card.
  expect(emits("Grolnok, the Omnivore", "land-play").map((x) => x.type)).toEqual(["land"]);
});
// The other both-halves permissions name no counter pile and keep `spell`.
test.each(["Gix, Yawgmoth Praetor", "Sen Triplets", "Magus of the Mind"])("%s: no counter pile, the cast stays any spell", (name) => {
  expect(emits(name, "cast").map((x) => x.type)).toEqual(["spell"]);
});
