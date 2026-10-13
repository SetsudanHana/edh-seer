import { describe, expect, test } from "vitest";
import type { Card } from "@edh-seer/engine";
import { karstenLands } from "@edh-seer/engine";
import goldfish from "./fixtures/goldfish-cards.json" with { type: "json" };
import { detectBuildCategories } from "./build.js";
import { landInputs, rampWeight, recommendedLands } from "./land-count.js";
import { classifyAccelerant } from "./goldfish.js";
import { boardGateOf, boardGateProbability } from "./gate.js";
import { RAMP_RESILIENCE, landTarget } from "./mana-base.js";
import type { DeckCard } from "./types.js";
import { tapFor, withLines, withTap } from "./mana-test-support.js";

const mk = (
  name: string, manaValue: number, oracleText = "", typeLine = "Artifact",
  extra: Partial<Card> = {},
): DeckCard => ({
  card: { name, manaValue, oracleText, typeLine, keywords: [], colors: [], ...extra } as Card,
  tags: null,
});

const land = (name: string) => withTap(mk(name, 0, "{T}: Add {B}.", "Land", { producedMana: ["B"] }), ["B"]);

test("fast mana is a 0-cost repeatable source, and it is NOT cheap ramp", () => {
  const deck = [
    withTap(mk("Mox Diamond", 0, "{T}: Add one mana of any color.", "Artifact"), ["W", "U", "B", "R", "G"]),
    withTap(mk("Mana Crypt", 0, "{T}: Add {C}{C}.", "Artifact"), ["C"], 2),
    // Sol Ring costs 1, so by the spec's own definition it is cheap ramp, not fast mana.
    withTap(mk("Sol Ring", 1, "{T}: Add {C}{C}.", "Artifact"), ["C"], 2),
    // A 0-cost card that produces nothing is neither.
    mk("Ornithopter", 0, "Flying", "Artifact Creature"),
    land("Swamp"),
  ];
  const inputs = landInputs(deck);
  expect(inputs.fastMana).toBe(2);
  expect(inputs.rampPlusDraw).toBe(1); // Sol Ring only
});

/** The correction the stub asks for and the spec calls the one most implementations get wrong. A
 *  Mox counted as cheap ramp is 0.72 of a land lost, every time. */
test("a card that transforms into a land is not cheap ramp, though its land back produces mana (#1174)", () => {
  const deck = [
    withTap(mk("Sol Ring", 1, "{T}: Add {C}{C}.", "Artifact"), ["C"], 2),
    // Treasure Map's only mana line is its Treasure Cove BACK's (face 1), and a transform card's back is never a source from the deck.
    withLines(mk("Treasure Map // Treasure Cove", 2, "{1}, {T}: Scry 1. …\n//\n{T}: Add {C}.", "Artifact // Land",
      { producedMana: ["C"], layout: "transform" } as Partial<Card>), [tapFor(["C"], { face: 1 })]),
    land("Swamp"),
  ];
  expect(landInputs(deck).rampPlusDraw).toBe(1); // Sol Ring only
});

test("counting a Mox as cheap ramp would change the answer", () => {
  const deck = [
    ...Array.from({ length: 5 }, (_, i) => withTap(mk(`Mox-${i}`, 0, "{T}: Add {W}.", "Artifact"), ["W"])),
    ...Array.from({ length: 30 }, (_, i) => mk(`Spell-${i}`, 3)),
  ];
  const inputs = landInputs(deck);
  expect(inputs.fastMana).toBe(5);
  const correct = karstenLands(inputs);
  const wrong = karstenLands({ ...inputs, fastMana: 0, rampPlusDraw: inputs.rampPlusDraw + 5 });
  expect(wrong - correct).toBeCloseTo(3.6, 6);
});

