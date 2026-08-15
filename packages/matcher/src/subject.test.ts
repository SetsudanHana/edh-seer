import { expect, test } from "vitest";
import { counterAddMatches, graveyardFillMatches, subjectMatches } from "./subject.js";
import type { SubjectFilter } from "@mtg/tagger";
import type { Hierarchy } from "./types.js";

const H: Hierarchy = { wizard: ["creature"], zombie: ["creature"], treasure: ["artifact"] };
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
