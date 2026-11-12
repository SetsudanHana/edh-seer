import { describe, expect, test } from "vitest";
import { counterAddMatches, graveyardFillMatches, isEveryoneEdict, subjectMatches } from "./subject.js";
import { isOutlaw } from "./implied.js";
import { parseSubject } from "@edh-seer/tagger";
import type { SubjectFilter } from "@edh-seer/tagger";
import type { Hierarchy } from "./types.js";

const H: Hierarchy = { wizard: ["creature"], zombie: ["creature"], treasure: ["artifact"], pirate: ["creature"], bear: ["creature"], dragon: ["creature"], ogre: ["creature"], demon: ["creature"], land: ["land"] };
const s = (o: Partial<SubjectFilter>): SubjectFilter => ({ control: "you", token: null, ...o });

test("consumer type is satisfied by a producer subtype via the hierarchy", () => {
  expect(subjectMatches(s({ subtype: "wizard" }), s({ type: "creature" }), H)).toBe(true);
});

test("consumer subtype requires the producer to be that subtype", () => {
  expect(subjectMatches(s({ type: "creature" }), s({ subtype: "wizard" }), H)).toBe(false);
  expect(subjectMatches(s({ subtype: "wizard" }), s({ subtype: "wizard" }), H)).toBe(true);
});

test("OR arrays match if any branch matches", () => {
  expect(subjectMatches(s({ subtype: "wizard" }), s({ type: ["artifact", "creature"] }), H)).toBe(true);
  expect(subjectMatches(s({ subtype: "treasure" }), s({ type: ["creature"] }), H)).toBe(false);
});

test("control matches equal or via any wildcard, else fails", () => {
  expect(subjectMatches(s({ control: "you" }), s({ control: "you" }), H)).toBe(true);
  expect(subjectMatches(s({ control: "you" }), s({ control: "any" }), H)).toBe(true);
  expect(subjectMatches(s({ control: "you" }), s({ control: "opp" }), H)).toBe(false);
});

test("token tri-state gates the match", () => {
  expect(subjectMatches(s({ token: true }), s({ token: null }), H)).toBe(true);
  expect(subjectMatches(s({ token: true }), s({ token: false }), H)).toBe(false);
  expect(subjectMatches(s({ token: false }), s({ token: true }), H)).toBe(false);
});

test("counter and zone gates require equality when the consumer names them", () => {
  expect(subjectMatches(s({ counter: "+1/+1" }), s({ counter: "+1/+1" }), H)).toBe(true);
  expect(subjectMatches(s({}), s({ counter: "+1/+1" }), H)).toBe(false);
  expect(subjectMatches(s({ zone: "graveyard" }), s({ zone: "graveyard" }), H)).toBe(true);
});

const HH: Hierarchy = { zombie: ["creature"] };

test("untyped fill satisfies a typed graveyard consumer", () => {
  const fill: SubjectFilter = { control: "you", token: null, zone: "graveyard" };
  const consumer: SubjectFilter = { control: "you", token: null, zone: "graveyard", type: "creature" };
  expect(graveyardFillMatches(fill, consumer, HH)).toBe(true);
});

test("typed dies-fill matches a creature consumer via hierarchy", () => {
  const fill: SubjectFilter = { control: "you", token: null, zone: "graveyard", subtype: "zombie" };
  const consumer: SubjectFilter = { control: "you", token: null, zone: "graveyard", type: "creature" };
  expect(graveyardFillMatches(fill, consumer, HH)).toBe(true);
});

test("control gate stays strict: opp fill does not feed a you-only consumer", () => {
  const fill: SubjectFilter = { control: "opp", token: null, zone: "graveyard" };
  const consumer: SubjectFilter = { control: "you", token: null, zone: "graveyard", type: "creature" };
  expect(graveyardFillMatches(fill, consumer, HH)).toBe(false);
});

test("zone gate stays strict: a battlefield producer does not match a graveyard consumer", () => {
  const fill: SubjectFilter = { control: "you", token: null, zone: "battlefield" };
  const consumer: SubjectFilter = { control: "you", token: null, zone: "graveyard" };
  expect(graveyardFillMatches(fill, consumer, HH)).toBe(false);
});

test("untyped proliferate counter-added matches a typed +1/+1 counter payoff", () => {
  const fill: SubjectFilter = { control: "you", token: null };
  const consumer: SubjectFilter = { control: "you", token: null, counter: "+1/+1", type: "creature" };
  expect(counterAddMatches(fill, consumer, HH)).toBe(true);
});

test("a permanent-bound kindless counter never feeds a player-counter payoff; an untyped one still can", () => {
  const energy: SubjectFilter = { control: "you", token: null, counter: "energy" };
  expect(counterAddMatches({ control: "any", token: null, self: true }, energy, HH)).toBe(false);
  expect(counterAddMatches({ control: "any", token: null, type: "creature" }, { control: "you", token: null, counter: "poison" }, HH)).toBe(false);
  expect(counterAddMatches({ control: "you", token: null }, energy, HH)).toBe(true);
  expect(counterAddMatches({ control: "you", token: null, counter: "energy" }, energy, HH)).toBe(true);
});

test("control gate stays strict: an opp untyped counter-added does not feed a you-only payoff", () => {
  const fill: SubjectFilter = { control: "opp", token: null };
  const consumer: SubjectFilter = { control: "you", token: null, counter: "+1/+1" };
  expect(counterAddMatches(fill, consumer, HH)).toBe(false);
});

test("a typed counter producer delegates to subjectMatches (kind must match)", () => {
  const plus: SubjectFilter = { control: "you", token: null, counter: "+1/+1" };
  const minus: SubjectFilter = { control: "you", token: null, counter: "-1/-1" };
  const consumerPlus: SubjectFilter = { control: "you", token: null, counter: "+1/+1" };
  expect(counterAddMatches(plus, consumerPlus, HH)).toBe(true);
  expect(counterAddMatches(minus, consumerPlus, HH)).toBe(false);
});

test("noncreature consumer matches an instant/sorcery producer (Whirlwind of Thought)", () => {
  expect(subjectMatches(s({ type: "instant" }), s({ type: "noncreature" }), H)).toBe(true);
  expect(subjectMatches(s({ type: "sorcery" }), s({ type: "noncreature" }), H)).toBe(true);
});

test("noncreature rejects a creature producer, in both directions", () => {
  expect(subjectMatches(s({ type: "creature" }), s({ type: "noncreature" }), H)).toBe(false);
  expect(subjectMatches(s({ type: "noncreature" }), s({ type: "creature" }), H)).toBe(false);
});

test("permanent umbrella matches its member types but not instants", () => {
  expect(subjectMatches(s({ type: "creature" }), s({ type: "permanent" }), H)).toBe(true);
  expect(subjectMatches(s({ type: "artifact" }), s({ type: "permanent" }), H)).toBe(true);
  expect(subjectMatches(s({ type: "instant" }), s({ type: "permanent" }), H)).toBe(false);
});

test("spell umbrella matches castable types but not lands", () => {
  expect(subjectMatches(s({ type: "instant" }), s({ type: "spell" }), H)).toBe(true);
  expect(subjectMatches(s({ type: "creature" }), s({ type: "spell" }), H)).toBe(true);
  expect(subjectMatches(s({ type: "land" }), s({ type: "spell" }), H)).toBe(false);
});

test("permanent pseudo-type works on the producer side too (symmetric)", () => {
  expect(subjectMatches(s({ type: "permanent" }), s({ type: "creature" }), H)).toBe(true);
});

test("an untyped producer does not satisfy a noncreature consumer", () => {
  expect(subjectMatches(s({}), s({ type: "noncreature" }), H)).toBe(false);
});

