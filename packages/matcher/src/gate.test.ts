import { parseGate } from "@edh-seer/tagger/gate";
import { expect, test } from "vitest";
import { boardCount, boardGateOf, gateMetBy, gateProbability, gateVerdict, isEstimatedGate, lineGateMetBy, lineGateVerdict, permOf } from "./gate.js";
import { manaTags, mkLine } from "./mana-test-support.js";
import type { DeckCard } from "./types.js";

const dc = (name: string, typeLine: string, oracleText = ""): DeckCard => ({ card: { name, typeLine, oracleText, manaValue: 1 } as never, tags: null });
const copies = (n: number, make: (i: number) => DeckCard): DeckCard[] => Array.from({ length: n }, (_, i) => make(i));
const filler = (n: number): DeckCard[] => copies(n, (i) => dc(`Spell ${i}`, "Instant"));
/** A 100-card deck: `own` plus filler. */
const deckOf = (...own: DeckCard[][]): DeckCard[] => { const cards = own.flat(); return [...cards, ...filler(100 - cards.length)]; };

test("'you control a <subtype>' is met by a deck that has enough of the subtype to draw one by the median clock, not by one stray card (Mox Jasper)", () => {
  const dragons = (n: number) => copies(n, (i) => dc(`Dragon ${i}`, "Creature — Dragon"));
  expect(gateVerdict(parseGate("you control a dragon"), deckOf(dragons(12)))).toBe("met");
  expect(gateVerdict(parseGate("you control a dragon"), deckOf(dragons(1)))).toBe("unmet");
  expect(gateVerdict(parseGate("you control a dragon"), deckOf([]))).toBe("unmet");
  // 12 Dragons make the gate near-certain and a lone one makes it unlikely: the probability is what a quality weight reads
  expect(gateProbability(parseGate("you control a dragon"), deckOf(dragons(12)))!).toBeGreaterThan(0.8);
  expect(gateProbability(parseGate("you control a dragon"), deckOf(dragons(1)))!).toBeLessThan(0.2);
});

test("a card type, an 'or' of land types and a count ('three or more artifacts', Mox Opal) are read off the deck's type lines", () => {
  const artifacts = copies(25, (i) => dc(`Rock ${i}`, "Artifact"));
  expect(gateVerdict(parseGate("you control three or more artifacts"), deckOf(artifacts))).toBe("met");
  expect(gateVerdict(parseGate("you control three or more artifacts"), deckOf(copies(3, (i) => dc(`Rock ${i}`, "Artifact"))))).toBe("unmet");
  expect(gateVerdict(parseGate("you control an artifact"), deckOf(artifacts))).toBe("met");
  const swamps = copies(14, () => dc("Swamp", "Basic Land — Swamp"));
  expect(gateVerdict(parseGate("you control a plains or a swamp"), deckOf(swamps))).toBe("met");
  expect(gateVerdict(parseGate("you control a forest or a plains"), deckOf(swamps))).toBe("unmet");
  // a land with the type counts, a dual with both
  expect(gateVerdict(parseGate("you control a swamp"), deckOf(copies(10, () => dc("Watery Grave", "Land — Island Swamp"))))).toBe("met");
});

test("lands: 'five or more lands' and 'three or more lands with the same name' (Temple, Sceptre of Eternal Glory)", () => {
  const lands = copies(36, (i) => dc(i < 20 ? "Forest" : `Land ${i}`, i < 20 ? "Basic Land — Forest" : "Land"));
  expect(gateVerdict(parseGate("you control five or more lands"), deckOf(lands))).toBe("met");
  expect(gateVerdict(parseGate("you control five or more lands"), deckOf(copies(3, () => dc("Forest", "Basic Land — Forest"))))).toBe("unmet");
  expect(gateVerdict(parseGate("you control three or more lands with the same name"), deckOf(lands))).toBe("met");
  // no land name is repeated: nothing has 'the same name'
  expect(gateVerdict(parseGate("you control three or more lands with the same name"), deckOf(copies(36, (i) => dc(`Land ${i}`, "Land"))))).toBe("unmet");
});

