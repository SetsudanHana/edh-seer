import { describe, expect, test } from "vitest";
import { deriveAsCorpus } from "../derive-worker.js";
import type { SubjectFilter } from "../schema.js";
import { castClassFromPrint, castIsOnlyACondition } from "./cast-class.js";
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
  ["Chandra, Torch of Defiance", "you"], ["Creative Technique", "you"], ["Conspiracy Theorist", "you"], ["Master of Predicaments", "you"],
  ["Malcolm, Alluring Scoundrel", undefined], ["The Ur-Sphinx", undefined], ["Rona, Herald of Invasion // Rona, Tolarian Obliterator", undefined],
] as const)("%s casts a card of no named class that can be yours: type spell, owner %s", (name, owner) => {
  const s = casts(name);
  expect(s.length).toBeGreaterThan(0);
  for (const x of s) expect({ type: x.type, control: x.control, owner: x.owner }).toEqual({ type: "spell", control: "you", owner });
});
// #1608 review: A CAST COPY IS A SPELL YOU OWN, whoever owns the card it copies (CR 112.2: a spell's owner is the player who put it on the stack; a copy has no card behind it). It is never "a spell you don't own".
// The copy of an opponent's card still says what it copies (`copyOf.owner: opp`), which is what keeps it from being a deck-mate.
test.each(["Mnemonic Deluge", "Spelltwine", "Mysterious Stranger", "Spellweaver Helix", "Flawless Forgery", "Isochron Scepter", "Mizzix's Mastery", "Reversal of Fortune", "God-Eternal Kefnet", "Wildfire Devils", "Eye of the Storm"])("%s casts a copy: a spell its caster owns", (name) => {
  const s = casts(name);
  expect(s.length).toBeGreaterThan(0);
  for (const x of s) expect(x.owner).toBe("you");
});
test("Wizard's Spellbook: every row casts a copy, read or unread", () => {
  expect(casts("Wizard's Spellbook").map((x) => x.owner)).toEqual(["you", "you", "you"]);
});
test("Flawless Forgery's copy is yours and still a copy of an opponent's card", () => {
  expect(casts("Flawless Forgery").map((x) => ({ owner: x.owner, copyOf: x.copyOf }))).toEqual([{ owner: "you", copyOf: { owner: "opp" } }]);
});