// A — value predicate: small creature matches "power ≤ 2", big one does not.
test("subjectMatches gates a value predicate on the producer's concrete power", () => {
  const consumer = { type: "creature", control: "you", token: null, stats: [{ metric: "power", op: "lte", value: 2 }] } as const;
  const small = { type: "creature", control: "you", token: false, power: 1, toughness: 1 };
  const big = { type: "creature", control: "you", token: false, power: 5, toughness: 5 };
  expect(subjectMatches(small as never, consumer as never, {})).toBe(true);
  expect(subjectMatches(big as never, consumer as never, {})).toBe(false);
});

// B — relational predicate: wall (t≥p) matches, beater (p>t) does not.
test("subjectMatches gates a relational predicate (toughness ≥ power)", () => {
  const consumer = { type: "creature", control: "you", token: null, stats: [{ metric: "toughness", op: "gte", vs: "power" }] } as const;
  const wall = { type: "creature", control: "you", token: false, power: 0, toughness: 6 };
  const beater = { type: "creature", control: "you", token: false, power: 5, toughness: 2 };
  expect(subjectMatches(wall as never, consumer as never, {})).toBe(true);
  expect(subjectMatches(beater as never, consumer as never, {})).toBe(false);
});

// Missing producer stats default to 0.
test("subjectMatches treats a missing producer stat as 0", () => {
  const consumer = { control: "you", token: null, stats: [{ metric: "power", op: "lte", value: 2 }] } as const;
  const noStats = { type: "creature", control: "you", token: false }; // power/toughness undefined
  expect(subjectMatches(noStats as never, consumer as never, {})).toBe(true); // 0 ≤ 2
});

// No stats on consumer → unchanged behavior.
test("subjectMatches ignores stats when the consumer sets none", () => {
  const consumer = { type: "creature", control: "you", token: null } as const;
  const big = { type: "creature", control: "you", token: false, power: 9, toughness: 9 };
  expect(subjectMatches(big as never, consumer as never, {})).toBe(true);
});

// A colour on the FILTER side must exclude cards outside it. SubjectFilter has carried `colors`
// since the graph work and edges.ts counts it as naming-its-targets, but nothing enforced it —
// so a filter reading "blue permanent spells" matched every permanent of any colour.
test("subjectMatches enforces a colour the filter names", () => {
  const filter = { type: "permanent", control: "you", token: null, colors: ["U"] } as const;
  const blueCard = { type: ["creature"], control: "you", token: false, colors: ["U"] };
  const blackCard = { type: ["creature"], control: "you", token: false, colors: ["B"] };
  expect(subjectMatches(blueCard as never, filter as never, {})).toBe(true);
  expect(subjectMatches(blackCard as never, filter as never, {})).toBe(false);
});

// Multicolour is an OR on both sides: a Dimir card satisfies "blue spells", and a filter naming
// two colours accepts a card in either.
test("subjectMatches treats colours as an intersection, not an equality", () => {
  const blueFilter = { control: "you", token: null, colors: ["U"] } as const;
  const dimir = { type: ["creature"], control: "you", token: false, colors: ["U", "B"] };
  expect(subjectMatches(dimir as never, blueFilter as never, {})).toBe(true);

  const twoColourFilter = { control: "you", token: null, colors: ["B", "R"] } as const;
  const mono = { type: ["creature"], control: "you", token: false, colors: ["R"] };
  expect(subjectMatches(mono as never, twoColourFilter as never, {})).toBe(true);
});

// A filter that says nothing about colour must not start rejecting colourless cards.
test("subjectMatches ignores colour when the filter names none", () => {
  const filter = { type: "artifact", control: "you", token: null } as const;
  const colourless = { type: ["artifact"], control: "you", token: false, colors: [] };
  expect(subjectMatches(colourless as never, filter as never, {})).toBe(true);
});

// A consumer that demands a TOKEN is not satisfied by a producer whose token-ness is unknown.
// Nadier's Nightblade triggers on "a token you control leaves the battlefield"; Imskir Iron-Eater's
// "Sacrifice an artifact" emits token: null, meaning UNSPECIFIED, and null was read as a wildcard --
// so sacrificing a Sol Ring counted as sacrificing a token.
test("subjectMatches requires a real token when the consumer demands one", () => {
  const wantsToken = { control: "you", token: true } as const;
  const unknown = { type: "artifact", control: "any", token: null };
  const realToken = { type: "artifact", control: "you", token: true };
  expect(subjectMatches(unknown as never, wantsToken as never, {})).toBe(false);
  expect(subjectMatches(realToken as never, wantsToken as never, {})).toBe(true);
});

// The reverse stays a wildcard. `token: false` means "nontoken", which nearly every permanent
// already is, and treating it as a real condition once let 14 triggers draw edges from the whole
// creature pool -- the mesh this file's existing comment warns about.
test("subjectMatches keeps null as a wildcard against a NONTOKEN consumer", () => {
  const wantsNontoken = { control: "you", token: false } as const;
  const unknown = { type: "creature", control: "you", token: null };
  expect(subjectMatches(unknown as never, wantsNontoken as never, {})).toBe(true);
});

// A disjunctive subject is satisfied by EITHER branch, with the shared fields applying to both.
test("anyOf matches a producer satisfying either branch", () => {
  const consumer = {
    control: "you" as const, token: null,
    anyOf: [{ type: "creature" }, { subtype: "vehicle" }],
  };
  const creature = { control: "you" as const, token: null, type: "creature" };
  const vehicle = { control: "you" as const, token: null, type: "artifact", subtype: "vehicle" };
  const neither = { control: "you" as const, token: null, type: "enchantment" };
  expect(subjectMatches(creature, consumer, {})).toBe(true);
  expect(subjectMatches(vehicle, consumer, {})).toBe(true);
  expect(subjectMatches(neither, consumer, {})).toBe(false);
});

// The shared fields outside the branches still bind: "another creature or Vehicle YOU CONTROL" does
// not accept an opponent's creature.
test("anyOf still enforces the fields outside the branches", () => {
  const consumer = {
    control: "you" as const, token: null,
    anyOf: [{ type: "creature" }, { subtype: "vehicle" }],
  };
  expect(subjectMatches({ control: "opp" as const, token: null, type: "creature" }, consumer, {})).toBe(false);
});

// COLORLESS is a constraint in its own right, and the two sides spell it differently: a colourless
// card carries `colors: []` (Scryfall gives it no colours), while a filter saying "colorless spell"
// parses to ["C"]. An intersection of [] and ["C"] is empty, so Echoes of Eternity's "whenever you
// cast a colorless spell" matched nothing at all. 83 corpus subjects demand C.
test("a colourless producer satisfies a colorless filter", () => {
  const consumer = { control: "you" as const, token: null, colors: ["C"] };
  const colourless = { control: "you" as const, token: null, colors: [] };
  const noneAtAll = { control: "you" as const, token: null };
  const blue = { control: "you" as const, token: null, colors: ["U"] };
  expect(subjectMatches(colourless, consumer, {})).toBe(true);
  expect(subjectMatches(noneAtAll, consumer, {})).toBe(true);
  expect(subjectMatches(blue, consumer, {})).toBe(false);
});

// ...and a producer PARSED from a filter spells it ["C"] too. Ruins of Oran-Rief puts a counter on
// "target colorless creature" and stopped feeding Omarthis, Ghostfire Initiate the day DERIVE 173 read
// that recipient into the emit (overview item 8).
test("a producer parsed from a colorless filter satisfies a colorless filter", () => {
  const consumer = { control: "you" as const, token: null, colors: ["C"] };
  expect(subjectMatches({ control: "any" as const, token: null, colors: ["C"] }, consumer, {})).toBe(true);
  expect(subjectMatches({ control: "any" as const, token: null, colors: ["C", "U"] }, { ...consumer, colors: ["U"] }, {})).toBe(true);
});

