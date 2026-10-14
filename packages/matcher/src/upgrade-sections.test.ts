import { describe, expect, test } from "vitest";
import type { Card } from "@edh-seer/engine";
import { landFacts } from "./land-score.js";
import fixtures from "./same-job.fixtures.json" with { type: "json" };
import rocks from "./ramp-colour.fixtures.json" with { type: "json" };
import moxes from "./fixtures/mana-colour-sources.json" with { type: "json" };
import { rolesOfCard } from "./quality.js";
import { colourDeficit } from "./mana-audit.js";
import { colouredNetYield, isPlainDork, jobOf, landsToBattlefield, netPositiveMana, netYield, themedSubjects, sameFetchAnyColour } from "./same-job.js";
import { answerCovers, gameChangerOption, landOptions, newConditions, roleOptions, sameJob, strictlyBetter, swapCloser } from "./upgrade-sections.js";
import type { DeckCard } from "./types.js";
import { FREE_TAP, manaTags, mkLine, tapFor, withLines } from "./mana-test-support.js";

/** Cards as printed (oracle text read 2026-09-30); the text rules read nothing else. */
const card = (name: string, typeLine: string, oracleText: string, producedMana?: string[]): DeckCard => ({
  card: { name, typeLine, oracleText, keywords: [], colors: [], manaValue: 0, ...(producedMana ? { producedMana } : {}) } as Card,
  tags: null,
});

test("strictly better: at least as good everywhere, better somewhere", () => {
  expect(strictlyBetter({ manaValue: 3, timing: 2 }, { manaValue: 1, timing: 2 })).toEqual(["manaValue"]);
  expect(strictlyBetter({ manaValue: 3, timing: 2 }, { manaValue: 1, timing: 0 })).toBeNull();
  expect(strictlyBetter({ manaValue: 3, timing: 2, breadth: 2 }, { manaValue: 1, timing: 2 })).toBeNull();
  expect(strictlyBetter({ manaValue: 3 }, { manaValue: 1, timing: 2 })).toBeNull();
});

test("a second ability is never a gain on its own, but may not be lost", () => {
  expect(strictlyBetter({ manaValue: 3, timing: 1, extraValue: 0 }, { manaValue: 3, timing: 1, extraValue: 1 })).toEqual([]);
  expect(strictlyBetter({ manaValue: 3, timing: 1, extraValue: 1 }, { manaValue: 2, timing: 1, extraValue: 0 })).toBeNull();
});

test("a shuffle is compared only with a shuffle: Boomerang never beats Chaos Warp, and Chaos Warp never replaces Murder", () => {
  expect(strictlyBetter({ manaValue: 3, timing: 2, permanence: 0 }, { manaValue: 2, timing: 2, permanence: 1 })).toBeNull();
  expect(strictlyBetter({ manaValue: 3, timing: 2, permanence: 2 }, { manaValue: 2, timing: 2, permanence: 0 })).toBeNull();
  expect(strictlyBetter({ manaValue: 3, timing: 2, permanence: 0 }, { manaValue: 2, timing: 2, permanence: 0 })).toEqual(["manaValue"]);
});

const signet = card("Orzhov Signet", "Artifact", "{1}, {T}: Add {W}{B}.", ["W", "B"]);
const moxAmber = card("Mox Amber", "Legendary Artifact", "{T}: Add one mana of any color among legendary creatures and planeswalkers you control.", ["W", "U", "B", "R", "G"]);
const cribSwap = card("Crib Swap", "Kindred Instant — Shapeshifter", "Changeling (This card is every creature type.)\nExile target creature. Its controller creates a 1/1 colorless Shapeshifter creature token with changeling.");
const swords = card("Swords to Plowshares", "Instant", "Exile target creature. Its controller gains life equal to its power.");

test("a condition the cut does not print is a different card: Mox Amber is not Orzhov Signet", () => {
  expect(newConditions(signet, moxAmber)).toBe(true);
  expect(newConditions(cribSwap, swords)).toBe(false);
});

test("one colour word each: a colorless token does not excuse a black-or-red limit", () => {
  const purge = card("Celestial Purge", "Instant", "Exile target black or red permanent.");
  expect(newConditions(cribSwap, purge)).toBe(true);
});

test("a stat limit must be the same limit: Isolate is not Despark", () => {
  const despark = card("Despark", "Instant", "Exile target permanent with mana value 4 or greater.");
  const isolate = card("Isolate", "Instant", "Exile target permanent with mana value 1.");
  expect(newConditions(despark, isolate)).toBe(true);
});

test("reach the cut has is kept: one creature is not your whole team", () => {
  const formation = card("Unbreakable Formation", "Instant", "Creatures you control gain indestructible until end of turn.");
  const willing = card("Gods Willing", "Instant", "Target creature you control gains protection from the color of your choice until end of turn. Scry 1.");
  expect(newConditions(formation, willing)).toBe(true);
});

test("a trigger must wait for the same thing, the card's own name aside", () => {
  const moldervine = card("Moldervine Reclamation", "Enchantment", "Whenever a creature you control dies, you gain 1 life and draw a card.");
  const season = card("Season of Growth", "Enchantment", "Whenever a creature you control enters, scry 1.\nWhenever you cast a spell that targets a creature you control, draw a card.");
  expect(newConditions(moldervine, season)).toBe(true);
  const a = card("Rock A", "Artifact", "When Rock A enters, draw a card.");
  const b = card("Rock B", "Artifact", "When this artifact enters, draw a card.");
  expect(newConditions(a, b)).toBe(false);
});

