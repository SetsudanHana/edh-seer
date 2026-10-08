import { describe, expect, test } from "vitest";
import type { Card } from "@edh-seer/engine";
import { landFacts } from "./land-score.js";
import fixtures from "./same-job.fixtures.json" with { type: "json" };
import rocks from "./ramp-colour.fixtures.json" with { type: "json" };
import { rolesOfCard } from "./quality.js";
import { colourDeficit, landTypeDemand } from "./mana-audit.js";
import { colouredNetYield, jobOf, landsToBattlefield, netYield, themedSubjects } from "./same-job.js";
import { answerCovers, gameChangerOption, landOptions, newConditions, roleOptions, auraSupport, sameJob, strictlyBetter, swapCloser, watchedTypes } from "./upgrade-sections.js";
import type { DeckCard } from "./types.js";

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
  const dc = card(name, typeLine, oracleText, producedMana);
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

describe("a colour swap may cross card types, toward the type the deck's payoffs watch", () => {
  const swap = (cut: DeckCard, adds: DeckCard[], watched: string[]) =>
    roleOptions("ramp", [cut], adds.map(candidate), undefined, { G: 4, U: 4 }, () => 1, new Set(watched)).flatMap((o) => o.options.map((x) => [x.add, x.crossType]));

  test("a type is watched only when the deck's THEMES say so: an incidental payoff is not a theme", () => {
    expect([...watchedTypes(["enters:enchantment", "cast:artifact"])].sort()).toEqual(["artifact", "enchantment"]);
    expect([...watchedTypes(["lifegain:any", "enters:creature"])]).toEqual(["creature"]);
    expect([...watchedTypes([])]).toEqual([]);
    expect([...watchedTypes(undefined)]).toEqual([]);
  });

  test("an enchantress deck gets the growth Auras for a colour; with no enchantment payoff, or an artifact one, it does not", () => {
    const adds = [rock("Fertile Ground"), rock("Utopia Sprawl")];
    expect(swap(rock("Mind Stone"), adds, ["enchantment"])).toEqual([["Fertile Ground", "enchantment"], ["Utopia Sprawl", "enchantment"]]);
    expect(swap(rock("Mind Stone"), adds, [])).toEqual([]);
    expect(swap(rock("Mind Stone"), adds, ["artifact"])).toEqual([]);
  });

  test("never the other way: an Aura is not swapped for a Signet, and not when the cut's type is watched too", () => {
    expect(swap(rock("Wild Growth"), [rock("Arcane Signet")], ["enchantment"])).toEqual([]);
    expect(swap(rock("Mind Stone"), [rock("Fertile Ground")], ["enchantment", "artifact"])).toEqual([]);
  });

  test("an Aura's extra mana is yield: a growth Aura nets what a Signet does", () => {
    expect(netYield(rock("Wild Growth"))).toBe(1);
    expect(netYield(rock("Overgrowth"))).toBe(2);
    expect(colouredNetYield(rock("Utopia Sprawl"))).toBe(1);
  });
});

describe("the cross-type path takes only an Aura that enchants a land and adds mana by trigger", () => {
  const mind4 = { ...rock("Mind Stone"), card: { ...rock("Mind Stone").card, manaValue: 4 } } as unknown as DeckCard;
  const offered = (add: DeckCard) => roleOptions("ramp", [mind4], [candidate(add)], undefined, { G: 4 }, () => 1, new Set(["enchantment"])).flatMap((o) => o.options.map((x) => x.add));
  const karametra = (() => {
    const fg = rock("Fertile Ground");
    return { ...fg, card: { ...fg.card, name: "Karametra's Favor", oracleText: fg.card.oracleText!.replace("Enchant land", "Enchant creature").replace("enchanted land", "enchanted creature") } } as unknown as DeckCard;
  })();
  test("what is not a land Aura with an 'adds an additional' trigger is refused", () => {
    expect(offered(karametra)).toEqual([]);
    expect(offered(rock("Cryptolith Rite"))).toEqual([]);
    expect(offered(rock("Abundant Growth"))).toEqual([]);
    expect(offered(rock("Urban Utopia"))).toEqual([]);
  });
  test("the growth Auras stay", () => {
    for (const n of ["Fertile Ground", "Wild Growth", "Overgrowth", "Trace of Abundance", "Utopia Sprawl"] as const) expect(offered(rock(n)), n).toEqual([n]);
  });
});