// ...and a coloured filter is not satisfied by a colourless card, which is the existing behaviour
// and must stay.
test("a colourless producer does not satisfy a coloured filter", () => {
  expect(subjectMatches(
    { control: "you" as const, token: null, colors: [] },
    { control: "you" as const, token: null, colors: ["W"] },
    {},
  )).toBe(false);
});

// The colorless branch satisfies the COLOUR test only — it must not short-circuit the rest of the
// filter. A colourless ARTIFACT does not satisfy "colorless CREATURE spell".
test("a colorless match still has to pass every other field", () => {
  expect(subjectMatches(
    { control: "you" as const, token: null, colors: [], type: "artifact" },
    { control: "you" as const, token: null, colors: ["C"], type: "creature" },
    {},
  )).toBe(false);
});

// BASIC is the second supertype, and it was inexpressible. A producer emitting "search your library
// for a basic land card" said only {type: land}, so at the authored-emit identity check — where the
// emit is the FILTER — every NONBASIC land satisfied it. Same asymmetric shape as legendary: a
// consumer that does not ask is unaffected, one that does is satisfied only by a basic.
test("a basic demand is satisfied only by a basic", () => {
  expect(subjectMatches(s({ type: "land", basic: true }), s({ type: "land", basic: true }), H)).toBe(true);
  expect(subjectMatches(s({ type: "land" }), s({ type: "land", basic: true }), H)).toBe(false);
  // Opt-in: a consumer that says nothing about basic still takes a basic land.
  expect(subjectMatches(s({ type: "land", basic: true }), s({ type: "land" }), H)).toBe(true);
});

// A KEYWORD IS NOT A TYPE, so "creatures you control with flying" (Favorable Winds) had nowhere to
// put the narrowing and anthemed EVERY creature. Same asymmetric, opt-in shape as the supertypes.
test("a keyword demand is satisfied only by a producer printing that keyword", () => {
  const bird = s({ type: "creature", keyword: ["flying"] });
  const elf = s({ type: "creature" });
  expect(subjectMatches(bird, s({ type: "creature", keyword: ["flying"] }), H)).toBe(true);
  expect(subjectMatches(elf, s({ type: "creature", keyword: ["flying"] }), H)).toBe(false);
  // Opt-in: an anthem that says nothing about keywords still reaches the Bird.
  expect(subjectMatches(bird, s({ type: "creature" }), H)).toBe(true);
});

// The list is ALL-of: 17 corpus subjects join two keywords with "and", none with "or".
test("every keyword in the demand must be present", () => {
  const both = s({ type: "creature", keyword: ["deathtouch", "flying"] });
  expect(subjectMatches(both, s({ type: "creature", keyword: ["deathtouch", "flying"] }), H)).toBe(true);
  // A producer with only one of the two does not satisfy a demand for both...
  expect(subjectMatches(s({ type: "creature", keyword: ["flying"] }),
    s({ type: "creature", keyword: ["deathtouch", "flying"] }), H)).toBe(false);
  // ...while a producer with MORE keywords than demanded still satisfies it.
  expect(subjectMatches(both, s({ type: "creature", keyword: ["flying"] }), H)).toBe(true);
});

test("a negated keyword refuses a producer that HAS it, and passes one that does not", () => {
  // Luminous Broodmoth: "whenever a creature you control without flying dies, return it".
  const consumer = { control: "you" as const, token: null, type: "creature", notKeyword: ["flying"] };
  const flyer = { control: "you" as const, token: false, type: "creature", keyword: ["flying"] };
  const ground = { control: "you" as const, token: false, type: "creature", keyword: ["trample"] };
  // An ABSENT keyword list is "has no keywords", not "unknown" — printed keywords arrive on every card.
  const vanilla = { control: "you" as const, token: false, type: "creature" };
  expect(subjectMatches(flyer, consumer, H)).toBe(false);
  expect(subjectMatches(ground, consumer, H)).toBe(true);
  expect(subjectMatches(vanilla, consumer, H)).toBe(true);
});

test("a subject demanding a NAME is satisfied only by that card", () => {
  const h: Hierarchy = {};
  const tardis = { control: "you" as const, token: false, named: "TARDIS", type: ["artifact"] };
  const other = { control: "you" as const, token: false, named: "Sol Ring", type: ["artifact"] };
  // Compared lowercased: the demand comes from lowercased clause text, the supply from the printed
  // name. The First Doctor searching for "a card named TARDIS" is the corpus witness.
  expect(subjectMatches(tardis, { control: "you", token: null, named: "tardis" }, h)).toBe(true);
  expect(subjectMatches(other, { control: "you", token: null, named: "tardis" }, h)).toBe(false);
  // A consumer that does not ask is unaffected — the same asymmetry legendary, basic and commander have.
  expect(subjectMatches(other, { control: "you", token: null }, h)).toBe(true);
  // And a producer with no name cannot satisfy a demand for one.
  expect(subjectMatches({ control: "you", token: false }, { control: "you", token: null, named: "tardis" }, h)).toBe(false);
});

// CR 700.12 / 700.9, added 2026-08-20. `outlaw` is a PRINTED fact and is set on both sides, so a
// Pirate satisfies an outlaw demand and a Bear does not. `modified` is a BOARD STATE — the same
// class as `counter`, which broke three identity gates when it was first compared against a type
// line — so no printed producer can state it and every producer fails the demand. That
// under-claims on purpose: "whenever a modified creature you control deals combat damage" is a
// false sentence about an unmodified creature.
test("an outlaw demand reads the type line; a modified demand is satisfied by nothing printed", () => {
  const pirate: SubjectFilter = { control: "you", token: null, type: "creature", subtype: "pirate", outlaw: true };
  const bear: SubjectFilter = { control: "you", token: null, type: "creature", subtype: "bear" };
  const wantsOutlaw: SubjectFilter = { control: "you", token: null, type: "creature", outlaw: true };
  expect(subjectMatches(pirate, wantsOutlaw, H)).toBe(true);
  expect(subjectMatches(bear, wantsOutlaw, H)).toBe(false);
  // A consumer that does not ask is unaffected — the same opt-in asymmetry every supertype has.
  expect(subjectMatches(pirate, { control: "you", token: null, type: "creature" }, H)).toBe(true);

  const wantsModified: SubjectFilter = { control: "you", token: null, type: "creature", modified: true };
  expect(subjectMatches(bear, wantsModified, H)).toBe(false);
  expect(subjectMatches(pirate, wantsModified, H)).toBe(false);
});

test("isOutlaw is the five CR 700.12 creature types and nothing else", () => {
  for (const t of ["assassin", "mercenary", "pirate", "rogue", "warlock"]) expect(isOutlaw([t])).toBe(true);
  expect(isOutlaw(["human", "wizard"])).toBe(false);
  expect(isOutlaw([])).toBe(false);
});

// C2c: a CLASS subject that guarantees historic satisfies a historic demand. `historic` is stamped
// off a card's own type line, so before 2026-08-20 only a SELF event could satisfy one — "whenever
// an ARTIFACT you control dies" is historic supply by CR 700.6 and did not match.
test("a class subject implies historic only when EVERY member of its OR-list qualifies", () => {
  const wants: SubjectFilter = { control: "you", token: null, historic: true };
  const p = (o: Partial<SubjectFilter>): SubjectFilter => ({ control: "you", token: null, ...o });

  expect(subjectMatches(p({ type: "artifact" }), wants, H)).toBe(true);
  expect(subjectMatches(p({ legendary: true, type: "creature" }), wants, H)).toBe(true);
  expect(subjectMatches(p({ subtype: "saga" }), wants, H)).toBe(true);
  // An artifact CREATURE is an AND — one qualifying member is enough.
  expect(subjectMatches(p({ allTypes: ["artifact", "creature"] }), wants, H)).toBe(true);

  // THE OR-LIST IS THE WHOLE SUBTLETY, and it has two live witnesses: Evereth, Viceroy of Plunder
  // ("sacrifice another creature or artifact") and Midgar, City of Mako ("sacrifice an artifact or
  // creature") guarantee only that ONE of the two hit the graveyard, so neither guarantees a
  // historic card. A `some` reading claims they do — measured, it buys 4 claims and 3 of them are
  // this shape, the fourth being Tibalt's Trickery, an Instant.
  expect(subjectMatches(p({ type: ["artifact", "creature"] }), wants, H)).toBe(false);
  expect(subjectMatches(p({ type: "creature" }), wants, H)).toBe(false);
  expect(subjectMatches(p({ type: "instant" }), wants, H)).toBe(false);
});