test("cheap ramp and cheap draw count, expensive ones do not", () => {
  // Draw is detected from the tagged effect kind, not from oracle text, so these carry tags -- the
  // same way a real analysed deck does.
  const drawTags = (id: string) => ({
    oracleId: id, schemaVersion: 1, promptVersion: 1, model: "t",
    characteristics: {
      types: ["instant"], subtypes: [], colors: [], identity: [], cmc: 0,
      power: null, toughness: null, token: false, keywords: [],
    },
    abilities: [{ kind: "on-cast" as const, effect: { kind: "draw-card" as const } }],
  });
  const deck: DeckCard[] = [
    mk("Rampant Growth", 2, "Search your library for a basic land card and put it onto the battlefield tapped.", "Sorcery"),
    mk("Explosive Vegetation", 4, "Search your library for two basic land cards and put them onto the battlefield tapped.", "Sorcery"),
    { ...mk("Ponder", 1, "Draw a card.", "Sorcery"), tags: drawTags("ponder") },
    { ...mk("Blue Sun's Zenith", 5, "Target player draws X cards.", "Instant"), tags: drawTags("bsz") },
    land("Swamp"),
  ];
  // Karsten's bucket is CHEAP acceleration -- a 4-mana ramp spell does not shorten the same turns,
  // and a 5-mana draw spell is a payoff you needed the lands to cast in the first place.
  expect(landInputs(deck).rampPlusDraw).toBe(2);
});

test("the average is over nonlands, which is what the regression was fitted on", () => {
  const deck = [mk("Two", 2), mk("Four", 4), land("Swamp"), land("Island")];
  expect(landInputs(deck).avgManaValue).toBe(3);
});

test("commanders are counted, not just assumed to be one", () => {
  const deck = [mk("Spell", 3), land("Swamp")];
  expect(landInputs(deck, { commanderNames: ["A", "B"] }).commanders).toBe(2);
  expect(landInputs(deck).commanders).toBe(1);
});

test("the recommendation comes back with the count the deck actually runs", () => {
  const deck = [
    ...Array.from({ length: 60 }, (_, i) => mk(`Spell-${i}`, 3)),
    ...Array.from({ length: 37 }, (_, i) => land(`Swamp-${i}`)),
  ];
  const rec = recommendedLands(deck);
  expect(rec.actual).toBe(37);
  // 27.0 + 3.95 * 3 = 38.85, no commander, no ramp and no draw.
  expect(rec.target).toBe(39);
  expect(rec.target).toBe(landTarget({ avgManaValue: 3, commanderManaValue: 0, accelerants: 0, drawCredit: 0 }));
});

test("MDFC counts are zero, and say so rather than being silently absent", () => {
  // Nothing in the repo detects a modal DFC with a land back yet. Reporting 0 explicitly keeps the
  // omission visible instead of letting the regression's own default hide it.
  const inputs = landInputs([mk("Spell", 3), land("Swamp")]);
  expect(inputs.mdfcUntapped).toBe(0);
  expect(inputs.mdfcTapped).toBe(0);
});

const mdfc = (name: string, back: string, layout = "modal_dfc") =>
  mk(name, 3, `Destroy target creature.\n//\n${back}`, "Instant // Land", {
    layout, producedMana: ["B"],
  });

/** A LAND-BACK MDFC IS A LAND, AND THE TARGET IS NOT DISCOUNTED FOR IT (owner ruling 2026-08-31).
 *  Karsten's convention was the opposite -- count it as a spell, then discount the requirement by
 *  0.74 untapped / 0.38 tapped -- and this repo half-applied it: the discount landed on the target
 *  while `build.ts`'s type-line count still added the card back as a land, so the same card was paid
 *  for twice. Measured on the 55 calibration decks that run one, mean delta against the target:
 *  **+1.56 half-applied · -1.40 all-Karsten · -0.36 counting them as lands**, with 12 decks outside
 *  the +-3 band against 17 and 16, and it is the only one of the three whose misses are symmetric
 *  (6 high / 6 low). All-Karsten reads decks 1.4 lands SHORT, which is what it looks like when
 *  players already treat these as lands and run fewer real ones to compensate. */
test("a modal DFC with a land back is counted as a land, and does not discount the target", () => {
  const deck = [
    mdfc("Hagra Mauling", "This land enters tapped. {T}: Add {B}."),
    mdfc("Blackbloom Rogue", "As this land enters, you may pay 3 life. If you don't, it enters tapped. {T}: Add {B}."),
    ...Array.from({ length: 30 }, (_, i) => land(`Swamp-${i}`)),
  ];
  const rec = recommendedLands(deck);
  // The census survives the ruling -- the panel still names how many of the lands are MDFCs, and
  // the tapped/untapped split is what a future refinement would need. It just no longer moves the
  // target.
  expect(rec.mdfcTapped).toBe(1);
  expect(rec.mdfcUntapped).toBe(1); // the pay-3-life cycle is the untapped one
  // Both MDFCs are lands, so 30 Swamps + 2.
  expect(rec.actual).toBe(32);
  // ...and the target reads no MDFC term at all: it is the formula on the nonland pool alone.
  const inputs = landInputs(deck);
  expect(rec.target).toBe(landTarget({ avgManaValue: inputs.avgManaValue, commanderManaValue: 0, accelerants: 0, drawCredit: 0 }));
});