test("'you have the initiative' is met by a deck with a card that takes it (Sarevok's Tome does itself) and not otherwise", () => {
  const tome = dc("Sarevok's Tome", "Artifact — Book", "When this artifact enters, you take the initiative.\n{T}: Add {C}. If you have the initiative, add {C}{C} instead.");
  expect(gateVerdict(parseGate("you have the initiative"), deckOf([tome]))).toBe("met");
  expect(gateVerdict(parseGate("you have the initiative"), deckOf([]))).toBe("unmet");
});

test("a gate that is a game state or a trigger is unknown, never met (Yue's trigger, poison, 'bargained', a named land)", () => {
  const deck = deckOf(copies(40, (i) => dc(`Rock ${i}`, "Artifact")));
  for (const g of ["when princess yue dies", "an opponent has three or more poison counters", "it was bargained", "you control a legendary creature", "you control an urza's mine and an urza's tower",
    "it's the third time", "a legal target exists: target land card from a graveyard", "you win"]) {
    expect(gateVerdict(parseGate(g), deck), g).toBe("unknown");
  }
});

test("a line with no gate is met; a gated line with no deck to judge it against is unknown (the pre-deck behaviour: never credited)", () => {
  expect(lineGateVerdict(mkLine(), undefined)).toBe("met");
  expect(lineGateVerdict(mkLine({ gate: parseGate("you control a dragon") }), undefined)).toBe("unknown");
  expect(lineGateVerdict(mkLine({ gate: parseGate("you control a dragon") }), deckOf(copies(12, (i) => dc(`Dragon ${i}`, "Creature — Dragon"))))).toBe("met");
});

test("a board-count gate parses to the permanents it names and how many; every other gate is not one", () => {
  expect(boardGateOf(parseGate("you control a dragon"))).toEqual({ need: 1, nouns: ["dragon"] });
  expect(boardGateOf(parseGate("you control four or more creatures"))).toEqual({ need: 4, nouns: ["creature"] });
  expect(boardGateOf(parseGate("you control three or more artifacts"))).toEqual({ need: 3, nouns: ["artifact"] });
  expect(boardGateOf(parseGate("you control a mountain or a forest"))).toEqual({ need: 1, nouns: ["mountain", "forest"] });
  expect(boardGateOf(parseGate("you control an artifact"))).toEqual({ need: 1, nouns: ["artifact"] });
  for (const g of ["you control three or more lands with the same name", "you control an urza's mine and an urza's tower", "you have the initiative", "speed 4", "you control a land named wastes"]) expect(boardGateOf(parseGate(g)), g).toBeNull();
  const forest = permOf(dc("Forest", "Basic Land \u2014 Forest"))!;
  const dragon = permOf(dc("Dragon", "Creature \u2014 Dragon"))!;
  expect(permOf(dc("Bolt", "Instant"))).toBeNull();
  expect(boardCount(boardGateOf(parseGate("you control a mountain or a forest"))!, [forest, dragon, forest])).toBe(2);
});

// THE SAME GATE BY A TURN (the colour audit and the Karsten inputs ask it; the goldfish counts the permanents of each game): the cards seen by then, and only the permanents that can be
// on the battlefield by then -- a land, or a spell whose mana value is at most the turn.
test("a gate is met BY a turn when enough of what it names could be on the battlefield by then: five-mana Dragons are not castable on turn 4", () => {
  const dragons = (n: number, mv: number) => copies(n, (i) => ({ ...dc(`Dragon ${i}`, "Creature \u2014 Dragon"), card: { name: `Dragon ${i}`, typeLine: "Creature \u2014 Dragon", oracleText: "", manaValue: mv } as never }));
  const heavy = deckOf(dragons(12, 5));
  expect(gateMetBy(parseGate("you control a dragon"), heavy, 5)).toBe(false);
  expect(gateMetBy(parseGate("you control a dragon"), heavy, 6)).toBe(true);
  expect(gateProbability(parseGate("you control a dragon"), heavy, 5)).toBe(0);
  const light = deckOf(dragons(20, 1));
  expect(gateMetBy(parseGate("you control a dragon"), light, 1)).toBe(false);
  expect(gateMetBy(parseGate("you control a dragon"), light, 2)).toBe(true);
  expect(lineGateMetBy(mkLine({ gate: parseGate("you control a dragon") }), light, 2)).toBe(true);
  expect(lineGateMetBy(mkLine({ gate: parseGate("you control a dragon") }), heavy, 2)).toBe(false);
  expect(lineGateMetBy(mkLine({ gate: parseGate("you control a dragon") }), undefined, 9)).toBe(false);
  expect(lineGateMetBy(mkLine(), undefined, 1)).toBe(true);
  // a gate no decklist settles is never met by any turn
  expect(gateMetBy(parseGate("an opponent has three or more poison counters"), light, 9)).toBe(false);
});