test("a negated subtype refuses the card it names and nothing else", () => {
  const wants: SubjectFilter = { control: "you", token: null, type: "creature", notSubtype: ["dragon"] };
  const p = (subtype: string[]): SubjectFilter => ({ control: "you", token: null, type: "creature", subtype });
  // Hidetsugu and Kairi is an Ogre Demon Dragon; Junji's "non-Dragon" excludes exactly it.
  expect(subjectMatches(p(["ogre", "demon", "dragon"]), wants, H)).toBe(false);
  expect(subjectMatches(p(["zombie"]), wants, H)).toBe(true);
  // A producer naming no subtype cannot carry a negated one, so it is not refused.
  expect(subjectMatches({ control: "you", token: null, type: "creature" }, wants, H)).toBe(true);
});

// THE ARRIVAL SLOT (owner's framing, 2026-08-20): the one intervening-if shape that is a PROPERTY OF
// THE EVENT, so it narrows the producer instead of needing an evaluator. Satoru, the Infiltrator —
// "if none of them were cast or no mana was spent to cast them" — claimed every creature in the deck.
test("a not-cast demand is met by a token or an entry from a zone, never by a plain cast", () => {
  const wants: SubjectFilter = { control: "you", token: null, type: "creature", notCast: true };
  // A token was never cast.
  expect(subjectMatches({ control: "you", token: true, type: "creature" }, wants, H)).toBe(true);
  // Reanimated, blinked, or otherwise put onto the battlefield from a stated zone.
  expect(subjectMatches({ control: "you", token: null, type: "creature", fromZone: "graveyard" }, wants, H)).toBe(true);
  expect(subjectMatches({ control: "you", token: null, type: "creature", fromZone: "exile" }, wants, H)).toBe(true);
  // A card's own implied entry IS the cast — 104 of 748 derived enters emits, and the case Satoru
  // excludes by name.
  expect(subjectMatches({ control: "you", token: null, type: "creature" }, wants, H)).toBe(false);
  // A consumer that does not ask is unaffected.
  expect(subjectMatches({ control: "you", token: null, type: "creature" },
    { control: "you", token: null, type: "creature" }, H)).toBe(true);
});

test("an enters-tapped demand needs a producer that says tapped", () => {
  const wants: SubjectFilter = { control: "you", token: null, type: "permanent", entersTapped: true };
  expect(subjectMatches({ control: "you", token: null, type: "land", entersTapped: true }, wants, H)).toBe(true);
  expect(subjectMatches({ control: "you", token: null, type: "land" }, wants, H)).toBe(false);
});

// A COMBAT STATE IS A BOARD STATE, like `modified`: a consumer that demands it is satisfied only by
// a producer whose printed text names it ("exile all attacking creatures"), never by a plain death.
// Kardur, Doomscourge <-> Blasphemous Edict was 3 reasons and is 0.
test("a combat-state demand is met only by a producer that states the same state", () => {
  expect(subjectMatches(s({ type: "creature" }), s({ type: "creature", combat: "attacking" }), H)).toBe(false);
  expect(subjectMatches(s({ type: "creature", combat: "attacking" }), s({ type: "creature", combat: "attacking" }), H)).toBe(true);
  expect(subjectMatches(s({ type: "creature", combat: "blocking" }), s({ type: "creature", combat: "attacking" }), H)).toBe(false);
  // A consumer that does not ask is unaffected by a producer that states one.
  expect(subjectMatches(s({ type: "creature", combat: "attacking" }), s({ type: "creature" }), H)).toBe(true);
});

// A DISJUNCTION ON THE PRODUCER SIDE (recall v6 #125, 2026-09-10). Skullport Merchant's "sacrifice
// another creature or a Treasure" emits `dies` over `anyOf: [{type: creature}, {subtype: treasure}]`
// with no outer type, and an untyped producer fails every typed demand -- so the emit fed nothing.
// A producer satisfies the consumer when ANY of its branches does, the shared fields binding each.
test("a producer disjunction satisfies a consumer that any branch satisfies", () => {
  const eats = s({ anyOf: [{ type: "creature" }, { subtype: "treasure" }], other: true });
  expect(subjectMatches(eats, s({ type: "creature" }), H)).toBe(true);
  expect(subjectMatches(eats, s({ subtype: "treasure" }), H)).toBe(true);
  expect(subjectMatches(eats, s({ type: "land" }), H)).toBe(false);
});

test("a parity demand is met by a known mana value of that parity, and by an UNKNOWN one (#713)", () => {
  const odd = s({ type: "permanent", stats: [{ metric: "mana-value", op: "odd" }] });
  expect(subjectMatches(s({ type: "permanent", manaValue: 3 }), odd, H)).toBe(true);
  expect(subjectMatches(s({ type: "permanent", manaValue: 2 }), odd, H)).toBe(false);
  // All Is Dust's sacrificed permanents: a class holding both parities, not a 0.
  expect(subjectMatches(s({ type: "permanent" }), odd, H)).toBe(true);
});

/** The fields the filter grammar (#896) fills and parseSubject never did. Each is a demand: a
 *  consumer that names one is met only by a producer that states it, and a consumer that does not
 *  name one is unaffected. */
test("tapped and untapped: a state every creature reaches; only a producer stating the opposite fails", () => {
  expect(subjectMatches(s({ type: "creature", tapped: true }), s({ type: "creature", tapped: true }), H)).toBe(true);
  // Sword of the Paruns' "tapped creatures you control" reaches every creature (#896 task 3).
  expect(subjectMatches(s({ type: "creature" }), s({ type: "creature", tapped: true }), H)).toBe(true);
  expect(subjectMatches(s({ type: "creature", tapped: true }), s({ type: "creature", tapped: false }), H)).toBe(false);
  expect(subjectMatches(s({ type: "creature", tapped: true }), s({ type: "creature" }), H)).toBe(true);
});

test("in-combat is met by attacking or blocking", () => {
  const want = s({ type: "creature", combat: "in-combat" });
  expect(subjectMatches(s({ type: "creature", combat: "attacking" }), want, H)).toBe(true);
  expect(subjectMatches(s({ type: "creature", combat: "blocking" }), want, H)).toBe(true);
  expect(subjectMatches(s({ type: "creature" }), want, H)).toBe(false);
  expect(subjectMatches(s({ type: "creature", combat: "in-combat" }), s({ type: "creature", combat: "attacking" }), H)).toBe(false);
});

test("nonblack refuses a black producer; an unrecorded colour abstains", () => {
  const want = s({ type: "creature", notColors: ["B"] });
  expect(subjectMatches(s({ type: "creature", colors: ["B", "G"] }), want, H)).toBe(false);
  expect(subjectMatches(s({ type: "creature", colors: ["G"] }), want, H)).toBe(true);
  expect(subjectMatches(s({ type: "creature" }), want, H)).toBe(true);
});