test("damage and -N/-N are capped by toughness: Flame-Blessed Bolt is not Swords to Plowshares", () => {
  const bolt = card("Flame-Blessed Bolt", "Instant", "Flame-Blessed Bolt deals 2 damage to target creature or planeswalker. If that creature or planeswalker would die this turn, exile it instead.");
  expect(newConditions(swords, bolt)).toBe(true);
});

test("the same job: never a creature, the same kind of card, and at least the cut's yield", () => {
  const drake = card("Crackling Drake", "Creature — Drake", "When Crackling Drake enters, draw a card.");
  const bolt = card("Divination", "Sorcery", "Draw two cards.");
  const cost = card("Ambition's Cost", "Sorcery", "You draw three cards and you lose 3 life.");
  const insist = card("Insist", "Sorcery", "The next creature spell you cast this turn can't be countered. Draw a card.");
  expect(sameJob(drake, bolt, "draw")).toBe(false);
  expect(sameJob(cribSwap, card("Pacifism", "Enchantment — Aura", "Enchant creature"), "targetedRemoval")).toBe(false);
  expect(sameJob(cost, insist, "draw")).toBe(false);
});

test("ramp keeps every colour the cut makes", () => {
  const talisman = card("Talisman of Progress", "Artifact", "{T}: Add {C}.\n{T}: Add {W} or {U}. Talisman of Progress deals 1 damage to you.", ["C", "W", "U"]);
  const mindStone = card("Mind Stone", "Artifact", "{T}: Add {C}.", ["C"]);
  expect(sameJob(signet, mindStone, "ramp")).toBe(false);
  expect(sameJob(mindStone, talisman, "ramp")).toBe(false);
});

test("an answer covers the cut's card types with no new limit", () => {
  const creature = [{ type: "creature", control: "opp" }];
  expect(answerCovers(creature, [{ type: "permanent", notType: ["land"], control: "opp" }])).toBe(true);
  expect(answerCovers(creature, [{ type: "enchantment", control: "opp" }])).toBe(false);
  expect(answerCovers(creature, [{ type: ["creature", "enchantment"], subtype: "spirit", control: "opp" }])).toBe(false);
});

const needed = new Set(["W", "B"] as const);
const land = (name: string, typeLine: string, oracleText: string, producedMana: string[]) => {
  // The derived line these specs stand for: one free tap for the colours (Exotic Orchard's colours come from the opponents' lands).
  const line = name === "Exotic Orchard" ? tapFor([], { anyColour: "opponent-lands" }) : tapFor(producedMana);
  const dc = { ...card(name, typeLine, oracleText, producedMana), tags: manaTags([line]) };
  return { facts: landFacts(dc, needed, []), dc, gameChanger: false };
};
const temple = land("Temple of Silence", "Land", "Temple of Silence enters tapped.\nWhen Temple of Silence enters, scry 1.\n{T}: Add {W} or {B}.", ["W", "B"]);
const chapel = land("Isolated Chapel", "Land", "Isolated Chapel enters tapped unless you control a Plains or a Swamp.\n{T}: Add {W} or {B}.", ["W", "B"]);
const plains = land("Plains", "Basic Land — Plains", "({T}: Add {W}.)", ["W"]);

test("a tapped dual gives way to a check land; the shock-style condition is what tapped measures", () => {
  expect(landOptions([temple], [chapel], 0).map((o) => [o.cut, o.options.map((x) => x.add)])).toEqual([["Temple of Silence", ["Isolated Chapel"]]]);
});

test("never adds a two-faced land, an artifact land, or one whose extra lines carry a condition", () => {
  const pathway = land("Brightclimb Pathway // Grimclimb Pathway", "Land // Land", "{T}: Add {W}.\n//\n{T}: Add {B}.", ["W", "B"]);
  const den = land("Ancient Den", "Artifact Land", "{T}: Add {W}.", ["W"]);
  const grove = land("Grove of the Burnwillows", "Land", "{T}: Add {C}.\n{T}: Add {W} or {B}. Each opponent gains 1 life.", ["C", "W", "B"]);
  expect(landOptions([temple, plains], [pathway, den, grove], 0)).toEqual([]);
});

test("basics are cut last, and never below the floor; a land that is sometimes tapped never replaces one that never is", () => {
  const plainsB = land("Plains", "Basic Land — Plains", "({T}: Add {W}.)", ["W"]);
  const scrubland = land("Scrubland", "Land — Plains Swamp", "({T}: Add {W} or {B}.)", ["W", "B"]);
  expect(landOptions([temple, plains, plainsB], [chapel, scrubland], 0).map((o) => [o.cut, o.options.map((x) => x.add)]))
    .toEqual([["Temple of Silence", ["Scrubland", "Isolated Chapel"]], ["Plains", ["Scrubland"]]]);
  expect(landOptions([temple, plains, plainsB], [chapel, scrubland], 2).map((o) => o.cut)).toEqual(["Temple of Silence"]);
});

test("a land whose mana comes on a condition is never cut: Exotic Orchard is not colourless", () => {
  const orchard = land("Exotic Orchard", "Land", "{T}: Add one mana of any color that a land an opponent controls could produce.", ["W", "U", "B", "R", "G"]);
  expect(orchard.facts.utility).toContain("conditional-mana");
  expect(landOptions([orchard], [chapel], 0)).toEqual([]);
});

/** Cards as the corpus derives them (tags read 2026-10-03), for the Game Changer upgrade. */
const real = (name: keyof typeof fixtures) => fixtures[name] as unknown as DeckCard;
const candidate = (d: DeckCard) => ({ dc: d, roles: rolesOfCard(d), links: 0 });
const rated = (q: Record<string, number>) => (name: string) => q[name] ?? -1;