describe("'Enchant Forest' is a demand for Forests, judged like a colour pip", () => {
  const spell = (name: string): DeckCard => ({ ...card(name, "Sorcery", ""), card: { ...card(name, "Sorcery", "").card, manaCost: "{1}", manaValue: 1 } });
  const forest = () => card("Forest", "Basic Land — Forest", "({T}: Add {G}.)", ["G"]);
  const deckWith = (forests: number) => [...Array.from({ length: forests }, forest), ...Array.from({ length: 100 - forests }, (_, i) => spell(`Filler ${i}`))];
  test("the model's own number: required Forests by the Aura's turn against the deck's Forests", () => {
    const few = landTypeDemand(deckWith(5), [], "forest", 1);
    const many = landTypeDemand(deckWith(40), [], "forest", 1);
    expect(few.available).toBe(5);
    expect(few.required).toBeGreaterThan(5);
    expect(many.available).toBe(40);
    expect(many.required).toBeLessThanOrEqual(40);
  });
  test("Utopia Sprawl is refused for a deck with few Forests and offered for one with many; an 'Enchant land' Aura needs neither", () => {
    const run = (forests: number, add: DeckCard) => roleOptions("ramp", [rock("Mind Stone")], [candidate(add)], undefined, { G: 4 }, () => 1, new Set(["enchantment"]),
      auraSupport(deckWith(forests), [])).flatMap((o) => o.options.map((x) => x.add));
    expect(run(5, rock("Utopia Sprawl"))).toEqual([]);
    expect(run(40, rock("Utopia Sprawl"))).toEqual(["Utopia Sprawl"]);
    expect(run(5, rock("Fertile Ground"))).toEqual(["Fertile Ground"]);
  });
});

test("a Game Changer upgrade is untouched by the colour and cross-type paths (Enduring Enchantments: Arcane Signet to a Game Changer, enchantment watched, colours short)", () => {
  const quality = rated({ "Arcane Signet": 92, "Mana Vault": 98 });
  const out = roleOptions("ramp", [real("Arcane Signet")], [candidate(rock("Fertile Ground")), candidate(rock("Wild Growth"))], { pool: [candidate(real("Mana Vault"))], quality },
    { W: 5, B: 7, G: 5 }, () => 2, new Set(["enchantment"]), () => true);
  expect(out.map((o) => [o.cut, o.options.map((x) => [x.add, x.upgrade ?? null])])).toEqual([["Arcane Signet", [["Mana Vault", "game-changer"]]]]);
});

describe("a dork for a dork, to close a colour shortfall", () => {
  const elf = (name: string, oracle: string, produced: string[], over: Record<string, unknown> = {}) => {
    const m = rock("Elvish Mystic");
    return { ...m, card: { ...m.card, name, oracleText: oracle, producedMana: produced, ...over } } as unknown as DeckCard;
  };
  const swap = (cut: DeckCard, adds: DeckCard[], themed: string[]) =>
    roleOptions("ramp", [cut], adds.map(candidate), undefined, { U: 4 }, () => 1, new Set(), undefined, themedSubjects(themed)).flatMap((o) => o.options.map((x) => [x.add, x.keptType ?? null]));

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
  const swap = (cut: DeckCard, adds: DeckCard[], o: { watched?: string[]; closes?: number; reach?: Record<string, ("W" | "U" | "B" | "R" | "G")[]> } = {}) =>
    roleOptions("ramp", [cut], adds.map(candidate), undefined, { G: 4 }, () => o.closes ?? 1, new Set(o.watched ?? []), () => true, undefined, reachOf(o.reach ?? {}))
      .flatMap((x) => x.options.map((y) => [y.add, y.crossType ?? null, y.fetch ?? false]));

  test("an enchantment deck takes Fertile Ground for Rampant Growth; any other deck does not", () => {
    expect(swap(rock("Rampant Growth"), [rock("Fertile Ground")], { watched: ["enchantment"], reach: { "Rampant Growth": ["R"] } })).toEqual([["Fertile Ground", "enchantment", false]]);
    expect(swap(rock("Rampant Growth"), [rock("Fertile Ground")], { reach: { "Rampant Growth": ["R"] } })).toEqual([]);
    expect(swap(rock("Rampant Growth"), [rock("Fertile Ground")], { watched: ["artifact"] })).toEqual([]);
  });
  test("a fetch spell for a fetch spell needs the shortfall closed, and no fewer lands onto the battlefield", () => {
    const reach = { "Rampant Growth": ["R"] as ("R")[], Farseek: ["R", "G"] as ("R" | "G")[], Cultivate: ["R", "G"] as ("R" | "G")[] };
    expect(swap(rock("Rampant Growth"), [rock("Farseek")], { reach })).toEqual([["Farseek", null, true]]);
    expect(swap(rock("Rampant Growth"), [rock("Cultivate")], { reach, closes: 0 })).toEqual([]);
    expect(swap(rock("Explosive Vegetation"), [rock("Cultivate")], { reach: { "Explosive Vegetation": ["R"], Cultivate: ["R", "G"] } })).toEqual([]);
    expect(landsToBattlefield(rock("Cultivate"))).toBe(1);
    expect(landsToBattlefield(rock("Explosive Vegetation"))).toBe(2);
    expect(landsToBattlefield(rock("Rampant Growth"))).toBe(1);
  });
  test("a creature fetcher is never cut, and never added", () => {
    expect(swap(rock("Wood Elves"), [rock("Rampant Growth"), rock("Farseek")], { reach: { Farseek: ["G"] } })).toEqual([]);
    expect(swap(rock("Rampant Growth"), [rock("Wood Elves")], { reach: { "Wood Elves": ["G"] } })).toEqual([]);
  });
});