test("multicolored and monocolored count the five colours", () => {
  expect(subjectMatches(s({ type: "creature", colors: ["W", "U"] }), s({ colorCount: "multi" }), H)).toBe(true);
  expect(subjectMatches(s({ type: "creature", colors: ["W"] }), s({ colorCount: "multi" }), H)).toBe(false);
  expect(subjectMatches(s({ type: "creature", colors: ["W"] }), s({ colorCount: "mono" }), H)).toBe(true);
  expect(subjectMatches(s({ type: "artifact", colors: [] }), s({ colorCount: "mono" }), H)).toBe(false);
  expect(subjectMatches(s({ type: "creature" }), s({ colorCount: "multi" }), H)).toBe(false);
});

test("nonbasic and nonlegendary refuse the supertype; snow demands it", () => {
  expect(subjectMatches(s({ type: "land", basic: true }), s({ type: "land", basic: false }), H)).toBe(false);
  expect(subjectMatches(s({ type: "land" }), s({ type: "land", basic: false }), H)).toBe(true);
  expect(subjectMatches(s({ type: "creature", legendary: true }), s({ type: "creature", legendary: false }), H)).toBe(false);
  expect(subjectMatches(s({ type: "land", snow: true }), s({ type: "land", snow: true }), H)).toBe(true);
  expect(subjectMatches(s({ type: "land" }), s({ type: "land", snow: true }), H)).toBe(false);
});

test("'with a counter on it' is met by any counter kind", () => {
  expect(subjectMatches(s({ type: "creature", counter: "+1/+1" }), s({ type: "creature", hasCounter: true }), H)).toBe(true);
  expect(subjectMatches(s({ type: "creature" }), s({ type: "creature", hasCounter: true }), H)).toBe(false);
});

test("a variable stat rhs ('mana value X or less') abstains: the matcher cannot know X", () => {
  const want = s({ type: "creature", stats: [{ metric: "mana-value", op: "lte", variable: true }] });
  expect(subjectMatches(s({ type: "creature", manaValue: 9 }), want, H)).toBe(true);
  expect(subjectMatches(s({ type: "creature", manaValue: 9 }), s({ type: "creature", stats: [{ metric: "mana-value", op: "lte", value: 3 }] }), H)).toBe(false);
});

test("relations no producer states are refused, also inside an anyOf branch", () => {
  const spell = s({ type: "instant" });
  expect(subjectMatches(spell, s({ type: "spell", combatWith: { role: "blocking", with: "self" } }), H)).toBe(false);
  expect(subjectMatches(spell, s({ anyOf: [{ type: "spell", targets: { self: true } }] }), H)).toBe(false);
  // A player's condition and a name's first printing: no producer states either.
  expect(subjectMatches(s({ control: "opp" }), s({ control: "opp", condition: { kind: "controls", what: { subtype: "elf" }, negated: true } }), H)).toBe(false);
  expect(subjectMatches(s({ type: "artifact" }), s({ type: "permanent", printedIn: "antiquities" }), H)).toBe(false);
  expect(subjectMatches(s({ type: "land" }), s({ type: "land", relation: { kind: "could-produce", mana: ["C"] } }), H)).toBe(false);
  expect(subjectMatches(s({ type: "creature" }), s({ anyOf: [{ type: "creature", ref: "sentence" }] }), H)).toBe(false);
});

test("not on the battlefield: a producer with no zone is on it", () => {
  const want = s({ type: "creature", notZone: "battlefield" });
  expect(subjectMatches(s({ type: "creature" }), want, H)).toBe(false);
  expect(subjectMatches(s({ type: "creature", zone: "graveyard" }), want, H)).toBe(true);
});

test("a total over the chosen objects abstains, as a variable rhs does", () => {
  const want = s({ type: "creature", stats: [{ metric: "power", op: "gte", value: 12, total: true }] });
  expect(subjectMatches(s({ type: "creature", stats: [{ metric: "power", op: "eq", value: 2 }] }), want, H)).toBe(true);
});

test("from anywhere other than your hand: an unstated origin is the hand", () => {
  const want = s({ type: "spell", notFromZone: "hand" });
  expect(subjectMatches(s({ type: "instant" }), want, H)).toBe(false);
  expect(subjectMatches(s({ type: "instant", fromZone: "graveyard" }), want, H)).toBe(true);
});

test("from anywhere other than your hand: an opponent's card is never in YOUR hand (CR 400.3), whatever origin its cast states (#1596)", () => {
  const want = s({ type: "spell", notFromZone: "hand" });
  expect(subjectMatches(s({ type: "instant", fromZone: "hand", owner: "opp" }), want, H)).toBe(true);
  expect(subjectMatches(s({ type: "instant", owner: "opp" }), want, H)).toBe(true);
  expect(subjectMatches(s({ type: "instant", fromZone: "hand" }), want, H)).toBe(false);
  expect(subjectMatches(s({ type: "instant", fromZone: "hand", owner: "you" }), want, H)).toBe(false);
  // Only the hand is a per-player zone here: "from anywhere other than the battlefield" does not read the owner.
  expect(subjectMatches(s({ type: "creature", fromZone: "battlefield", owner: "opp" }), s({ type: "creature", notFromZone: "battlefield" }), H)).toBe(false);
});

test("from anywhere other than your hand: a copy of an opponent's card is made where that card is (CR 707.12), never in YOUR hand (#1608)", () => {
  const want = s({ type: "spell", notFromZone: "hand" });
  expect(subjectMatches(s({ type: "instant", copyOf: { owner: "opp" } }), want, H)).toBe(true);
  // A copy of your own card with no origin stated is made in your hand (God-Eternal Kefnet's revealed draw).
  expect(subjectMatches(s({ type: "instant", copyOf: { type: "instant" } }), want, H)).toBe(false);
});

// #1608 item 5, a known gap pinned (not fixed): a producer's `type` is what it IS, a list is OR, and nothing says "may also be". Thada Adel, Acquisitor's take ("an artifact card ... you may play that card") is cast as
// `type: artifact`; an artifact creature is a creature spell too, but no field carries a type the producer does not state (the same limit `targetReachesSubtype` records for "target creature" and "artifacts you control").
// Writing `["artifact", "creature"]` would claim she casts any creature. When the representation exists, the first expectation flips.
test("an artifact cast does not meet 'a creature spell' (Thada Adel: the artifact may be a creature, unstated); a list would claim every creature", () => {
  expect(subjectMatches(s({ type: "artifact", fromZone: "exile", owner: "opp" }), s({ type: "creature" }), H)).toBe(false);
  expect(subjectMatches(s({ type: "artifact", fromZone: "exile", owner: "opp" }), s({ type: "artifact" }), H)).toBe(true);
  expect(subjectMatches(s({ type: ["artifact", "creature"], fromZone: "exile", owner: "opp" }), s({ type: "creature" }), H)).toBe(true);
});

// #1612: A PRODUCER THAT SAYS IT IS COLOURED IS NOT COLOURLESS. "Whenever you cast a colorless spell" (`colors: ["C"]`) is met by a producer with no colour, and a cast that records no colour list but states a colour
// count ("a card of that color": `colorCount: colored`, Sanar; "monocolored cards": `mono`, Emergent Ultimatum) passed as one.
test("a colourless demand is not met by a producer whose colorCount says it has a colour", () => {
  const colourless = s({ type: "spell", colors: ["C"] });
  expect(subjectMatches(s({ type: "spell" }), colourless, H)).toBe(true);
  for (const colorCount of ["colored", "mono", "multi", "exactly-two", "all"] as const) expect(subjectMatches(s({ type: "spell", colorCount }), colourless, H), colorCount).toBe(false);
  // A coloured demand is untouched: a producer that names no colour still fails it, as before.
  expect(subjectMatches(s({ type: "spell", colorCount: "colored" }), s({ type: "spell", colors: ["U"] }), H)).toBe(false);
});