/** THE SAME DOUBLE COUNT IN THE OTHER DIRECTION. `avgManaValue` is the regression's dominant term,
 *  and it averages over the NONLAND pool -- so a card counted as a land has to leave that pool too,
 *  or its mana value inflates the average and pushes the target back up by part of what the count
 *  just gained. Small in practice (~0.03 across the calibration decks) and wrong in principle. */
test("an MDFC counted as a land leaves the nonland pool that sets avgManaValue", () => {
  const deck = [
    mdfc("Hagra Mauling", "This land enters tapped. {T}: Add {B}."),
    ...Array.from({ length: 30 }, (_, i) => land(`Swamp-${i}`)),
  ];
  // The MDFC costs 3 and it is the only nonland-shaped card here, so the old pool averaged 3.
  expect(landInputs(deck).avgManaValue).toBe(0);
});

/** A TRANSFORM card's land back is reached by transforming a permanent already in play -- you can
 *  never play Treasure Map as a land, so it is not one of these. The type-line test alone cannot
 *  tell them apart, and five of the fifteen candidates in the calibration decks are this shape. */
test("a transform card with a land back is NOT a modal DFC", () => {
  const deck = [
    mdfc("Treasure Map", "(Transforms from Treasure Map.) {T}: Add {C}.", "transform"),
    ...Array.from({ length: 30 }, (_, i) => land(`Swamp-${i}`)),
  ];
  const rec = recommendedLands(deck);
  expect(rec.mdfcTapped + rec.mdfcUntapped).toBe(0);
  // Nor is it a land in the count (#1167): this test used to pin 31 -- the whole-line type test
  // counted it while the goldfish did not. One `isLand` now: front face, so a spell.
  expect(rec.actual).toBe(30);
});

/** A cheap MDFC's land back makes mana (face 1 of a modal DFC counts). It is already paid for by its own coefficient, and it is a land, not a
 *  spell: counting it as cheap ramp as well is the Mox error. */
test("an MDFC is not also counted as cheap ramp", () => {
  const cheap = mk("Silundi Vision", 2, "Look at the top seven cards.\n//\nThis land enters tapped. {T}: Add {U}.",
    "Instant // Land", { layout: "modal_dfc" });
  const deck = [withLines(cheap, [tapFor(["U"], { face: 1 })]), ...Array.from({ length: 30 }, (_, i) => land(`Swamp-${i}`))];
  const inputs = landInputs(deck);
  expect(inputs.mdfcTapped).toBe(1);
  expect(inputs.rampPlusDraw).toBe(0);
});

/** RAMP COUNTS ONLY UP TO ITS ROLE TARGET, AND A TRIM SAYS WHERE THE TARGET GOES (owner,
 *  2026-09-29: "for rani it shows we are above the ramp target, so if fixing that places our target
 *  land count higher"). The goldfish that measured 0.57 of a land per rock never loses one and always
 *  wants more, so twelve rocks against a target of eight only buy eight rocks' worth of lands. */
test("ramp past its role target does not lower the land target, and a trim cuts the weakest pieces", () => {
  const rampTags = (id: string) => ({
    oracleId: id, schemaVersion: 1, promptVersion: 1, model: "t",
    characteristics: {
      types: ["artifact"], subtypes: [], colors: [], identity: [], cmc: 2,
      power: null, toughness: null, token: false, keywords: [],
    },
    abilities: [{ kind: "activated" as const, effect: { kind: "mana-generation" as const } }],
  });
  const rock = (i: number): DeckCard => withTap({
    ...mk(`Rock-${i}`, 2, "{T}: Add {C}.", "Artifact"),
    tags: rampTags(`rock-${i}`),
  }, ["C"]);
  const deck = [
    ...Array.from({ length: 12 }, (_, i) => rock(i)),
    ...Array.from({ length: 48 }, (_, i) => mk(`Spell-${i}`, 3)),
    ...Array.from({ length: 37 }, (_, i) => land(`Swamp-${i}`)),
  ];
  const free = recommendedLands(deck);
  const capped = recommendedLands(deck, { roleTargets: { ramp: 8 } });
  expect(free.accelerants).toBe(12);
  // Twelve rocks count as eight: four rocks' worth of lands (4 x 0.7 x 0.57 = 1.6) comes back.
  expect(capped.target - free.target).toBeGreaterThanOrEqual(1);
  // A TRIM CUTS THE WEAKEST PIECES, and past the target those are the ones the cap already left
  // uncounted, so trimming four of twelve equal rocks moves nothing: no note.
  expect(capped.ifTrimmed).toBeUndefined();
  expect(recommendedLands(deck, { roleTargets: { ramp: 14 } }).ifTrimmed).toBeUndefined();
});