test("a Game Changer upgrade: the same group, rated higher, and only a Game Changer", () => {
  const signet = real("Arcane Signet");
  const quality = rated({ "Arcane Signet": 92, "Mana Vault": 98, "Mox Diamond": 98, "Painful Truths": 80 });
  const vault = gameChangerOption("ramp", signet, candidate(real("Mana Vault")), quality);
  expect(vault).toMatchObject({ add: "Mana Vault", role: "ramp", gameChanger: true, upgrade: "game-changer", gained: [] });
  // Rated lower than the cut: Sol Ring is not traded for anything.
  expect(gameChangerOption("ramp", signet, candidate(real("Mana Vault")), rated({ "Arcane Signet": 99, "Mana Vault": 98 }))).toBeNull();
  // Not a Game Changer: the strict rule's to judge.
  expect(gameChangerOption("ramp", signet, candidate(real("Arcane Signet")), quality)).toBeNull();
  // Once is not every turn: Lion's Eye Diamond and Jeska's Will never replace a Signet.
  for (const once of ["Lion's Eye Diamond", "Jeska's Will"] as const) {
    expect(gameChangerOption("ramp", signet, candidate(real(once)), rated({ "Arcane Signet": 92, [once]: 99 }))).toBeNull();
  }
  // Not the section's job.
  expect(gameChangerOption("consistency", signet, candidate(real("Mana Vault")), quality)).toBeNull();
});

test("a cut's Game Changer upgrades come before its strict options, strongest first", () => {
  const quality = rated({ "Arcane Signet": 92, "Mana Vault": 97, "Mox Diamond": 98 });
  const [only] = roleOptions("ramp", [real("Arcane Signet")], [], { pool: [candidate(real("Mana Vault")), candidate(real("Mox Diamond"))], quality });
  expect(only!.options.map((o) => o.add)).toEqual(["Mox Diamond", "Mana Vault"]);
  expect(roleOptions("ramp", [real("Arcane Signet")], [])).toEqual([]);
});

/** AN UNREAD AMOUNT IS NOT A WORSE ONE (review of #1051): the add's X or conditional amount leaves
 *  `amount` unset, and the swap is still judged on everything else. A smaller amount still refuses. */
test("strictlyBetter skips an amount the add cannot state, and refuses a smaller one", () => {
  expect(strictlyBetter({ manaValue: 2, timing: 1, amount: 2, rateFloor: 50 }, { manaValue: 1, timing: 1, rateFloor: 90 })).toEqual(["manaValue", "rateFloor"]);
  expect(strictlyBetter({ manaValue: 2, timing: 1, amount: 2 }, { manaValue: 1, timing: 1, amount: 1 })).toBeNull();
});

test("land cuts go worst first: always tapped before sometimes before never, then a cut making no short colour", () => {
  const deficit = { B: 5 };
  const mk = (name: string, oracle: string, produced: string[]) => land(name, "Land", oracle, produced);
  const tappedMono = mk("Tapped Mono", "Tapped Mono enters tapped.\n{T}: Add {B}.", ["B"]);
  const tappedDual = mk("Tapped Dual", "Tapped Dual enters tapped.\n{T}: Add {W} or {B}.", ["W", "B"]);
  const checkDual = mk("Check Dual", "Check Dual enters tapped unless you control a Plains or a Swamp.\n{T}: Add {W} or {B}.", ["W", "B"]);
  const openMono = mk("Open Mono", "{T}: Add {W}.", ["W"]);
  const better = mk("Better Land", "{T}: Add {W} or {B}.", ["W", "B"]);
  const tappedMonoW = mk("Tapped Mono W", "Tapped Mono W enters tapped.\n{T}: Add {W}.", ["W"]);
  const out = landOptions([openMono, checkDual, tappedDual, tappedMono, tappedMonoW], [better], 0, deficit).map((o) => o.cut);
  // Better Land only improves on lands that lack a colour or enter tapped: Open Mono gains B.
  // Tapped Mono W makes no short colour, so it goes before the two always-tapped lands that make black (those two tie; the old order, the best add, splits them).
  expect(out).toEqual(["Tapped Mono W", "Tapped Mono", "Tapped Dual", "Check Dual", "Open Mono"]);
});

test("within a tier the cut making no short colour goes first, whatever the old tiebreaks say; flipping the shortfall flips them", () => {
  const mk = (name: string, oracle: string, produced: string[]) => land(name, "Land", oracle, produced);
  // Same tier, same best add (one colour gained), so only the cut's name would order them: A before Z.
  const high = mk("A High W", "A High W enters tapped.\n{T}: Add {W}.", ["W"]);
  const low = mk("Z Low B", "Z Low B enters tapped.\n{T}: Add {B}.", ["B"]);
  const better = mk("Better Land", "{T}: Add {W} or {B}.", ["W", "B"]);
  const order = (deficit: Partial<Record<"W" | "B", number>>) => landOptions([high, low], [better], 0, deficit).map((o) => o.cut);
  expect(order({ W: 4 })).toEqual(["Z Low B", "A High W"]);
  expect(order({ B: 4 })).toEqual(["A High W", "Z Low B"]);
});