test("a player branch is met by a player-shaped producer only", () => {
  const want = s({ control: "any", anyOf: [{ player: true }, { type: "planeswalker" }] });
  expect(subjectMatches(s({ control: "opp" }), want, H)).toBe(true);
  expect(subjectMatches(s({ type: "creature" }), want, H)).toBe(false);
  expect(subjectMatches(s({ type: "planeswalker" }), want, H)).toBe(true);
});

test("exclusions: a producer matching one fails", () => {
  const want = s({ type: "creature", except: [{ subtype: "merfolk" }] });
  expect(subjectMatches(s({ type: "creature", subtype: "merfolk" }), want, H)).toBe(false);
  expect(subjectMatches(s({ type: "creature", subtype: "bear" }), want, H)).toBe(true);
});

test("a nonartifact creature consumer refuses an artifact creature producer (#1383)", () => {
  const consumer = parseSubject("all nonartifact creatures") as SubjectFilter;
  // Solemn Simulacrum: Artifact Creature. A Grizzly Bears: Creature.
  expect(subjectMatches(s({ control: "any", type: ["artifact", "creature"], allTypes: ["artifact", "creature"] }), consumer, H)).toBe(false);
  expect(subjectMatches(s({ control: "any", type: "creature" }), consumer, H)).toBe(true);
});

// #1385: derive marks the conjunction (`allTypes`), so an UNMARKED multi-type producer list is an OR and is
// excluded only when EVERY alternative is. A marked one is an AND, excluded when any of its types is.
test("a producer type list with allTypes is an AND; without it, an OR (#1385)", () => {
  const missy = parseSubject("another nonartifact creature") as SubjectFilter;
  // Stroke of Midnight: "destroy target nonland permanent" -- an OR carrying its own notType.
  const stroke = s({ control: "any", type: ["creature", "artifact", "enchantment", "planeswalker", "battle"], notType: ["land"] });
  expect(subjectMatches(stroke, missy, H)).toBe(true);
  expect(subjectMatches(s({ control: "any", type: ["artifact", "enchantment"], notType: ["land"] }), missy, H)).toBe(false);
  // Laserbeak: a printed artifact creature carries allTypes, so it is both and is refused.
  expect(subjectMatches(s({ control: "any", type: ["artifact", "creature"], allTypes: ["artifact", "creature"] }), missy, H)).toBe(false);
  // Urza's copy token (creature in addition to artifact) carries allTypes too.
  const urzaToken = s({ control: "you", token: true, type: ["creature", "artifact"], allTypes: ["artifact", "creature"] });
  expect(subjectMatches(urzaToken, parseSubject("a nonartifact permanent you control") as SubjectFilter, H)).toBe(false);
  expect(subjectMatches(urzaToken, parseSubject("a noncreature, nonland permanent you control") as SubjectFilter, H)).toBe(false);
  // Midgar, City of Mako // Reactor Raid: "sacrifice an artifact or creature" is an OR with no mark; a noncreature
  // artifact is a legal sacrifice, so Jaws ("a noncreature artifact is sacrificed") hears it.
  const sacrifice = s({ control: "you", type: ["creature", "artifact"] });
  expect(subjectMatches(sacrifice, parseSubject("a noncreature artifact") as SubjectFilter, H)).toBe(true);
  // ...but not when every alternative is excluded.
  expect(subjectMatches(s({ control: "you", type: ["creature", "artifact"] }), parseSubject("a noncreature, nonartifact permanent") as SubjectFilter, H)).toBe(false);
  // Stolen Identity: "a copy of target artifact or creature" is a real OR, so a nonartifact consumer is met by the creature.
  expect(subjectMatches(s({ control: "you", token: true, type: ["creature", "artifact"] }), parseSubject("a nonartifact permanent you control") as SubjectFilter, H)).toBe(true);
  // A single-type producer is refused when that type is excluded, as before.
  expect(subjectMatches(s({ control: "any", type: "artifact" }), parseSubject("a nonartifact permanent") as SubjectFilter, H)).toBe(false);
});

test("a counter put on a card in exile reaches no battlefield counter demand, and still reaches a demand that names exile (#1523)", () => {
  const h: Hierarchy = {};
  const onExiled: SubjectFilter = { control: "any", token: null, counter: "blood", zone: "exile" };
  const onBoard: SubjectFilter = { control: "any", token: null, counter: "blood" };
  const battlefield = parseSubject("a creature you control");
  expect(counterAddMatches(onExiled, battlefield, h)).toBe(false);
  expect(counterAddMatches(onBoard, battlefield, h)).toBe(true);
  expect(counterAddMatches(onExiled, { ...battlefield, zone: "exile" }, h)).toBe(true);
});

// ALL PERMANENTS PROVES NO SUBTYPE NARROWING (#1577): an unrestricted mass event typed `permanent` takes an Equipment, a Goblin, a Saga with it.
const MASS = (o: Partial<SubjectFilter> = {}): SubjectFilter => s({ control: "any", type: "permanent", scope: "all", ...o });
const HE: Hierarchy = { ...H, equipment: ["artifact"], goblin: ["creature"], saga: ["enchantment"], forest: ["land"], arcane: ["instant"] };

test("an unrestricted mass 'all permanents' event covers every permanent subtype", () => {
  expect(subjectMatches(MASS({ other: true }), s({ control: "any", subtype: "equipment" }), HE)).toBe(true);
  expect(subjectMatches(MASS(), s({ control: "any", subtype: "goblin" }), HE)).toBe(true);
  expect(subjectMatches(MASS({ scope: "each" }), s({ control: "any", subtype: "forest" }), HE)).toBe(true);
  expect(subjectMatches(MASS({ fromZone: "battlefield" }), s({ control: "any", type: "artifact", subtype: "equipment" }), HE)).toBe(true);
});

test("'all permanents' is no proof for a non-permanent subtype, a nonland sweep for a land subtype, or a narrowed sweep", () => {
  expect(subjectMatches(MASS(), s({ control: "any", subtype: "arcane" }), HE)).toBe(false);
  expect(subjectMatches(MASS({ notType: ["land"] }), s({ control: "any", subtype: "forest" }), HE)).toBe(false);
  expect(subjectMatches(MASS({ notType: ["land"] }), s({ control: "any", subtype: "equipment" }), HE)).toBe(true);
  expect(subjectMatches(MASS({ colors: ["R"] }), s({ control: "any", subtype: "equipment" }), HE)).toBe(false);
  expect(subjectMatches(MASS({ selection: "pile" }), s({ control: "any", subtype: "equipment" }), HE)).toBe(false);
  expect(subjectMatches(MASS({ notSubtype: ["equipment"] }), s({ control: "any", subtype: "equipment" }), HE)).toBe(false);
});

test("a TARGET or a single-object permanent proves no subtype", () => {
  expect(subjectMatches(MASS({ scope: "target" }), s({ control: "any", subtype: "equipment" }), HE)).toBe(false);
  expect(subjectMatches(s({ control: "any", type: "permanent" }), s({ control: "any", subtype: "equipment" }), HE)).toBe(false);
});

test("a sweep stamped with a zone (the battlefield it leaves, the graveyard it arrives in) still proves the subtype", () => {
  expect(subjectMatches(MASS({ zone: "battlefield", other: true }), s({ control: "any", subtype: "equipment", zone: "battlefield" }), HE)).toBe(true);
  expect(subjectMatches(MASS({ zone: "graveyard", fromZone: "battlefield" }), s({ control: "any", subtype: "equipment", zone: "graveyard" }), HE)).toBe(true);
});

test("a sweep of a set taken from the graveyard, exile or library proves nothing (Faith's Reward, a dig)", () => {
  expect(subjectMatches(MASS({ fromZone: "graveyard" }), s({ control: "any", subtype: "equipment" }), HE)).toBe(false);
  expect(subjectMatches(MASS({ fromZone: "library" }), s({ control: "any", subtype: "equipment" }), HE)).toBe(false);
});