test("ramp is weighted by what survives, draw by what it costs", () => {
  const withTags = (dc: DeckCard, kind: string, types: string[]): DeckCard => ({ ...dc, tags: {
    oracleId: dc.card.name, schemaVersion: 1, promptVersion: 1, model: "t",
    characteristics: { types, subtypes: [], colors: [], identity: [], cmc: dc.card.manaValue, power: null, toughness: null, token: false, keywords: [] },
    abilities: [{ kind: "activated" as const, effect: { kind } }],
  } as never });
  const filler = (n: number) => Array.from({ length: n }, (_, i) => mk(`Spell-${i}`, 3));
  const lands = Array.from({ length: 37 }, (_, i) => land(`Swamp-${i}`));
  const rocks = Array.from({ length: 12 }, (_, i) => withTap(withTags(mk(`Rock-${i}`, 2, "{T}: Add {C}.", "Artifact"), "mana-generation", ["artifact"]), ["C"]));
  const dorks = Array.from({ length: 12 }, (_, i) => withTap(withTags(mk(`Dork-${i}`, 2, "{T}: Add {G}.", "Creature — Elf"), "mana-generation", ["creature"]), ["G"]));
  // Twelve rocks are worth more lands than twelve dorks: a rock outlives a creature wipe.
  expect(recommendedLands([...rocks, ...filler(50), ...lands]).target)
    .toBeLessThan(recommendedLands([...dorks, ...filler(50), ...lands]).target);

});

// --- THE KARSTEN INPUTS READ THE DERIVED MANA LINES (#1169 task 2b-1; owner rulings 2026-10-10) ---

/** A REAL CARD, as production derived it (`fixtures/goldfish-cards.json`, dumped by `research/mana/dump-goldfish-fixtures.mts`). */
const real = (name: string): DeckCard => {
  const hit = (goldfish as unknown as DeckCard[]).find((c) => c.card.name === name || c.card.name.startsWith(`${name} //`));
  expect(hit, `fixture for ${name}`).toBeDefined();
  return structuredClone(hit!);
};
/** The ramp role reads effect kinds, which the fixture's mana keys do not carry: give the card the one a tagger would. */
const asRamp = (dc: DeckCard, kind: string): DeckCard => ({ ...dc, tags: { ...dc.tags!, abilities: [{ kind: "activated", effect: { kind } }] } as never });

test("a ritual is NOT cheap ramp, though the Ramp role holds it (owner, 2026-10-10)", () => {
  const ritual = asRamp(real("Dark Ritual"), "ritual");
  // The control: the role really does hold it, so the exclusion below is doing the work.
  expect(detectBuildCategories([ritual]).get("ramp")?.has("Dark Ritual")).toBe(true);
  expect(ritual.tags!.isOneShot).toBe(true);
  expect(landInputs([ritual, land("Swamp")]).rampPlusDraw).toBe(0);
  // Lotus Petal (mana value 0, taps for mana once) is a one-shot too: neither fast mana nor cheap ramp.
  const petal = real("Lotus Petal");
  expect(landInputs([petal, land("Swamp")])).toMatchObject({ fastMana: 0, rampPlusDraw: 0 });
});

test("a suspend-only Mox and a counter-fuelled source are NOT fast mana (owner, 2026-10-10)", () => {
  const tantalite = real("Mox Tantalite");
  const trilobite = real("Cryptic Trilobite");
  expect(tantalite.tags!.suspendOnly).toBe(true);
  expect(trilobite.tags!.manaLines![0]!.cost.counters).toBe("remove");
  expect(landInputs([tantalite, trilobite, land("Swamp")]).fastMana).toBe(0);
  // ...and a Mox that is cast for nothing and taps for mana is: the control, on a real card.
  expect(landInputs([real("Mox Diamond"), land("Swamp")]).fastMana).toBe(1);
});