test("a land add that makes the short colour ranks above one that does not, before the tapped tiebreak", () => {
  const mk = (name: string, oracle: string, produced: string[]) => land(name, "Land", oracle, produced);
  const cut = mk("Tapped Mono B", "Tapped Mono B enters tapped.\n{T}: Add {B}.", ["B"]);
  const openB = mk("Open B", "{T}: Add {B}.", ["B"]);
  const checkDual = mk("Check Dual", "Check Dual enters tapped unless you control a Swamp.\n{T}: Add {W} or {B}.", ["W", "B"]);
  const adds = (deficit: Partial<Record<"W" | "B", number>>) => landOptions([cut], [openB, checkDual], 0, deficit).map((o) => o.options.map((x) => x.add));
  // No shortfall: the old order stands (fewer tapped first).
  expect(adds({})).toEqual([["Open B", "Check Dual"]]);
  // White is short: the add that makes it goes first although it can enter tapped.
  expect(adds({ W: 3 })).toEqual([["Check Dual", "Open B"]]);
});

/** Rocks as the corpus derives them (read from the static build, 2026-10-08). */
const rock = (name: keyof typeof rocks) => rocks[name] as unknown as DeckCard;
describe("a rock that makes a colour the deck is short of (coverage swap)", () => {
  const ramp = (cut: DeckCard, adds: DeckCard[], deficit: Partial<Record<"W" | "U" | "B" | "R" | "G", number>>) =>
    roleOptions("ramp", [cut], adds.map(candidate), undefined, deficit).map((o) => [o.cut, o.options.map((x) => [x.add, x.colour, x.gained])]);

  test("Fire Diamond to Talisman of Creativity when blue is short, and not when it is not", () => {
    const fd = rock("Fire Diamond");
    const tal = rock("Talisman of Creativity");
    expect(ramp(fd, [tal], { U: 4 })).toEqual([["Fire Diamond", [["Talisman of Creativity", ["U"], []]]]]);
    expect(ramp(fd, [tal], {})).toEqual([]);
    expect(ramp(fd, [tal], { R: 4 })).toEqual([]);
  });

  test("the swap goes one way: Talisman to Fire Diamond closes nothing", () => {
    expect(ramp(rock("Talisman of Creativity"), [rock("Fire Diamond")], { U: 4, R: 4 })).toEqual([]);
  });

  test("Mind Stone to a Signet that makes the short colours; its draw does not protect it", () => {
    expect(ramp(rock("Mind Stone"), [rock("Izzet Signet")], { U: 4, R: 2 })).toEqual([["Mind Stone", [["Izzet Signet", ["U", "R"], []]]]]);
    expect(roleOptions("ramp", [rock("Mind Stone")], [candidate(rock("Izzet Signet"))], undefined, { U: 4 })[0]!.options[0]!.lost).toEqual(["draw"]);
  });

  test("a dearer rock is never offered for a colour: a Talisman at mana value 6 does not replace Fire Diamond", () => {
    const tal = rock("Talisman of Creativity");
    const dear = { ...tal, card: { ...tal.card, name: "Costly Talisman", manaValue: 6 } } as unknown as DeckCard;
    expect(ramp(rock("Fire Diamond"), [dear], { U: 4 })).toEqual([]);
  });

  test("a rock that produces more mana than it costs is never cut for colour", () => {
    expect(ramp(rock("Sol Ring"), [rock("Izzet Signet")], { U: 4 })).toEqual([]);
  });

  test("an Aura is not a rock: a Signet never replaces Wild Growth", () => {
    expect(ramp(rock("Wild Growth"), [rock("Izzet Signet")], { U: 4 })).toEqual([]);
  });
});

describe("a swap is judged by the yardstick it is meant to move", () => {
  const spell = (name: string, cost: string, mv: number): DeckCard => ({ ...card(name, "Sorcery", ""), card: { ...card(name, "Sorcery", "").card, manaCost: cost, manaValue: mv } });
  const basic = (name: string, c: string) => card(name, `Basic Land — ${name}`, `({T}: Add {${c}}.)`, [c]);
  const fill = (deck: DeckCard[]) => [...deck, ...Array.from({ length: 100 - deck.length }, (_, i) => spell(`Filler ${i}`, "{1}", 1))];
  const izzet = (demand: DeckCard) => fill([demand, rock("Fire Diamond"), ...Array.from({ length: 12 }, () => basic("Island", "U")), ...Array.from({ length: 24 }, () => basic("Mountain", "R"))]);
  const offered = (deck: DeckCard[]) => roleOptions("ramp", [rock("Fire Diamond")], [candidate(rock("Talisman of Creativity"))], undefined, colourDeficit(deck),
    swapCloser(deck, [])).flatMap((o) => o.options.map((x) => x.add));

  test("a Talisman that is not a source yet when the short demand falls due closes nothing, and is not offered", () => {
    const early = izzet(spell("Counterspell", "{U}{U}", 2));
    expect(colourDeficit(early).U).toBeGreaterThan(0);
    expect(swapCloser(early, [])("Fire Diamond", rock("Talisman of Creativity"))).toBe(0);
    expect(offered(early)).toEqual([]);
  });

  test("the same Talisman is offered when the short demand falls due after it can tap", () => {
    const late = izzet(spell("Big Blue", "{2}{U}{U}", 4));
    expect(swapCloser(late, [])("Fire Diamond", rock("Talisman of Creativity"))).toBeGreaterThan(0);
    expect(offered(late)).toEqual(["Talisman of Creativity"]);
  });

  test("a land is ranked by the shortfall it closes: a check dual that is tapped on turn one closes none of a turn-one white demand", () => {
    const deck = fill([spell("White One", "{W}", 1), ...Array.from({ length: 2 }, () => basic("Plains", "W")), ...Array.from({ length: 30 }, () => basic("Mountain", "R")), land("Bad Land", "Land", "Bad Land enters tapped.\n{T}: Add {R}.", ["R"]).dc]);
    const deficit = colourDeficit(deck);
    expect(deficit.W).toBeGreaterThan(0);
    const check = land("Check Dual", "Land", "Check Dual enters tapped unless you control a Plains.\n{T}: Add {W} or {B}.", ["W", "B"]);
    const open = land("Open Dual", "Land", "{T}: Add {W} or {B}.", ["W", "B"]);
    const mountain = land("Bad Land", "Land", "Bad Land enters tapped.\n{T}: Add {R}.", ["R"]);
    const [o] = landOptions([mountain], [check, open], 0, deficit, swapCloser(deck, []));
    expect(o!.options.map((x) => [x.add, (x.closed ?? 0) > 0])).toEqual([["Open Dual", true], ["Check Dual", false]]);
  });
});