// CR 702.179a: speed starts at 1; CR 702.179d: it rises by 1, once each turn, while under 4 -- so "speed 4" is the earliest turn 4 (owner 2026-10-13), in any deck.
test("a max-speed gate is met from turn 4 in any deck, and with no deck at all (CR 702.179a, 702.179d)", () => {
  const deck = deckOf(copies(40, (i) => dc(`Rock ${i}`, "Artifact")));
  for (const turn of [1, 2, 3]) expect(gateMetBy(parseGate("speed 4"), deck, turn), `turn ${turn}`).toBe(false);
  for (const turn of [4, 5, 9]) expect(gateMetBy(parseGate("speed 4"), deck, turn), `turn ${turn}`).toBe(true);
  expect(gateMetBy(parseGate("speed 4"), [], 4)).toBe(true);
  expect(gateVerdict(parseGate("speed 4"), deck)).toBe("met");
  expect(gateVerdict(parseGate("speed 4"), [])).toBe("met");
  const line = mkLine({ gate: parseGate("speed 4") });
  expect(lineGateVerdict(line, undefined)).toBe("met");
  expect(lineGateMetBy(line, undefined, 3)).toBe(false);
  expect(lineGateMetBy(line, undefined, 4)).toBe(true);
  expect(gateProbability(parseGate("speed 4"), deck, 3)).toBe(0);
  expect(gateProbability(parseGate("speed 4"), deck)).toBe(1);
});

test("a count of lands cannot exceed the land drops: 'five or more lands' is not met by turn 4 whatever the deck", () => {
  const lands = deckOf(copies(60, (i) => dc(`Land ${i}`, "Land")));
  expect(gateMetBy(parseGate("you control five or more lands"), lands, 4)).toBe(false);
  expect(gateMetBy(parseGate("you control five or more lands"), lands, 5)).toBe(true);
  // ...and a land that is itself the holder of the gate takes a land drop of its own: a Tainted land needs its Swamp AND itself
  const swamps = deckOf(copies(40, (i) => dc(`Swamp ${i}`, "Basic Land \u2014 Swamp")));
  expect(gateMetBy(parseGate("you control a swamp"), swamps, 1)).toBe(true);
  expect(gateMetBy(parseGate("you control a swamp"), swamps, 1, true)).toBe(false);
  expect(gateMetBy(parseGate("you control a swamp"), swamps, 2, true)).toBe(true);
  expect(gateMetBy(parseGate("you control three or more lands with the same name"), deckOf(copies(36, () => dc("Forest", "Basic Land \u2014 Forest"))), 2)).toBe(false);
  expect(gateMetBy(parseGate("you control three or more lands with the same name"), deckOf(copies(36, () => dc("Forest", "Basic Land \u2014 Forest"))), 3)).toBe(true);
});