test("cheap ramp is a derived line you can use, not Scryfall's producedMana; a card with no derived tags counts as nothing", () => {
  // Sol Ring costs 1: cheap ramp -- by its derived line.
  expect(landInputs([real("Sol Ring"), land("Swamp")])).toMatchObject({ rampPlusDraw: 1, fastMana: 0 });
  // The same card carrying Scryfall's producedMana and NO derived tags is nothing here (CEILING in landInputs: `coverage.ts` lists it).
  const untagged: DeckCard = { ...real("Sol Ring"), tags: null };
  expect(untagged.card.producedMana).toBeDefined();
  expect(landInputs([untagged, land("Swamp")])).toMatchObject({ rampPlusDraw: 0, fastMana: 0 });
  // A Treasure maker is not a line the model plays; a restricted tap (Smokebraider-like) is not mana for the deck's spells.
  expect(landInputs([real("Pitiless Plunderer"), land("Swamp")]).rampPlusDraw).toBe(0);
  expect(landInputs([real("Jegantha, the Wellspring"), land("Swamp")]).rampPlusDraw).toBe(0);
});

// A WALKER'S MANA THAT LASTS ONE TURN IS A ONE-SHOT TO THE KARSTEN WEIGHT (2b-1 review round 3): `RAMP_RESILIENCE` is "how long a piece keeps producing", and Koth's
// "-2: Add {R}{R}{R}{R}" from loyalty 3 is a single activation (`ManaOutput.turns` 1), a ritual's worth. A walker that lasts longer (Chandra, Novice Pyromancer: five turns; a
// "+1": every turn) keeps the rock weight. The count of accelerants (`classifyAccelerant`) is unchanged: it is still one.
test("a walker whose mana lasts one turn weighs as a one-shot, one that lasts longer as a rock", () => {
  expect(classifyAccelerant(real("Koth of the Hammer"))).not.toBeNull();
  expect(rampWeight(real("Koth of the Hammer"))).toBe(RAMP_RESILIENCE.oneShot);
  expect(rampWeight(real("Chandra, Novice Pyromancer"))).toBe(RAMP_RESILIENCE.rock);
  expect(rampWeight(real("Chandra, Torch of Defiance"))).toBe(RAMP_RESILIENCE.rock);
  expect(rampWeight(real("Chandra, Hope's Beacon"))).toBe(RAMP_RESILIENCE.rock);
  expect(rampWeight(real("Dark Ritual"))).toBeNull();
});