// DISCOVER (CR 701.57a): "Exile cards from the top of your library until you exile a nonland card with mana value N or less. You may cast that card without paying its mana cost." Your cast of any spell, from exile.
test.each(["Trumpeting Carnosaur", "Hit the Mother Lode", "Quintorius Kand", "Chimil, the Inner Sun", "Brass's Tunnel-Grinder // Tecutlan, the Searing Rift", "U.S.S. Discovery, at Black Alert"])("%s discovers: your cast of a spell you own, from exile", (name) => {
  const s = casts(name);
  expect(s.length).toBeGreaterThan(0);
  for (const x of s) expect({ type: x.type, control: x.control, fromZone: x.fromZone, owner: x.owner }).toEqual({ type: "spell", control: "you", fromZone: "exile", owner: "you" });
});
// ...OF A CARD "WITH MANA VALUE N OR LESS" (#1608 review). Discover 5 never casts a ten-drop: the bound rides the emit as a mana-value stat, which the matcher reads against a card's own cast trigger.
test.each([["Trumpeting Carnosaur", 5], ["Hit the Mother Lode", 10], ["Quintorius Kand", 4], ["Swashbuckler's Whip", 10], ["Geological Appraiser", 3], ["Daring Discovery", 4], ["Long-Range Sensor", 4]] as const)("%s discovers %i: mana value %i or less", (name, n) => {
  const s = casts(name);
  expect(s.length).toBeGreaterThan(0);
  for (const x of s) expect(x.stats).toEqual([{ metric: "mana-value", op: "lte", value: n }]);
});
// CEILING pinned: "discover X" states no number the emit can carry; the cast is unbounded.
test.each(["Pantlaza, Sun-Favored", "Aloy, Savior of Meridian", "Monstrous Vortex", "Brass's Tunnel-Grinder // Tecutlan, the Searing Rift", "Curator of Sun's Creation", "Zoyowa's Justice"])("%s discovers X: no bound is read", (name) => {
  const s = casts(name);
  expect(s.length).toBeGreaterThan(0);
  for (const x of s) expect(x.stats).toBeUndefined();
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

// #1608 item 2: A CAST COPY IS CAST FROM THE ZONE THE COPIED CARD IS IN (CR 707.12). Where the clause exiles the card it copies, or copies an exiled card, that zone is exile, whatever zone the card was exiled from
// (the stored origin of the exile, "graveyard" or "hand", had been inherited by the cast).
test.each(["Flawless Forgery", "Blue Mage's Cane", "Saruman of Many Colors", "Soundwave, Sonic Spy // Soundwave, Superior Captain", "Isochron Scepter", "Mizzix's Mastery", "Mnemonic Deluge", "Spelltwine", "Wildfire Devils",
  "Capricious Hellraiser", "Eye of the Storm", "Arcane Bombardment"])("%s casts a copy of a card in exile: fromZone exile", (name) => {
  const s = casts(name);
  expect(s.length).toBeGreaterThan(0);
  for (const x of s) expect(x.fromZone).toBe("exile");
});
// A copy of a card that is NOT exiled is made where that card is: your hand (God-Eternal Kefnet's revealed draw: no origin stated is the hand), an opponent's hand (Reversal of Fortune: `copyOf` says whose, read by the matcher).
test.each(["God-Eternal Kefnet", "Reversal of Fortune"])("%s copies a card in a hand: no exile origin", (name) => {
  const s = casts(name);
  expect(s.length).toBeGreaterThan(0);
  for (const x of s) expect(x.fromZone).toBeUndefined();
});

// #1608 review: A GATE THAT IS NOT A CARD TYPE IS PART OF THE CLASS. The colour and the mana-value bound the words print ride the emit (`colors`, `stats`), as "nonlegendary" and "monocolored" do (`legendary: false`,
// `colorCount: mono`); typed bare `spell` these casts met every deck-mate's own cast trigger, whatever its colour or cost.
test.each([
  ["Chandra, Dressed to Kill", { colors: ["R"] }], // "If it's red, you may cast it"
  ["Plargg, Dean of Chaos // Augusta, Dean of Order", { legendary: false, stats: [{ metric: "mana-value", op: "lte", value: 3 }] }], // "a nonlegendary, nonland card with mana value 3 or less"
  ["Invasion of Alara // Awaken the Maelstrom", { stats: [{ metric: "mana-value", op: "lte", value: 4 }] }], // "two nonland cards with mana value 4 or less"
  ["Beseech the Mirror", { stats: [{ metric: "mana-value", op: "lte", value: 4 }] }], // "if that spell's mana value is 4 or less"
  ["Bloodthirsty Adversary", { stats: [{ metric: "mana-value", op: "lte", value: 3 }] }], // "instant and/or sorcery cards with mana value 3 or less"
  ["Discover the Impossible", { stats: [{ metric: "mana-value", op: "lte", value: 2 }] }], // "if it's an instant spell with mana value 2 or less"
  ["Emergent Ultimatum", { colorCount: "mono" }], // "up to three monocolored cards"
] as const)("%s: the printed gate rides the cast", (name, gate) => {
  const s = casts(name).filter((x) => x.scope !== "all" || name !== "Chandra, Dressed to Kill");
  expect(s.length).toBeGreaterThan(0);
  for (const x of s) expect(x).toMatchObject(gate);
});
// #1608 re-review: "For each of those colors, you may exile a card OF THAT COLOR ... You may cast the exiled cards" (Sanar, Innovative First-Year). Which colour is a relation to her board, but a colourless card is
// never "a card of that color": the cast is of a coloured card (`colorCount: colored`).
test("Sanar, Innovative First-Year casts cards 'of that color': a coloured card, never a colourless one", () => {
  expect(casts("Sanar, Innovative First-Year").map((x) => ({ type: x.type, colorCount: x.colorCount }))).toEqual([{ type: "spell", colorCount: "colored" }]);
});
// CEILING pinned: a gate no field can hold leaves the cast unclassed and silent, as at 501. "You may cast it without paying its mana cost if its mana value is odd" (Yennett) is the card's whole point.
test("Yennett, Cryptic Sovereign: an odd mana value is no class the emit can carry; the cast stays unclassed", () => {
  expect(casts("Yennett, Cryptic Sovereign").map((x) => x.type)).toEqual([undefined]);
});

// #1609: A CAST THE WORDS TAKE FROM YOUR OWN ZONE IS OF A CARD YOU OWN, whether or not 502 had to type it. "You may play lands and cast spells from the top of your library" (Future Sight), "look at the top card of your
// library. You may cast it" (Galvanoth), "cast an instant or sorcery spell ... from your hand" (Founding the Third Path, chapter I) stated a class and so were never given an owner.
test.each(["Future Sight", "Galvanoth", "Founding the Third Path"])("%s casts from your own library or hand: owner you on every cast", (name) => {
  const s = casts(name);
  expect(s.length).toBeGreaterThan(0);
  for (const x of s) expect(x.owner).toBe("you");
});
// #1613 review: AN IMPERATIVE CAST IS A CAST TOO. "Cast any number of red instant and/or sorcery cards from your graveyard" (Chandra Ablaze) and "Search your library for a red or white instant card ... and cast that card"
// (Sunforger) print no "you may", so the owner reading found no permission. And a pile named only in a CONDITION is not the source: "you may cast a spell from the top of your library if it shares a card type with a
// card exiled with this creature" (Cemetery Illuminator) casts off your library.
test.each(["Chandra Ablaze", "Sunforger", "Cemetery Illuminator"])("%s casts a card from your own graveyard or library: owner you", (name) => {
  const s = casts(name);
  expect(s.length).toBeGreaterThan(0);
  for (const x of s) expect({ control: x.control, owner: x.owner }).toEqual({ control: "you", owner: "you" });
});
// ...and A DISCOVER WHOSE STORED CAST ALREADY SAID `spell` is still a discover (CR 701.57a): your cast, of a card you own, from exile. "Discover X, where X is that spell's mana value" (Hurl into History) is unbounded.
test("Hurl into History discovers X: your cast of a spell you own from exile, no bound", () => {
  expect(casts("Hurl into History").map((x) => ({ type: x.type, control: x.control, owner: x.owner, fromZone: x.fromZone, stats: x.stats }))).toEqual([{ type: "spell", control: "you", owner: "you", fromZone: "exile", stats: undefined }]);
});
// A zone named only by the TRIGGER is not where the card cast comes from: "Whenever a player casts a spell from their hand, that player exiles it. If the player does, they may cast a spell from among other cards exiled
// with this artifact" (Knowledge Pool) casts out of a pile every player's library filled, so the caster can cast another player's card and no owner is written.
test("Knowledge Pool: 'from their hand' is the trigger's spell, the cast is from the shared pile: no owner", () => {
  const s = casts("Knowledge Pool");
  expect(s.length).toBeGreaterThan(0);
  for (const x of s) expect(x.owner).toBeUndefined();
});
test("Etali, Primal Storm exiles the top card of EACH player's library: no owner is written", () => {
  expect(casts("Etali, Primal Storm").map((x) => x.owner)).toEqual([undefined]);
});

// #1614: A CONDITION FILED AS A CAST IS NO CAST. The stored answer of 17 cards holds a `cast` action whose clause grants no cast: the trigger's intervening if ("if you cast it"), a condition on the mana spent ("if {W} was
// spent to cast it") or a reference to a later spell ("the next spell you cast this turn"). The card casts nothing there, so the row carries no cast emit at all, self or not.
const allCasts = (name: string) => rowOf(name).tags.abilities.flatMap((a) => a.emits ?? []).filter((e) => e.verb === "cast");
test.each([
  "Iridescent Tiger", "Lutri, the Spellchaser", "The Sibsig Ceremony", "The One Ring", "Territory Forge", "Ran and Shaw", "Radiant Performer", "Crackling Spellslinger", // "if you cast it / them"
  "Revenant Patriarch", "Drowner of Truth // Drowned Jungle", "Gruul Scrapper", "Jaded Sell-Sword", "Marut", "Lavinia, Azorius Renegade", "Ancient Cellarspawn", "The Prima Vista", // "... was spent to cast it"
  "Flamehold Grappler", // "copy the next spell you cast this turn"
])("%s: the 'cast' in its clause is a condition or a reference, the row emits no cast", (name) => {
  expect(allCasts(name)).toEqual([]);
});
// The Prima Vista's misfiled cast is the clause's ONLY action, and it holds the card's real effect ("becomes an artifact creature until end of turn"): nothing is derived beside it, so the action stays unclaimed and the
// dropped-clauses ratchet still sees the unread effect (#1614 review).
test("The Prima Vista: a condition-only cast that is the clause's only action stays unclaimed", () => {
  expect((rowOf("The Prima Vista").tags.unclaimed ?? []).map((a) => a.verb)).toContain("cast");
  expect((rowOf("Lutri, the Spellchaser").tags.unclaimed ?? []).map((a) => a.verb)).not.toContain("cast");
});
test("the rest of the clause is untouched: Lutri still copies, The Sibsig Ceremony still destroys and makes its Zombie Druid, Lavinia still counters", () => {
  const verbs = (name: string) => rowOf(name).tags.abilities.flatMap((a) => a.emits ?? []).map((e) => e.verb);
  expect(verbs("Lutri, the Spellchaser")).toContain("copy");
  expect(verbs("The Sibsig Ceremony")).toEqual(expect.arrayContaining(["dies", "create-token"]));
  expect(verbs("Lavinia, Azorius Renegade")).toContain("counter-spell");
});
// A real cast beside the same condition stays: "When this creature enters, if you cast it, discover 3" (Geological Appraiser) discovers; "you may cast it from your graveyard" (Mosswood Dreadknight) and a keyword
// line that prints no cast word ("Beam me up {3}{G}", Adversary by Algorithm) are casts.
test.each(["Geological Appraiser", "Mosswood Dreadknight // Dread Whispers", "Adversary by Algorithm"])("%s: a real cast keeps its emit", (name) => {
  expect(allCasts(name).length).toBeGreaterThan(0);
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

describe("castIsOnlyACondition", () => {
  test.each([
    "When this creature enters, if you cast it, add {W}{U}{B}{R}{G}.",
    "When this creature enters, if {W} was spent to cast it, target player skips their next combat phase.",
    "Whenever you cast a spell, if the amount of mana spent to cast it was less than its mana value, target opponent loses life equal to the difference.",
    "When this creature enters, copy the next spell you cast this turn when you cast it. You may choose new targets for the copy.",
  ])("a condition or a reference: %s", (text) => { expect(castIsOnlyACondition(text)).toBe(true); });
  test.each([
    "When this creature enters, if you cast it, discover 3.",
    "When this creature dies, you may cast it from your graveyard as an Adventure until the end of your next turn.",
    "Beam me up {3}{G}",
    "Exile the top card of your library. You may cast that card.",
    "When this creature enters, if you cast it, you may cast target instant card from your graveyard.",
  ])("a real cast: %s", (text) => { expect(castIsOnlyACondition(text)).toBe(false); });
});