test("a 0-mana-value spell that holds a gate counts from turn 2, as the goldfish counts it (cast at the end of turn 1, on the board from the next); a land counts at turn 1", () => {
  const free = copies(30, (i) => ({ card: { name: `Free ${i}`, typeLine: "Artifact", oracleText: "", manaValue: 0 } as never, tags: null }) as DeckCard);
  const deck = deckOf(free);
  expect(gateProbability(parseGate("you control an artifact"), deck, 1)).toBe(0);
  expect(gateProbability(parseGate("you control an artifact"), deck, 2)!).toBeGreaterThan(0.3);
  // a land is played on turn 1 and counts then
  expect(gateProbability(parseGate("you control a swamp"), deckOf(copies(30, () => dc("Swamp", "Basic Land — Swamp"))), 1)!).toBeGreaterThan(0.3);
});

// #1191: the five "...or if you control a basic land" lands (Gleaming Bastion, Training Compound, Hidden Lair, Gathering Place, Dark Fortress) were unknown -- a source of no colour in any deck.
test("a basic-land gate (real text of the Gleaming Bastion cycle) is met by a deck of basics and unmet by one with none", () => {
  const g = parseGate("this land entered this turn or if you control a basic land");
  const basics = deckOf(copies(36, (i) => dc(`Island ${i}`, "Basic Land — Island")));
  const nonbasics = deckOf(copies(36, (i) => dc(`Utility ${i}`, "Land")));
  expect(gateVerdict(g, basics)).toBe("met");
  expect(gateVerdict(g, nonbasics)).toBe("unmet");
  expect(gateMetBy(g, basics, 3, true)).toBe(true);
  expect(gateMetBy(g, nonbasics, 9, true)).toBe(false);
});

test("a power gate counts creatures with that printed power or more; a '*' never counts (Fanatic of Rhonas)", () => {
  const g = parseGate("you control a creature with power 4 or greater");
  const big = (n: number): DeckCard[] => copies(n, (i) => ({ card: { name: `Big ${i}`, typeLine: "Creature — Giant", oracleText: "", manaValue: 3, power: "4" } as never, tags: null }));
  const small = copies(30, (i): DeckCard => ({ card: { name: `Small ${i}`, typeLine: "Creature — Elf", oracleText: "", manaValue: 1, power: "2" } as never, tags: null }));
  const star = copies(30, (i): DeckCard => ({ card: { name: `Star ${i}`, typeLine: "Creature — Elf", oracleText: "", manaValue: 1, power: "*" } as never, tags: null }));
  expect(gateVerdict(g, deckOf(big(15)))).toBe("met");
  expect(gateVerdict(g, deckOf(big(1)))).toBe("unmet");
  expect(gateVerdict(g, deckOf(small))).toBe("unmet");
  expect(gateVerdict(g, deckOf(star))).toBe("unmet");
});