// A GATED SOURCE IS FAST MANA ONLY IF ITS GATE CAN BE MET ON TURN 1 OR 2 (owner 2026-10-13, #1169 2b-2: board-count gates are timed turn by turn). Mox Jasper costs nothing, but a
// Mox that waits on a Dragon is not a Mox on turn one in a deck whose Dragons cost five.
describe("a gated source in the Karsten inputs", () => {
  const filler = (n: number): DeckCard[] => Array.from({ length: n }, (_, i) => mk(`Spell ${i}`, 3, "", "Sorcery"));
  const dragons = (n: number, manaValue: number): DeckCard[] => Array.from({ length: n }, (_, i) => mk(`Dragon ${i}`, manaValue, "", "Creature — Dragon"));
  const jasper = real("Mox Jasper");

  test("Mox Jasper in a deck of five-mana Dragons is not fast mana and not cheap ramp; in a deck of one-mana Dragons it is fast mana", () => {
    const heavy = [jasper, ...dragons(12, 5), ...filler(87)];
    // the gate IS met in the deck (a rock for the swaps and the goldfish): it is just not met by turn 2
    expect(classifyAccelerant(jasper, heavy)).not.toBeNull();
    expect(landInputs(heavy)).toMatchObject({ fastMana: 0, rampPlusDraw: 0 });
    // ...and the Ramp role, which holds it in every deck, does not make it cheap ramp either
    const inRole = asRamp(jasper, "mana-generation");
    expect(detectBuildCategories([inRole]).get("ramp")?.has("Mox Jasper")).toBe(true);
    expect(landInputs([inRole, ...dragons(12, 5), ...filler(87)])).toMatchObject({ fastMana: 0, rampPlusDraw: 0 });
    expect(landInputs([inRole, ...dragons(20, 1), ...filler(79)])).toMatchObject({ fastMana: 1, rampPlusDraw: 0 });
    const light = [jasper, ...dragons(20, 1), ...filler(79)];
    expect(landInputs(light)).toMatchObject({ fastMana: 1, rampPlusDraw: 0 });
  });

  test("the accelerant count asks the deck, and the commander is a card of it", () => {
    const deck = [jasper, ...dragons(12, 5), ...filler(87)];
    expect(recommendedLands(deck).accelerants).toBe(1);
    expect(recommendedLands(deck.filter((d) => d !== jasper)).accelerants).toBe(0);
    // a Dragon COMMANDER meets the gate of a small deck: not one of the hundred to be drawn, but the card it is
    const commander = mk("Dragon Commander", 5, "", "Legendary Creature — Dragon");
    const small = [jasper, commander, ...filler(18)];
    expect(recommendedLands(small, { commanderNames: ["Dragon Commander"] }).accelerants).toBe(1);
    expect(recommendedLands(small.filter((d) => d !== commander), {}).accelerants).toBe(0);
  });

  // 8 one-mana Dragons in a hundred are the first count that meets Mox Jasper's gate by turn 2 (49.8% of seven in 99 cards, 54.3% of eight in 100): only the COMMANDER tips it
  test("a Dragon commander tips the gate into a deck's fast mana and weighs its Jasper, which the library alone would not", () => {
    const commander = mk("Dragon Commander", 1, "", "Legendary Creature \u2014 Dragon");
    const deck = [jasper, ...dragons(7, 1), ...filler(91), commander];
    expect(landInputs(deck, { commanderNames: ["Dragon Commander"] })).toMatchObject({ fastMana: 1 });
    expect(landInputs(deck.filter((d) => d !== commander))).toMatchObject({ fastMana: 0 });
    // 3 Dragons in 99 are 41% by the median clock, a Dragon commander makes them 4 in 100 and 51%
    const small = (cmd: DeckCard[]) => [...Array.from({ length: 8 }, () => jasper), ...dragons(3, 2), ...filler(88), ...cmd];
    const withCommander = recommendedLands(small([commander]), { commanderNames: ["Dragon Commander"] });
    const without = recommendedLands(small([mk("Plain Commander", 1, "", "Legendary Creature \u2014 Human")]), { commanderNames: ["Plain Commander"] });
    expect(withCommander.accelerants).toBe(8);
    expect(without.accelerants).toBe(0);
    expect(withCommander.target).toBeLessThan(without.target);
  });

  test("a source that makes mana only once its gate is met weighs what it keeps producing times the share of the first eight turns it is met in", () => {
    const deck = [jasper, ...dragons(12, 5), ...filler(87)];
    const w = rampWeight(jasper, deck)!;
    const share = [1, 2, 3, 4, 5, 6, 7, 8].reduce((n, t) => n + boardGateProbability(boardGateOf("you control a dragon")!, deck, t), 0) / 8;
    expect(w).toBeCloseTo(RAMP_RESILIENCE.rock * share, 10);
    expect(w).toBeGreaterThan(0);
    expect(w).toBeLessThan(RAMP_RESILIENCE.rock);
    // Leafkin Druid makes mana whatever the board is: its weight is a dork's, whole
    const druid = real("Leafkin Druid");
    expect(rampWeight(druid, [druid, ...filler(99)])).toBe(RAMP_RESILIENCE.dork);
  });
});

test("the land target is lowered by a gated source's weight, judged against the deck (rampWeight is handed the deck)", () => {
  const jasper = real("Mox Jasper");
  const dragons = Array.from({ length: 20 }, (_, i) => mk(`Dragon ${i}`, 2, "", "Creature — Dragon"));
  const spells = Array.from({ length: 36 }, (_, i) => mk(`Spell ${i}`, 4, "", "Sorcery"));
  const lands = Array.from({ length: 36 }, (_, i) => land(`Swamp ${i}`));
  const moxen = Array.from({ length: 8 }, () => jasper);
  const withJasper = recommendedLands([...moxen, ...dragons, ...spells, ...lands]);
  const without = recommendedLands([...moxen.map((d) => ({ ...d, tags: null })), ...dragons, ...spells, ...lands]);
  expect(withJasper.accelerants).toBe(8);
  expect(withJasper.target).toBeLessThan(without.target);
});