describe("what a rock really yields", () => {
  const ramp = (cut: DeckCard, add: DeckCard) => roleOptions("ramp", [cut], [candidate(add)], undefined, { U: 4, R: 4 }, () => 1).flatMap((o) => o.options.map((x) => x.add));
  test("an activation cost comes off the yield: Worn Powerstone and Hedron Archive are not Izzet Signet", () => {
    expect(ramp(rock("Worn Powerstone"), rock("Izzet Signet"))).toEqual([]);
    expect(ramp(rock("Hedron Archive"), rock("Izzet Signet"))).toEqual([]);
  });
  test("a one-shot is not a rock: Dire Mimic and Lotus Petal never replace Mind Stone", () => {
    expect(ramp(rock("Mind Stone"), rock("Dire Mimic"))).toEqual([]);
    expect(ramp(rock("Mind Stone"), rock("Lotus Petal"))).toEqual([]);
  });
  test("the add's coloured mana must net as much as the cut: Prismatic Lens (coloured line nets 0) is not a Talisman", () => {
    expect(ramp(rock("Talisman of Dominance"), rock("Prismatic Lens"))).toEqual([]);
  });
  test("mana that can only be spent on instants and sorceries is not yield: Tablet of Discovery is not Worn Powerstone", () => {
    expect(ramp(rock("Worn Powerstone"), rock("Tablet of Discovery"))).toEqual([]);
  });
  test("the real upgrades stay: Fire Diamond to Talisman, Mind Stone to Arcane Signet", () => {
    expect(ramp(rock("Fire Diamond"), rock("Talisman of Creativity"))).toEqual(["Talisman of Creativity"]);
    expect(ramp(rock("Mind Stone"), rock("Arcane Signet"))).toEqual(["Arcane Signet"]);
  });
  test("any colour is one mana: Fire Diamond to Arcane Signet when the deck is short", () => {
    expect(ramp(rock("Fire Diamond"), rock("Arcane Signet"))).toEqual(["Arcane Signet"]);
  });
  test("a colour an opponent decides is not a fix: Fellwar Stone is never the colour add", () => {
    expect(ramp(rock("Fire Diamond"), rock("Fellwar Stone"))).toEqual([]);
    expect(ramp(rock("Mind Stone"), rock("Fellwar Stone"))).toEqual([]);
  });
});

describe("an Aura is a rock the job reader sees", () => {
  test("all four growth Auras read a ramp job, and Utopia Sprawl reads the same kind as Wild Growth", () => {
    for (const n of ["Utopia Sprawl", "Wild Growth", "Fertile Ground", "Overgrowth"] as const) expect(jobOf(rock(n), "ramp"), n).toBeTruthy();
    expect(jobOf(rock("Utopia Sprawl"), "ramp")!.kind).toBe(jobOf(rock("Wild Growth"), "ramp")!.kind);
  });
});

// 2a review (owner, 2026-10-10): trigger mana is ramp, not a colour source, so no deck is offered an Aura FOR A COLOUR. (The assertion that an Aura
// makes no colour is `colours("Fertile Ground") == []` in mana-colour-sources.test.ts; an offer test here could not fail, Auras fail `sameRockAnyColour`
// on kind alone.)
describe("an Aura's extra mana is still yield", () => {
  test("a growth Aura nets what a Signet does", () => {
    expect(netYield(rock("Wild Growth"))).toBe(1);
    expect(netYield(rock("Overgrowth"))).toBe(2);
    expect(colouredNetYield(rock("Utopia Sprawl"))).toBe(1);
  });
});