// AN anyOf PRODUCER IS TYPED, NOT A WILDCARD (#1577): "Destroy target artifact, enchantment, or creature with flying" is three alternatives with no top-level type, and the untyped fast paths of a graveyard fill and a counter placement read it as "nothing is known".
const ALTS: SubjectFilter = s({ control: "any", scope: "target", zone: "graveyard", anyOf: [{ type: "artifact" }, { type: "enchantment" }, { type: "creature", keyword: ["flying"] }] as never });
test("an anyOf graveyard fill feeds only the classes its alternatives name", () => {
  expect(graveyardFillMatches(ALTS, s({ control: "any", type: "instant", zone: "graveyard" }), HE)).toBe(false);
  expect(graveyardFillMatches(ALTS, s({ control: "any", type: "land", zone: "graveyard" }), HE)).toBe(false);
  expect(graveyardFillMatches(ALTS, s({ control: "any", type: "artifact", zone: "graveyard" }), HE)).toBe(true);
});
test("CONTROL: an untyped graveyard fill stays a wildcard", () => {
  expect(graveyardFillMatches(s({ control: "any", zone: "graveyard" }), s({ control: "any", type: "instant", zone: "graveyard" }), HE)).toBe(true);
});
test("an anyOf counter placement feeds only the classes its alternatives name", () => {
  expect(counterAddMatches({ ...ALTS, counter: "+1/+1" }, s({ control: "any", type: "land", counter: "+1/+1" }), HE)).toBe(false);
  expect(counterAddMatches({ ...ALTS, counter: "+1/+1" }, s({ control: "any", type: "artifact", counter: "+1/+1" }), HE)).toBe(true);
});

/** #1579 part 3 (owner ruling 2026-11-09): only MASS removal that does not exclude tokens satisfies a "whenever a creature token dies / leaves" payoff. Mass is scope all or each; a single target, a nontoken class and a land-only class do not. */
describe("a mass producer meets a token demand", () => {
  const nadier: SubjectFilter = { control: "you", token: true };
  const drover: SubjectFilter = { control: "any", token: true, type: "creature" };
  const grismold: SubjectFilter = { control: "any", token: true, type: "creature" };
  const cutTheTethers: SubjectFilter = { control: "any", token: null, subtype: "spirit", scope: "each", fromZone: "battlefield" };
  const perish: SubjectFilter = { control: "any", token: null, colors: ["G"], type: "creature", scope: "all" };
  const murder: SubjectFilter = { control: "opp", token: null, type: ["creature", "planeswalker"], scope: "target" };
  const sheoldredRecursion: SubjectFilter = { control: "you", token: null, type: "creature", scope: "target", fromZone: "graveyard", zone: "graveyard" };
  const ravages: SubjectFilter = { control: "any", token: null, type: "land", scope: "all" };
  test("Cut the Tethers (for each Spirit) feeds Nadier's Nightblade", () => {
    expect(subjectMatches(cutTheTethers, nadier, HE, true)).toBe(true);
  });
  test("Perish (destroy all green creatures) feeds Grismold", () => {
    expect(subjectMatches(perish, grismold, HE, true)).toBe(true);
  });
  test("Murder (destroy target creature) does not feed Twilight Drover", () => {
    expect(subjectMatches(murder, drover, HE, true)).toBe(false);
  });
  test("Sheoldred's graveyard return does not feed Grismold", () => {
    expect(subjectMatches(sheoldredRecursion, grismold, HE, true)).toBe(false);
  });
  test("Ravages of War (destroy all lands) does not feed Grismold or Nadier", () => {
    expect(subjectMatches(ravages, grismold, HE, true)).toBe(false);
    expect(subjectMatches(ravages, nadier, HE, true)).toBe(false);
  });
  test("a mass class that says nontoken does not", () => {
    expect(subjectMatches({ ...perish, token: false }, grismold, HE, true)).toBe(false);
  });
  test("a mass Island class (Gush) is land-only and does not", () => {
    expect(subjectMatches({ control: "you", token: null, subtype: "island", scope: "all", fromZone: "battlefield" }, nadier, HE, true)).toBe(false);
  });
  test("an ENTERS event never takes a mass class: Deep Space 9's 'put all permanent cards onto the battlefield' is no token", () => {
    expect(subjectMatches(perish, grismold, HE)).toBe(false);
    expect(subjectMatches(perish, grismold, HE, false)).toBe(false);
  });
  test("a pile (Expose the Culprit) and a numbered pick do not", () => {
    expect(subjectMatches({ ...perish, selection: "pile" }, grismold, HE, true)).toBe(false);
    expect(subjectMatches({ ...perish, selection: "counted" }, grismold, HE, true)).toBe(false);
  });
  test("Treefolk Mystic (destroy all Auras attached to that creature) and a named class (Sheltered Valley's own name) do not", () => {
    expect(subjectMatches({ control: "any", token: null, selection: "attached-to", subtype: "aura", scope: "all" }, grismold, HE, true)).toBe(false);
    expect(subjectMatches({ control: "you", token: null, named: "~", other: true, type: "permanent", scope: "each" }, nadier, HE, true)).toBe(false);
  });
  test("a vote (Vault 11), a set the card chose and a named set are picks, not a sweep; all-but is still one", () => {
    for (const selection of ["votes", "chosen", "named-set"] as const) expect(subjectMatches({ ...perish, selection }, grismold, HE, true)).toBe(false);
    expect(subjectMatches({ ...perish, selection: "all-but" }, grismold, HE, true)).toBe(true);
  });
  test("a single sacrificed object with no scope (Imskir Iron-Eater) still does not", () => {
    expect(subjectMatches({ control: "you", token: null, type: "artifact" }, nadier, HE, true)).toBe(false);
  });
});

/** #1579 (owner ruling 2026-11-09): "edicts on everyone" are mass removal. "Each player sacrifices a creature" (Innocent Blood, Fleshbag Marauder) is stored with no scope; "each player sacrifices two / X" (Barter in Blood, Pox, Meathook Massacre II) is `counted`; "each opponent" is control opp. A "target player / opponent" edict
 *  is marked `edict: true` and can be aimed at one player, so it is no edict on everyone. */
describe("an edict on everyone meets a token demand", () => {
  const drover: SubjectFilter = { control: "any", token: true, type: "creature" };
  const innocentBlood: SubjectFilter = { control: "any", token: null, type: "creature", edictAll: true };
  const barter: SubjectFilter = { control: "any", token: null, selection: "counted", type: "creature", scope: "all", edictAll: true };
  const liliana: SubjectFilter = { control: "opp", token: null, type: "creature", edictAll: true };
  const diabolic: SubjectFilter = { control: "any", token: null, type: "creature", edict: true };
  const unscopedDeath: SubjectFilter = { control: "any", token: null, type: "creature" };
  test("Innocent Blood, Barter in Blood and an each-opponent edict feed Twilight Drover", () => {
    expect(subjectMatches(innocentBlood, drover, HE, "edict")).toBe(true);
    expect(subjectMatches(barter, drover, HE, "edict")).toBe(true);
    expect(subjectMatches(liliana, { ...drover, control: "opp" }, HE, "edict")).toBe(true);
  });
  test("Fleshbag Marauder (each player sacrifices a creature) feeds Grismold", () => {
    expect(subjectMatches(innocentBlood, { control: "any", token: true, type: "creature" }, HE, "edict")).toBe(true);
  });
  test("Diabolic Edict (target player) and a sacrifice cost of your own do not", () => {
    expect(isEveryoneEdict(diabolic)).toBe(false);
    expect(subjectMatches(diabolic, drover, HE, "edict")).toBe(false);
    expect(isEveryoneEdict({ ...innocentBlood, control: "you" })).toBe(false);
    expect(isEveryoneEdict(innocentBlood)).toBe(true);
    expect(isEveryoneEdict(barter)).toBe(true);
  });
  test("CONTROL: an unscoped death of one destroyed creature (Ohran Viper, Mortal Wound) is no edict", () => {
    expect(isEveryoneEdict(unscopedDeath)).toBe(false);
    expect(subjectMatches(unscopedDeath, drover, HE, "edict")).toBe(false);
  });
  test("CONTROL: without the edict mode an unscoped class still meets no token demand", () => {
    expect(subjectMatches(innocentBlood, drover, HE, true)).toBe(false);
  });
});