// #1191: what a permanent is, as a gate counts it. The DFC is Delver of Secrets (corpus: card.power is null, faces[0].power "1").
test("permOf: basic supertype (snow-covered counts), Wastes is not a basic land type but is basic, a non-basic land is not, a '*' power never counts, a DFC reads its first face's power", () => {
  const perm = (c: Record<string, unknown>) => permOf({ card: { name: "X", manaValue: 0, oracleText: "", ...c } as never, tags: null })!;
  expect(perm({ typeLine: "Basic Snow Land — Forest" })).toMatchObject({ basic: true, land: true });
  expect(perm({ name: "Wastes", typeLine: "Basic Land" })).toMatchObject({ basic: true, land: true, power: null });
  expect(perm({ typeLine: "Land — Gate" })).toMatchObject({ basic: false, land: true });
  expect(perm({ typeLine: "Creature — Goyf", power: "*" }).power).toBeNull();
  expect(perm({ typeLine: "Creature — Elf", power: "4" }).power).toBe(4);
  const delver = perm({ name: "Delver of Secrets // Insectile Aberration", typeLine: "Creature — Human Wizard // Creature — Human Insect", power: null, faces: [{ power: "1" }, { power: "3" }] });
  expect(delver.power).toBe(1);
  expect(delver.subtypes.has("wizard")).toBe(true);
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// #1267 (owner 2026-10-17): the three kinds a decklist can estimate. Synthetic decks of LANDS (the default filler is 60 instants, which would be graveyard fuel).
const land = (i: number): DeckCard => dc(`Land ${i}`, "Land");
const landsDeck = (...own: DeckCard[][]): DeckCard[] => { const cards = own.flat(); return [...cards, ...copies(100 - cards.length, land)]; };
const ability = (over: Record<string, unknown>) => ({ kind: "on-cast", effect: { kind: "" }, emits: [], ...over }) as never;
const withAbilities = (c: DeckCard, abilities: unknown[], mv = 1): DeckCard => ({ card: { ...c.card, manaValue: mv } as never, tags: manaTags([], { abilities: abilities as never }) });
const spell = (i: number, type = "Instant", mv = 1): DeckCard => ({ card: { name: `${type} ${i}`, typeLine: type, oracleText: "", manaValue: mv } as never, tags: null });
const creature = (i: number, mv = 1, extra: unknown[] = []): DeckCard => withAbilities(dc(`Creature ${i}`, "Creature — Elf"), extra, mv);

test("threshold: a graveyard fills from the instants and sorceries the deck casts and the discard, mill and surveil it does to itself; Poisson on the expected count, at the median clock", () => {
  const seven = parseGate("there are seven or more cards in your graveyard");
  const one = parseGate("there is a card in your graveyard");
  expect(gateProbability(seven, landsDeck(copies(60, (i) => spell(i))))!).toBeGreaterThan(0.5);
  expect(gateVerdict(seven, landsDeck(copies(60, (i) => spell(i))))).toBe("met");
  // a deck with no spell and nothing that fills: nothing ever reaches the graveyard
  expect(gateProbability(seven, landsDeck([]))).toBe(0);
  expect(gateProbability(one, landsDeck([]))).toBe(0);
  expect(gateVerdict(seven, landsDeck(copies(6, (i) => spell(i))))).toBe("unmet");
  // a deck of lands plus self-fillers: a looter's discard, a surveil, a mill-yourself
  const fillers = copies(25, (i) => withAbilities(dc(`Looter ${i}`, "Creature — Human"), [ability({ kind: "activated", emits: [{ verb: i % 3 === 0 ? "discard" : i % 3 === 1 ? "surveil" : "mill", subject: { control: "you" } }] })], 1));
  expect(gateVerdict(one, landsDeck(fillers))).toBe("met");
  // an opponent's graveyard, or every player's discard, is not yours
  const theirs = copies(25, (i) => withAbilities(dc(`Edict ${i}`, "Creature — Human"), [ability({ emits: [{ verb: "discard", subject: { control: "opp" } }, { verb: "mill", subject: { control: "opp" } }] })], 1));
  expect(gateVerdict(one, landsDeck(theirs))).toBe("unmet");
});

test("threshold by a turn: an expensive spell is not cast yet, and no more than one spell a turn after the first is counted", () => {
  const two = parseGate("there are two or more instant and/or sorcery cards in your graveyard");
  const cheap = landsDeck(copies(60, (i) => spell(i, i % 2 ? "Instant" : "Sorcery", 1)));
  const dear = landsDeck(copies(60, (i) => spell(i, "Instant", 7)));
  expect(gateProbability(two, cheap, 1)).toBe(0);
  expect(gateProbability(two, cheap, 9)!).toBeGreaterThan(gateProbability(two, cheap, 4)!);
  expect(gateProbability(two, dear, 6)).toBe(0);
  expect(gateProbability(two, dear, 9)!).toBeGreaterThan(0.5);
});

test("threshold, typed: only matching cards count -- instants and sorceries feed an instant/sorcery gate and not an Elf gate (Dark Petition, Lys Alana Dignitary)", () => {
  const elf = parseGate("there is an elf card in your graveyard");
  const spells = landsDeck(copies(60, (i) => spell(i)));
  expect(gateVerdict(parseGate("there are two or more instant and/or sorcery cards in your graveyard"), spells)).toBe("met");
  expect(gateVerdict(parseGate("there are two or more creature cards in your graveyard"), spells)).toBe("unmet");
  expect(gateVerdict(elf, spells)).toBe("unmet");
  // a looter deck that is mostly Elves puts Elves there; one with none does not
  const loot = (i: number) => withAbilities(dc(`Elf Looter ${i}`, "Creature — Elf Shaman"), [ability({ kind: "activated", emits: [{ verb: "discard", subject: { control: "you" } }] })], 1);
  expect(gateVerdict(elf, landsDeck(copies(40, loot)))).toBe("met");
  const nonElf = (i: number) => withAbilities(dc(`Human Looter ${i}`, "Creature — Human"), [ability({ kind: "activated", emits: [{ verb: "discard", subject: { control: "you" } }] })], 1);
  expect(gateVerdict(elf, landsDeck(copies(40, nonElf)))).toBe("unmet");
});

test("counter, the card's own ability puts it there: met from the cast turn plus the counters needed, by a turn (Pyramid of the Pantheon, Tablet of Compleation)", () => {
  const pyramid: ReturnType<typeof parseGate> = { kind: "counter", counter: "brick", need: 3, put: { by: "self", readyTurn: 5, activation: { mana: 2, refund: 1, taps: true, activations: 3 } }, text: "there are three or more brick counters on this artifact" };
  const deck = landsDeck([]);
  expect(gateProbability(pyramid, deck, 4)).toBe(0);
  expect(gateProbability(pyramid, deck, 5)).toBe(1);
  expect(gateProbability(pyramid, deck)).toBe(1);
  expect(gateVerdict(pyramid, deck)).toBe("met");
  expect(gateVerdict({ ...pyramid, put: { by: "self", readyTurn: 12 } } as typeof pyramid, deck)).toBe("unmet");
});

test("counter, the deck does NOT supply it: a counter gate with no put of its own is unmet whatever the deck holds (the dropped supply case over-claimed: the counter rarely lands on the holder)", () => {
  const druid = parseGate("this creature has a +1/+1 counter on it");
  const adder = (i: number) => withAbilities(dc(`Adder ${i}`, "Enchantment"), [ability({ emits: [{ verb: "counter-added", subject: { control: "you", counter: "+1/+1", type: "creature" } }] })], 3);
  expect(gateProbability(druid, landsDeck(copies(40, adder)))).toBe(0);
  expect(gateVerdict(druid, landsDeck(copies(40, adder)))).toBe("unmet");
  // ...and Incubation Druid's own Adapt (derive's `put: self` at turn 5) is met from the turn it can pay {3}{G}{G}
  const adapt: ReturnType<typeof parseGate> = { kind: "counter", counter: "+1/+1", need: 1, put: { by: "self", readyTurn: 5, activation: { mana: 5, refund: 0, taps: false, activations: 1 } }, text: druid.text };
  expect(gateProbability(adapt, landsDeck([]), 4)).toBe(0);
  expect(gateProbability(adapt, landsDeck([]), 5)).toBe(1);
});

test("threshold, supertyped: a legendary creature card needs a legendary creature to reach the yard (The Grey Havens)", () => {
  const g = parseGate("there is a legendary creature card in your graveyard");
  const loot = (legend: boolean) => (i: number) => withAbilities(dc(`Looter ${i}`, legend ? "Legendary Creature — Human" : "Creature — Human"), [ability({ kind: "activated", emits: [{ verb: "discard", subject: { control: "you" } }] })], 1);
  expect(gateVerdict(g, landsDeck(copies(40, loot(true))))).toBe("met");
  expect(gateVerdict(g, landsDeck(copies(40, loot(false))))).toBe("unmet");
  expect(gateVerdict(g, landsDeck(copies(60, (i) => spell(i))))).toBe("unmet");
});

test("counter, only as the card begins the game on the battlefield: the chance it is in the opening hand and the player is not first (Gemstone Caverns), well under the bar", () => {
  const caverns: ReturnType<typeof parseGate> = { kind: "counter", counter: "luck", need: 1, put: { by: "opening-hand" }, text: "gemstone caverns has a luck counter on it" };
  const p = gateProbability(caverns, landsDeck([]))!;
  expect(p).toBeCloseTo((7 / 100) * 0.75, 5);
  expect(gateVerdict(caverns, landsDeck([]))).toBe("unmet");
  expect(gateProbability(caverns, landsDeck([]), 1)).toBeCloseTo(p, 5);
});

test("turn-event: a land played this turn needs a land DROP on that turn: the lands seen must reach the turn number, not merely exist (River of Tears)", () => {
  const g = parseGate("you played a land this turn");
  expect(gateVerdict(g, landsDeck([]))).toBe("met");
  expect(gateMetBy(g, landsDeck([]), 1)).toBe(true);
  expect(gateVerdict(g, copies(100, (i) => spell(i)))).toBe("unmet");
  // 36 lands in 99 (a real mana base): a land drop on turn 9 is far from certain (a simulation reads about .39), so the conservative form is below the bar there; early turns are fine
  const real = [...copies(36, land), ...copies(64, (i) => spell(i))];
  expect(gateProbability(g, real, 2)!).toBeGreaterThan(0.5);
  expect(gateProbability(g, real, 9)!).toBeLessThan(0.5);
  expect(gateVerdict(g, real)).toBe("unmet");
  expect(gateProbability(g, real, 9)!).toBeLessThan(gateProbability(g, real, 3)!);
});

test("turn-event: 'you attacked this turn' is the creature board count a turn late -- a creature cast on turn 1 attacks on turn 2 (Mardu Warshrieker)", () => {
  const g = parseGate("you attacked this turn");
  const many = landsDeck(copies(30, (i) => creature(i)));
  expect(gateVerdict(g, many)).toBe("met");
  expect(gateProbability(g, many, 1)).toBe(0);
  expect(gateProbability(g, many, 3)!).toBeGreaterThan(0.5);
  expect(gateVerdict(g, landsDeck([]))).toBe("unmet");
  expect(gateVerdict(g, landsDeck(copies(30, (i) => spell(i))))).toBe("unmet");
  // the holder is a creature of the deck and is not ITS OWN attacker: a deck whose only creature is one card cannot meet it, whatever the turn
  expect(gateProbability(g, landsDeck([creature(0)]), 9)).toBe(0);
  expect(gateProbability(g, landsDeck(copies(2, (i) => creature(i))), 9)!).toBeGreaterThan(0);
});

test("turn-event: an opponent lost life this turn -- a drain / damage / life-loss source the deck can cast, never an attacker (Famished Foragers, Flamecache Gecko)", () => {
  const g = parseGate("an opponent lost life this turn");
  const drain = (i: number) => withAbilities(dc(`Drain ${i}`, "Sorcery"), [ability({ emits: [{ verb: "lose-life", subject: { control: "opp" } }] })], 2);
  const burn = (i: number) => withAbilities(dc(`Burn ${i}`, "Instant"), [ability({ emits: [{ verb: "non-combat-damage", subject: { control: "any" } }] })], 1);
  const gain = (i: number) => withAbilities(dc(`Gain ${i}`, "Instant"), [ability({ emits: [{ verb: "gain-life", subject: { control: "you" } }, { verb: "lose-life", subject: { control: "you" } }] })], 1);
  // an attack is not a hit: attackers alone do not meet it
  expect(gateVerdict(g, landsDeck(copies(30, (i) => creature(i))))).toBe("unmet");
  expect(gateVerdict(g, landsDeck(copies(30, drain)))).toBe("met");
  expect(gateVerdict(g, landsDeck(copies(30, burn)))).toBe("met");
  expect(gateVerdict(g, landsDeck(copies(30, gain)))).toBe("unmet");
  expect(gateVerdict(g, landsDeck([drain(0)]))).toBe("unmet");
  expect(gateVerdict(g, landsDeck([]))).toBe("unmet");
  expect(gateProbability(g, landsDeck(copies(30, drain)), 1)).toBe(0);
});

test("turn-event: a creature died / a permanent left this turn needs a repeatable sacrifice outlet (and a creature to feed it, for 'died'); otherwise nothing (Caravan Vigil, Hidden Herbalists)", () => {
  const died = parseGate("a creature died this turn");
  const left = parseGate("a permanent left the battlefield under your control this turn");
  const outlet = (i: number) => withAbilities(dc(`Outlet ${i}`, "Creature — Goblin"), [ability({ kind: "activated", cost: "Sacrifice a creature", emits: [{ verb: "sacrifice", subject: { control: "you", type: "creature" } }, { verb: "dies", subject: { control: "you" } }] })], 1);
  const selfSac = (i: number) => withAbilities(dc(`Petal ${i}`, "Artifact"), [ability({ kind: "activated", emits: [{ verb: "sacrifice", subject: { control: "you", self: true } }, { verb: "dies", subject: { control: "you", self: true } }] })], 0);
  expect(gateVerdict(died, landsDeck(copies(30, outlet)))).toBe("met");
  expect(gateVerdict(left, landsDeck(copies(30, outlet)))).toBe("met");
  expect(gateVerdict(died, landsDeck(copies(30, selfSac)))).toBe("unmet");
  expect(gateVerdict(left, landsDeck(copies(30, selfSac)))).toBe("unmet");
  expect(gateVerdict(died, landsDeck([]))).toBe("unmet");
  expect(gateVerdict(left, landsDeck([outlet(0)]))).toBe("unmet");
  // an outlet and nothing to sacrifice: 'a creature died' needs a creature too
  const noBody = (i: number) => withAbilities(dc(`Altar ${i}`, "Artifact"), [ability({ kind: "activated", emits: [{ verb: "sacrifice", subject: { control: "you", type: "creature" } }, { verb: "dies", subject: { control: "you" } }] })], 1);
  expect(gateVerdict(died, landsDeck(copies(30, noBody)))).toBe("unmet");
  expect(gateVerdict(left, landsDeck(copies(30, noBody)))).toBe("met");
  // an outlet is for what it sacrifices: "sacrifice a land" is a permanent leaving and no creature dying (Zuran Orb)
  const landOutlet = (i: number) => withAbilities(dc(`Orb ${i}`, "Artifact"), [ability({ kind: "activated", emits: [{ verb: "sacrifice", subject: { control: "you", type: "land" } }] })], 0);
  expect(gateVerdict(left, landsDeck(copies(30, landOutlet)))).toBe("met");
  expect(gateVerdict(died, landsDeck([...copies(30, landOutlet), ...copies(30, (i) => creature(i))]))).toBe("unmet");
});

test("turn-event: 'this land entered this turn' is the entry turn only, and the evaluator has no entry turn: unmet by every turn in every deck (Mirrex)", () => {
  const g = parseGate("this land entered this turn");
  for (const deck of [landsDeck([]), landsDeck(copies(30, (i) => creature(i)))]) {
    expect(gateProbability(g, deck)).toBe(0);
    expect(gateProbability(g, deck, 1)).toBe(0);
    expect(gateVerdict(g, deck)).toBe("unmet");
  }
});

test("turn-event: a spell an opponent cast this turn is supplied by no decklist: unmet by every turn in every deck (Veil of Summer; #1357)", () => {
  const g = parseGate("an opponent has cast a blue or black spell this turn");
  expect(g).toMatchObject({ kind: "turn-event", event: "opponent-cast" });
  for (const deck of [landsDeck([]), landsDeck(copies(30, (i) => creature(i)))]) {
    expect(gateProbability(g, deck)).toBe(0);
    expect(gateProbability(g, deck, 3)).toBe(0);
  }
});

test("the estimated kinds are named (the goldfish does not play them per game)", () => {
  for (const [g, yes] of [["there is a card in your graveyard", true], ["this creature has a +1/+1 counter on it", true], ["you attacked this turn", true], ["you control a dragon", false], ["speed 4", false], ["you win", false]] as const)
    expect(isEstimatedGate(parseGate(g)), g).toBe(yes);
});