// #1169 task 2b-2: YIELD, THE RAMP KEY'S MANA AND A DORK'S SHAPE ARE READ OFF THE DERIVED LINES, never off the oracle text or Scryfall's `producedMana`.
// Every card below has its text (or its `producedMana`) changed to something that says the opposite, so only the lines can decide.
describe("a rock's yield, colours and shape come from the derived mana lines", () => {
  const withText = (d: DeckCard, oracleText: string, producedMana?: string[]): DeckCard =>
    ({ ...d, card: { ...d.card, oracleText, ...(producedMana ? { producedMana } : {}) } }) as DeckCard;
  const real = (name: string) => (moxes.cards as unknown as DeckCard[]).find((c) => c.card.name === name)!;
  const noLines = (d: DeckCard): DeckCard => ({ ...d, tags: { ...d.tags!, manaLines: undefined } }) as DeckCard;

  test("the text is not read: a card that prints 'Add {G}{G}' but has no line yields nothing; one with a two-mana line and no text yields two", () => {
    expect(netYield(noLines(withText(rock("Llanowar Elves"), "{T}: Add {G}{G}.")))).toBeNull();
    expect(netYield(withLines(withText(rock("Mind Stone"), ""), [tapFor(["C"], { amount: { fixed: 2, scales: null }, net: 2 })]))).toBe(2);
  });

  test("a Treasure maker, a sacrifice outlet, a trigger and restricted mana are no yield", () => {
    for (const n of ["Pitiless Plunderer", "Phyrexian Altar", "Priest of Forgotten Gods", "Birgi, God of Storytelling // Harnfel, Horn of Bounty", "Smokebraider", "Lotus Petal"]) {
      expect(netYield(real(n)), n).toBeNull();
      expect(colouredNetYield(real(n)), n).toBeNull();
    }
  });

  test("an opponent-decided colour yields mana but no fix (Fellwar Stone is read from the line, not the words 'an opponent controls')", () => {
    expect(netYield(withText(rock("Fellwar Stone"), ""))).toBeNull();
    expect(colouredNetYield(withText(rock("Fellwar Stone"), ""))).toBeNull();
  });

  test("the cost rule: Prismatic Lens yields 1 but has no coloured line that pays its way; a Signet nets 1 in colour", () => {
    expect(netYield(rock("Prismatic Lens"))).toBe(1);
    expect(colouredNetYield(rock("Prismatic Lens"))).toBeNull();
    expect(colouredNetYield(rock("Orzhov Signet"))).toBe(1);
  });

  test("the same-job ramp key holds the colours the LINES make, not Scryfall's producedMana", () => {
    const izzet = rock("Izzet Signet");
    expect(sameJob(izzet, withText(izzet, izzet.card.oracleText!, ["W"]), "ramp")).toBe(true);
    expect(sameJob(izzet, rock("Orzhov Signet"), "ramp")).toBe(false);
    // ...and a Treasure maker that Scryfall lists with five colours is not a five-colour rock.
    const plunderer = real("Pitiless Plunderer");
    expect([...plunderer.card.producedMana!].sort()).toEqual(["B", "G", "R", "U", "W"]);
    expect(sameJob(withLines(izzet, [mkLine({ colours: [], colourless: 1 })]), plunderer, "ramp")).toBe(false);
  });

  test("net-positive mana: more mana than the card costs, from the lines (Sol Ring, Mana Crypt-shaped), not from the words", () => {
    expect(netPositiveMana(rock("Sol Ring"))).toBe(true);
    expect(netPositiveMana(rock("Mind Stone"))).toBe(false);
    expect(netPositiveMana(withText(rock("Mind Stone"), "{T}: Add {C}{C}{C}."))).toBe(false);
    expect(netPositiveMana(withLines(withText(rock("Mind Stone"), ""), [tapFor(["C"], { amount: { fixed: 3, scales: null }, net: 3 })]))).toBe(true);
  });

  test("a plain dork: its own tap pays for a fixed, unrestricted line and it has nothing else but activated abilities", () => {
    const elf = rock("Llanowar Elves");
    expect(isPlainDork(elf)).toBe(true);
    expect(isPlainDork(noLines(withText(elf, "{T}: Add {G}.")))).toBe(false);
    expect(isPlainDork(withLines(elf, [tapFor(["G"], { amount: { fixed: null, scales: "for each Elf you control" } })]))).toBe(false);
    expect(isPlainDork(withLines(elf, [tapFor(["G"], { cost: { ...FREE_TAP, tap: false, mana: 1 } })]))).toBe(false);
    expect(isPlainDork(withLines(elf, [tapFor(["G"], { restriction: { spend: "only to cast elf spells", minManaValue: null } })]))).toBe(false);
    // Birchlore Rangers' shape: it taps OTHER Elves and has no {T} of its own.
    expect(isPlainDork(withLines(elf, [tapFor(["G"], { cost: { ...FREE_TAP, tap: false, tapOther: true } })]))).toBe(false);
  });

  test("a fetch spell that arrives tapped is the derived landFetch's say, not the words 'onto the battlefield tapped'", () => {
    const tapped = (d: DeckCard, flag: boolean): DeckCard => withText({ ...d, tags: { ...d.tags!, landFetch: { ...d.tags!.landFetch!, tapped: flag } } } as DeckCard, d.card.oracleText!.replace("tapped", ""));
    // Three Visits (untapped) is never traded for a tapped fetch; with the flag flipped on a Farseek whose words say nothing, the answer follows the flag.
    expect(sameFetchAnyColour(rock("Three Visits"), tapped(rock("Farseek"), true))).toBe(false);
    expect(sameFetchAnyColour(rock("Three Visits"), tapped(rock("Farseek"), false))).toBe(true);
  });
});