/** #1582 part 1 -- A SWEEP THAT SPARES ARTIFACTS AND LANDS MEETS NO ARTIFACT OR LAND PAYOFF. Scourglass / Elesh Norn's back face derive the spared types as `notType`; Munitions ("when this token leaves the battlefield", an artifact token)
 *  and a land payoff are not fed, a creature payoff still is, and an unrestricted sweep (Apocalypse) still feeds the artifact token. */
describe("a sweep that spares artifacts and lands", () => {
  const scourglass = parseSubject("all permanents except for artifacts and lands");
  const apocalypse = parseSubject("all permanents");
  const artifactToken: SubjectFilter = { control: "any", token: true, type: "artifact" };
  test.each([[scourglass, false], [apocalypse, true]])("feeds an artifact token leave payoff: %#", (p, fed) => {
    expect(subjectMatches(p, artifactToken, H, true)).toBe(fed);
  });
  test("feeds no land payoff, still a creature payoff", () => {
    expect(subjectMatches(scourglass, { control: "any", token: null, type: "land" }, H, true)).toBe(false);
    expect(subjectMatches(scourglass, { control: "any", token: null, type: "creature" }, H, true)).toBe(true);
  });
});

/** #1582 KIRRI -- A SWEEP WRITTEN AS A TYPE LIST PROVES THE SUBTYPES IT LEAVES. "Destroy all permanents except for artifacts and lands" (Scourglass) derives the list [creature, enchantment, planeswalker, battle] with notType [artifact, land]: the whole permanent set minus what it spares, the
 *  same sweep #1577 reads from a bare `permanent`. A Plant creature dies to it, so Kirri's "return target Plant, Treefolk or land card" is fed; a spared subtype (Norn spares Phyrexians) is not. "All nonland permanents" is the same shape. */
describe("a type-list sweep proves the subtypes it does not spare", () => {
  const HK: Hierarchy = { ...H, plant: ["creature"], phyrexian: ["creature"], forest: ["land"], equipment: ["artifact"], aura: ["enchantment"] };
  const kirri = (st: string): SubjectFilter => ({ control: "you", token: null, subtype: [st], scope: "target", fromZone: "graveyard", zone: "graveyard" });
  const fill = (text: string): SubjectFilter => ({ ...parseSubject(text), zone: "graveyard", fromZone: "battlefield" });
  const scourglass = fill("all permanents except for artifacts and lands");
  const norn = fill("all other permanents except for artifacts, lands, and Phyrexians");
  const nonland = fill("all nonland permanents");
  test.each([
    ["Scourglass x Plant", scourglass, "plant", true], ["Scourglass x Equipment (an artifact)", scourglass, "equipment", false], ["Scourglass x Forest (a land)", scourglass, "forest", false], ["Scourglass x Aura", scourglass, "aura", true],
    ["Norn x Plant", norn, "plant", true], ["Norn x Phyrexian (spared)", norn, "phyrexian", false], ["nonland x Equipment", nonland, "equipment", true], ["nonland x Forest", nonland, "forest", false],
  ])("fills the graveyard for a demand: %s", (_n, p, st, fed) => {
    expect(graveyardFillMatches(p, kirri(st as string), HK)).toBe(fed);
  });
  test("an untouched narrowing still proves nothing: a colour, a keyword", () => {
    expect(graveyardFillMatches({ ...nonland, colors: ["B"] }, kirri("plant"), HK)).toBe(false);
  });
});

/** #1586 -- A CONDITIONAL SWEEP DOES NOT PROVE EVERY SUBTYPE. Karn's Sylex and kin ("each nonland permanent with mana value X or less"; "... equal to the number of charge counters"): the number is the player's to open, so any subtype is reachable and the sweep still proves them (decided
 *  in #1586: X chosen by you is a real reach). Mists of Lorien (the same mana value as the target), Renet (entered this turn), Deputy of Detention (the same name) narrow the class by a fact of the permanents themselves: no subtype is proved. Desynchronization ("not historic") spares artifacts and
 *  Sagas; Urza, Planeswalker spares YOUR artifacts and planeswalkers (indestructible), so only a consumer that can see an opponent's is fed. */
describe("a conditional type-list sweep proves the subtypes it still reaches", () => {
  const HC: Hierarchy = { ...H, plant: ["creature"], equipment: ["artifact"], vehicle: ["artifact"], aura: ["enchantment"], saga: ["enchantment"], forest: ["land"] };
  const nonland = parseSubject("all nonland permanents");
  const dies = (p: Partial<SubjectFilter>, subtype: string, control: SubjectFilter["control"] = "you"): boolean =>
    subjectMatches({ ...nonland, ...p }, { control, token: null, subtype: [subtype] }, HC, true);
  const openX: Partial<SubjectFilter> = { stats: [{ metric: "mana-value", op: "lte", variable: true }] };
  test("CONTROL: the unconditional sweep proves a Plant, an Equipment, an Aura", () => {
    for (const st of ["plant", "equipment", "aura"]) expect(dies({}, st)).toBe(true);
    expect(dies({}, "forest")).toBe(false);
  });
  test.each(["plant", "equipment", "aura"])("an open mana value (X chosen by you) still proves %s", (st) => {
    expect(dies(openX, st)).toBe(true);
    expect(dies({ stats: [{ metric: "mana-value", op: "eq", variable: true }] }, st)).toBe(true);
  });
  test.each([
    ["a constant mana value", { stats: [{ metric: "mana-value", op: "lte", value: 3 }] }],
    ["the same mana value as the target (Mists of Lorien)", { shares: { what: "mana-value", with: "ref" } }],
    ["entered this turn (Renet)", { history: ["entered"] }],
    ["the same name (Deputy of Detention)", { nameRelation: "same" }],
  ] as [string, Partial<SubjectFilter>][])("%s proves no subtype", (_n, p) => {
    for (const st of ["plant", "equipment", "aura"]) expect(dies(p, st)).toBe(false);
  });
  test("not historic (Desynchronization) spares an artifact or a Saga, not a Plant or an Aura", () => {
    const p: Partial<SubjectFilter> = { except: [{ historic: true }] };
    expect(dies(p, "plant")).toBe(true);
    expect(dies(p, "aura")).toBe(true);
    for (const st of ["equipment", "vehicle", "saga"]) expect(dies(p, st)).toBe(false);
  });
  test("your artifacts and planeswalkers spared (Urza, Planeswalker): an artifact of yours survives, an opponent's does not", () => {
    const p: Partial<SubjectFilter> = { except: [{ type: ["artifact", "planeswalker"], control: "you" }] };
    for (const st of ["equipment", "vehicle"]) { expect(dies(p, st, "you")).toBe(false); expect(dies(p, st, "any")).toBe(true); expect(dies(p, st, "opp")).toBe(true); }
    for (const st of ["plant", "aura"]) expect(dies(p, st, "you")).toBe(true);
  });
  test("an exception the matcher cannot read proves nothing", () => {
    expect(dies({ except: [{ colors: ["B"] }] }, "plant")).toBe(false);
  });
});