// 2a review 3: a swap's `made` colours use `bounded: "none"`, so an `among` line (Chrome Mox, Mox Amber: bounded by the board) makes no colour claim.
describe("a rock bounded by the board is not described as making a colour", () => {
  const mind4 = { ...rock("Mind Stone"), card: { ...rock("Mind Stone").card, manaValue: 4 } } as unknown as DeckCard;
  // The REAL derived mana lines of Chrome Mox / Mox Amber on an Izzet Signet body (its printed text and job): the printed imprint / legendary
  // condition would stop the swap in `newConditions` whatever the colours, so only the colours can differ here.
  const real = (name: string): DeckCard => {
    const m = (moxes.cards as unknown as DeckCard[]).find((c) => c.card.name === name)!;
    const body = rock("Izzet Signet");
    return { card: { ...body.card, name }, tags: { ...body.tags!, manaLines: m.tags!.manaLines } } as DeckCard;
  };
  test("a chosen-colour rock (Coldsteel Heart, Sol Grail) is still a fixer, and a cut it protects: swaps count `chosen` as the audit does", () => {
    for (const n of ["Coldsteel Heart", "Sol Grail"]) {
      const chosen = real(n);
      expect(chosen.tags!.manaLines!.some((l) => l.anyColour === "chosen"), n).toBe(true);
      // offered as the add for a colour the deck is short of
      expect(roleOptions("ramp", [mind4], [{ dc: chosen, roles: ["ramp"], links: 0 }], undefined, { R: 4 }, () => 1).flatMap((o) => o.options.map((x) => [x.add, x.colour])), n).toEqual([[n, ["R"]]]);
      // ...and as the cut, it makes every colour, so a Signet that makes two of them keeps none the cut has: nothing is offered
      expect(roleOptions("ramp", [chosen], [candidate(rock("Izzet Signet"))], undefined, { R: 4 }, () => 1), n).toEqual([]);
    }
  });
  test("Chrome Mox and Mox Amber are never offered for a colour the deck is short of", () => {
    // The control: the same body with its own lines IS offered, so the refusal below is the colours'.
    expect(roleOptions("ramp", [mind4], [candidate(rock("Izzet Signet"))], undefined, { R: 4, G: 4 }, () => 1).flatMap((o) => o.options.map((x) => x.add))).toEqual(["Izzet Signet"]);
    for (const n of ["Chrome Mox", "Mox Amber"]) {
      expect(real(n).tags!.manaLines!.some((l) => l.anyColour === "among"), n).toBe(true);
      expect(roleOptions("ramp", [mind4], [{ dc: real(n), roles: ["ramp"], links: 0 }], undefined, { R: 4, G: 4 }, () => 1).flatMap((o) => o.options.map((x) => [x.add, x.colour])), n).toEqual([]);
    }
  });
});

test("a Game Changer upgrade is untouched by the colour path (Enduring Enchantments: Arcane Signet to a Game Changer, colours short)", () => {
  const quality = rated({ "Arcane Signet": 92, "Mana Vault": 98 });
  const out = roleOptions("ramp", [real("Arcane Signet")], [candidate(rock("Fertile Ground")), candidate(rock("Wild Growth"))], { pool: [candidate(real("Mana Vault"))], quality },
    { W: 5, B: 7, G: 5 }, () => 2);
  expect(out.map((o) => [o.cut, o.options.map((x) => [x.add, x.upgrade ?? null])])).toEqual([["Arcane Signet", [["Mana Vault", "game-changer"]]]]);
});

describe("a dork for a dork, to close a colour shortfall", () => {
  const elf = (name: string, oracle: string, produced: string[], over: Record<string, unknown> = {}) => {
    const m = rock("Elvish Mystic");
    // The tags carry the line this spec stands for: a free tap for `produced`, restricted when the text says "spend this mana only".
    const line = tapFor(produced, {
      ...(/spend this mana only/i.test(oracle) ? { restriction: { spend: "only to cast angel spells", minManaValue: null } } : {}),
      // Birchlore Rangers pays by tapping OTHER Elves, not itself: derive reads that as `tapOther`, with no `{T}` of its own.
      ...(/^tap two untapped/i.test(oracle) ? { cost: { ...FREE_TAP, tap: false, tapOther: true } } : {}),
    });
    return { ...m, card: { ...m.card, name, oracleText: oracle, producedMana: produced, ...over }, tags: { ...m.tags, manaLines: [line] } } as unknown as DeckCard;
  };
  const swap = (cut: DeckCard, adds: DeckCard[], themed: string[]) =>
    roleOptions("ramp", [cut], adds.map(candidate), undefined, { U: 4 }, () => 1, themedSubjects(themed)).flatMap((o) => o.options.map((x) => [x.add, x.keptType ?? null]));

  test("a deck with no tribe: Llanowar Elves gives way to Birds of Paradise when blue is short", () => {
    expect(swap(rock("Llanowar Elves"), [rock("Birds of Paradise")], [])).toEqual([["Birds of Paradise", null]]);
  });
  test("an Elf-themed deck keeps its Elves: a non-Elf blue dork is refused, an Elf blue dork is taken, and the reason can say it is still an Elf", () => {
    const blueElf = elf("Mystic of the Deep", "{T}: Add {G} or {U}.", ["G", "U"]);
    expect(swap(rock("Llanowar Elves"), [rock("Birds of Paradise")], ["enters:elf"])).toEqual([]);
    expect(swap(rock("Llanowar Elves"), [blueElf], ["enters:elf"])).toEqual([["Mystic of the Deep", "elf"]]);
  });
  test("a dork whose creature types are not themed is free to go: Birds for Llanowar when the theme is another tribe", () => {
    expect(swap(rock("Llanowar Elves"), [rock("Birds of Paradise")], ["enters:goblin"])).toEqual([["Birds of Paradise", null]]);
  });
  test("a type-restricted dork (Giada style) is neither cut nor added for colour", () => {
    const angelic = elf("Angel Mystic", "{T}: Add {W}. Spend this mana only to cast Angel spells.", ["W"]);
    const blue = elf("Blue Mystic", "{T}: Add {G} or {U}.", ["G", "U"]);
    expect(swap(rock("Llanowar Elves"), [elf("Angel Blue", "{T}: Add {U}. Spend this mana only to cast Angel spells.", ["U"])], [])).toEqual([]);
    expect(swap(angelic, [blue], [])).toEqual([]);
  });
  test("a dork that taps OTHER creatures for its mana is not plain: Birchlore Rangers never replaces Llanowar Elves", () => {
    const birchlore = elf("Birchlore Rangers", "Tap two untapped Elves you control: Add one mana of any color.", ["W", "U", "B", "R", "G"]);
    expect(swap(rock("Llanowar Elves"), [birchlore], [])).toEqual([]);
  });
  test("a rock is still not a dork: Birds never replaces Mind Stone, and a rock never replaces Llanowar", () => {
    expect(swap(rock("Mind Stone"), [rock("Birds of Paradise")], [])).toEqual([]);
    expect(swap(rock("Llanowar Elves"), [rock("Izzet Signet")], [])).toEqual([]);
  });
});

describe("a land-fetch spell, swapped for a colour", () => {
  const reachOf = (m: Record<string, ("W" | "U" | "B" | "R" | "G")[]>) => (d: DeckCard) => new Set(m[d.card.name] ?? []);
  const swap = (cut: DeckCard, adds: DeckCard[], o: { closes?: number; reach?: Record<string, ("W" | "U" | "B" | "R" | "G")[]> } = {}) =>
    roleOptions("ramp", [cut], adds.map(candidate), undefined, { G: 4 }, () => o.closes ?? 1, undefined, reachOf(o.reach ?? {}))
      .flatMap((x) => x.options.map((y) => [y.add, y.fetch ?? false]));

  test("no deck takes Fertile Ground for Rampant Growth any more (2a review: an Aura's trigger is not a colour source)", () => {
    expect(swap(rock("Rampant Growth"), [rock("Fertile Ground")], { reach: { "Rampant Growth": ["R"] } })).toEqual([]);
    expect(swap(rock("Rampant Growth"), [rock("Fertile Ground")], {})).toEqual([]);
  });
  test("a fetch spell for a fetch spell needs the shortfall closed, and no fewer lands onto the battlefield", () => {
    const reach = { "Rampant Growth": ["R"] as ("R")[], Farseek: ["R", "G"] as ("R" | "G")[], Cultivate: ["R", "G"] as ("R" | "G")[] };
    expect(swap(rock("Rampant Growth"), [rock("Farseek")], { reach })).toEqual([["Farseek", true]]);
    expect(swap(rock("Rampant Growth"), [rock("Cultivate")], { reach, closes: 0 })).toEqual([]);
    expect(swap(rock("Explosive Vegetation"), [rock("Cultivate")], { reach: { "Explosive Vegetation": ["R"], Cultivate: ["R", "G"] } })).toEqual([]);
    // An untapped fetch is never traded for a tapped one for colour (Three Visits -> Farseek).
    expect(sameFetchAnyColour(rock("Three Visits"), rock("Farseek"))).toBe(false);
    expect(sameFetchAnyColour(rock("Farseek"), rock("Rampant Growth"))).toBe(true);
    expect(landsToBattlefield(rock("Cultivate"))).toBe(1);
    expect(landsToBattlefield(rock("Explosive Vegetation"))).toBe(2);
    expect(landsToBattlefield(rock("Rampant Growth"))).toBe(1);
  });
  test("a count the text cannot bound is not a fetch to replace: Boundless Realms, and an unreadable count reads 2 where it names two", () => {
    expect(landsToBattlefield(rock("Boundless Realms"))).toBe(Infinity);
    expect(landsToBattlefield(rock("Verdant Mastery"))).toBe(2);
    expect(landsToBattlefield(rock("Viewpoint Synchronization"))).toBe(2);
    expect(landsToBattlefield(rock("Elemental Teachings"))).toBe(0);
    expect(swap(rock("Boundless Realms"), [rock("Farseek")], { reach: { Farseek: ["G"] } })).toEqual([]);
    expect(swap(rock("Elemental Teachings"), [rock("Farseek")], { reach: { Farseek: ["G"] } })).toEqual([]);
  });
  test("only a plain fetch is cut or added: removal, land destruction, draw and sagas are not", () => {
    for (const n of ["Deathsprout", "Frenzied Tilling", "Renewal", "Binding the Old Gods"] as const) {
      expect(swap(rock(n), [rock("Farseek")], { reach: { Farseek: ["G"] } }), n).toEqual([]);
      expect(swap(rock("Rampant Growth"), [rock(n)], { reach: { [n]: ["G"] } }), n).toEqual([]);
    }
  });
  test("no fetch becomes a land Aura any more (2a review); Explosive Vegetation, Skyshroud Claim, Circuitous Route and Cultivate stay as before", () => {
    for (const n of ["Explosive Vegetation", "Skyshroud Claim", "Circuitous Route", "Cultivate"] as const) {
      expect(swap(rock(n), [rock("Fertile Ground")], { reach: { [n]: ["R"] } }), n).toEqual([]);
    }
    expect(swap(rock("Three Visits"), [rock("Fertile Ground")], { reach: { "Three Visits": ["R"] } })).toEqual([]);
  });
  test("a creature fetcher is never cut, and never added", () => {
    expect(swap(rock("Wood Elves"), [rock("Rampant Growth"), rock("Farseek")], { reach: { Farseek: ["G"] } })).toEqual([]);
    expect(swap(rock("Rampant Growth"), [rock("Wood Elves")], { reach: { "Wood Elves": ["G"] } })).toEqual([]);
  });
});

describe("a rock that fixes no colour gives way to one that does (#1114)", () => {
  test("Prismatic Lens, which makes blue only at a loss, is swapped for an Izzet Signet when blue is short; the Signet is not swapped for it", () => {
    const run = (cut: DeckCard, add: DeckCard) => roleOptions("ramp", [cut], [candidate(add)], undefined, { U: 4 }, () => 1).flatMap((o) => o.options.map((x) => [x.add, x.colour]));
    expect(run(rock("Prismatic Lens"), rock("Izzet Signet"))).toEqual([["Izzet Signet", ["U"]]]);
    expect(run(rock("Izzet Signet"), rock("Prismatic Lens"))).toEqual([]);
  });
});
