import { expect, test } from "vitest";
import type { Card } from "@edh-seer/engine";
import { minCopies } from "@edh-seer/engine";
import { colourDeficit, manaAudit, pipsByColor } from "./mana-audit.js";
import { minSources } from "./mulligan.js";
import type { DeckCard } from "./types.js";

const card = (name: string, manaCost: string, manaValue: number, extra: Partial<Card> = {}): DeckCard => ({
  card: { name, manaCost, manaValue, typeLine: "Sorcery", oracleText: "", keywords: [], colors: [] , ...extra } as Card,
  tags: null,
});

const source = (name: string, produces: string[]): DeckCard => ({
  card: {
    name, typeLine: "Land", oracleText: "", keywords: [], colors: [], manaValue: 0,
    producedMana: produces,
  } as Card,
  tags: null,
});

const filler = (i: number) => card(`filler-${i}`, "{1}", 1);
/** Sources that make a DIFFERENT colour: a black shortfall is a colour finding only when trading
 *  some of these for Swamps could close it (#680). */
const islands = (n: number) => Array.from({ length: n }, (_, i) => source(`Island-${i}`, ["U"]));
const fillTo = (n: number, deck: DeckCard[]) =>
  [...deck, ...Array.from({ length: n - deck.length }, (_, i) => filler(i))];

test("pips are counted per colour, and generic costs are not pips", () => {
  expect(pipsByColor("{2}{B}{B}")).toEqual({ B: 2 });
  expect(pipsByColor("{W}{U}{B}{R}{G}")).toEqual({ W: 1, U: 1, B: 1, R: 1, G: 1 });
  expect(pipsByColor("{10}")).toEqual({});
  expect(pipsByColor(undefined)).toEqual({});
  // Hybrid and Phyrexian: each can be paid with the colour, so each counts as a demand for it.
  // Overstates a hybrid slightly -- the other half may be payable -- and the audit says so.
  expect(pipsByColor("{B/R}")).toEqual({ B: 1, R: 1 });
  expect(pipsByColor("{B/P}")).toEqual({ B: 1 });
  // X is not a pip, and a colourless cost is not a colour.
  expect(pipsByColor("{X}{C}")).toEqual({});
});

/** The stub's insight, and the reason this is not another Tier C guess: a card's DEADLINE is its
 *  own mana value. You want to cast a 3-drop on turn 3. */
test("a card's deadline is its own mana value", () => {
  const deck = fillTo(100, [
    card("Doom Blade", "{1}{B}", 2),
    card("Damnation", "{2}{B}{B}", 4),
    ...Array.from({ length: 10 }, () => source("Swamp", ["B"])),
  ]);
  const rows = manaAudit(deck);
  const black = rows.find((r) => r.color === "B")!;

  const single = black.demands.find((d) => d.pips === 1)!;
  const double = black.demands.find((d) => d.pips === 2)!;
  expect(single.turn).toBe(2);  // a 2-drop wants its black on turn 2
  expect(double.turn).toBe(4);  // a 4-drop on turn 4, not on some fitted "intended turn"
  // BOTH ENDS OF THE INTERVAL (roadmap L5). `requiredRaw` is the no-mulligan figure this field held
  // alone until 2026-08-25; `required` prices the free mulligan and is what `met` reads.
  expect(single.requiredRaw).toBe(minCopies(1, 2, 0.9, 100));
  expect(double.requiredRaw).toBe(minCopies(2, 4, 0.9, 100));
  expect(single.required).toBe(minSources(1, 2));
  expect(double.required).toBe(minSources(2, 4));
});

/** Criterion S2: a mulligan cannot make a deck need MORE sources. The clamp in `manaAudit` also has
 *  to hold when the library is short of 99 and the two models are told different deck sizes. */
test("the mulligan-corrected requirement is never higher than the raw one", () => {
  for (const n of [40, 60, 100]) {
    const deck = fillTo(n, [
      card("Doom Blade", "{1}{B}", 2),
      card("Damnation", "{2}{B}{B}", 4),
      card("Turn-one black", "{B}", 1),
      source("Swamp", ["B"]),
    ]);
    for (const d of manaAudit(deck).find((r) => r.color === "B")!.demands) {
      expect(d.required).toBeLessThanOrEqual(d.requiredRaw);
    }
  }
});

/** Criterion S5, and the one case the whole correction is about: a deck holding MORE than the
 *  mulligan-corrected requirement and FEWER than the raw one. `met` anchors on the corrected end, so
 *  the report under-claims a shortfall rather than over-claiming it — anchoring on `requiredRaw`
 *  instead told 62 of the 71 calibration decks they were short by a median of ten sources.
 *
 *  Every other fixture here sits below both ends, so without this one the anchor could be flipped
 *  back and the suite would stay green. */
test("a deck between the two requirements reads MET, not short", () => {
  const between = minSources(2, 3)! + 1;
  expect(between).toBeLessThan(minCopies(2, 3, 0.9, 100));
  const deck = fillTo(100, [
    ...Array.from({ length: 12 }, (_, i) => card(`double-${i}`, "{1}{B}{B}", 3)),
    ...Array.from({ length: between }, (_, i) => source(`Swamp-${i}`, ["B"])),
  ]);
  const black = manaAudit(deck).find((r) => r.color === "B")!;
  expect(black.supplied).toBe(between);
  expect(black.demands.find((d) => d.pips === 2)!.met).toBe(true);
  expect(black.worst).toBeUndefined();
});

test("supply counts every card that can produce the colour, not just lands", () => {
  const deck = fillTo(100, [
    card("Doom Blade", "{1}{B}", 2),
    source("Swamp", ["B"]),
    source("Watery Grave", ["U", "B"]),
    source("Arcane Signet", ["W", "U", "B", "R", "G"]),
    source("Sol Ring", ["C"]), // colorless only: not a black source
  ]);
  const black = manaAudit(deck).find((r) => r.color === "B")!;
  expect(black.supplied).toBe(3);
});

test("the worst unmet demand is the one reported, and it names how many cards want it", () => {
  const deck = fillTo(100, [
    ...Array.from({ length: 12 }, (_, i) => card(`double-${i}`, "{1}{B}{B}", 3)),
    ...Array.from({ length: 4 }, (_, i) => card(`single-${i}`, "{B}", 1)),
    // One under what the CORRECTED requirement asks for, since `met` reads that end -- pinned to
    // the function rather than to a literal so the fixture cannot silently stop testing anything.
    ...Array.from({ length: minSources(2, 3)! - 1 }, (_, i) => source(`Swamp-${i}`, ["B"])),
    ...islands(10),
  ]);
  const black = manaAudit(deck).find((r) => r.color === "B")!;

  expect(black.supplied).toBe(minSources(2, 3)! - 1);
  const worst = black.worst!;
  expect(worst.pips).toBe(2);
  expect(worst.turn).toBe(3);
  expect(worst.cards).toBe(12);
  expect(worst.required).toBe(minSources(2, 3));
  expect(worst.requiredRaw).toBe(minCopies(2, 3, 0.9, 100));
  expect(worst.met).toBe(false);
  expect(worst.required - black.supplied).toBeGreaterThan(0);
});

/** Ranked by SHORTFALL, not by pip count. A double-pip demand on turn 6 can be closer to met than
 *  a single pip on turn 1, and showing the bigger number instead of the bigger gap would point the
 *  reader at the wrong card. */
test("the worst demand is the biggest shortfall, not the most pips", () => {
  const deck = fillTo(100, [
    card("Turn-one black", "{B}", 1),          // 1 pip by T1: the tightest window in the game
    card("Very late double", "{8}{B}{B}", 10), // 2 pips, but ten turns to find them
    // Under BOTH corrected requirements, so both demands are unmet and the ranking has to choose.
    ...Array.from({ length: Math.min(minSources(1, 1)!, minSources(2, 10)!) - 1 }, (_, i) => source(`Swamp-${i}`, ["B"])),
    ...islands(10),
  ]);
  const black = manaAudit(deck).find((r) => r.color === "B")!;
  expect(black.demands.filter((d) => !d.met).length).toBe(2);
  expect(black.worst!.pips).toBe(1);
  expect(black.worst!.turn).toBe(1);
  // The single pip is the bigger gap despite being the smaller demand, and the ranking has to see
  // that: 17 needed against 15, versus 16 against 15.
  expect(minSources(1, 1)).toBe(17);
  expect(minSources(2, 10)).toBe(16);
});

test("a colour the deck supplies well enough has no worst row", () => {
  const deck = fillTo(100, [
    card("Doom Blade", "{1}{B}", 2),
    ...Array.from({ length: 40 }, (_, i) => source(`Swamp-${i}`, ["B"])),
  ]);
  const black = manaAudit(deck).find((r) => r.color === "B")!;
  expect(black.demands.every((d) => d.met)).toBe(true);
  expect(black.worst).toBeUndefined();
});

/** #680, THE FRIEND'S IMOTEKH LIST: "Their Number Is Legion wants four black on turn 4 ... takes 49"
 *  in a mono-black deck whose 42 sources all make black. No recolouring answers that -- it is how
 *  much mana the deck runs, the land block's question -- so it is not this colour's worst row.
 *  The SAME demand in a deck that could trade blue sources for black ones still is. */
test("a shortfall no recolouring could close is not the colour's worst row", () => {
  const legion = card("Their Number Is Legion", "{B}{B}{B}{B}", 4);
  const swamps = (n: number) => Array.from({ length: n }, (_, i) => source(`Swamp-${i}`, ["B"]));
  const need = minSources(4, 4)!;

  const mono = manaAudit(fillTo(100, [legion, ...swamps(need - 2)])).find((r) => r.color === "B")!;
  expect(mono.demands[0]!.met).toBe(false); // still true: the deck does miss it
  expect(mono.worst).toBeUndefined();
  expect(mono.countBound).toBe(true); // …and not "every cost covered" either

  // Colourless sources recolour too: a Rogue's Passage could have been a Swamp.
  const passages = Array.from({ length: 5 }, (_, i) => source(`Passage-${i}`, ["C"]));
  const withUtility = manaAudit(fillTo(100, [legion, ...swamps(need - 2), ...passages])).find((r) => r.color === "B")!;
  expect(withUtility.worst?.pips).toBe(4);

  const twoColour = manaAudit(fillTo(100, [legion, ...swamps(need - 2), ...islands(5)])).find((r) => r.color === "B")!;
  expect(twoColour.worst?.pips).toBe(4);
  expect(twoColour.countBound).toBe(false);
});

test("a colour nothing in the deck costs is not reported at all", () => {
  const deck = fillTo(100, [card("Doom Blade", "{1}{B}", 2), source("Swamp", ["B"])]);
  expect(manaAudit(deck).map((r) => r.color)).toEqual(["B"]);
});

/** The commander is never drawn from the library, so it cannot be a source the maths is counting
 *  -- and `required` is computed against a library that excludes it. Counting it would credit a
 *  source that is not in the deck the hypergeometric describes. */
test("a commander is not counted as a source", () => {
  const deck = fillTo(100, [
    card("Doom Blade", "{1}{B}", 2),
    source("Chromatic Lantern", ["W", "U", "B", "R", "G"]),
    source("Swamp", ["B"]),
  ]);
  const withCommander = manaAudit(deck, { commanderNames: ["Chromatic Lantern"] });
  expect(withCommander.find((r) => r.color === "B")!.supplied).toBe(1);
  expect(manaAudit(deck).find((r) => r.color === "B")!.supplied).toBe(2);
});

test("a card with no mana cost demands nothing", () => {
  const deck = fillTo(100, [source("Swamp", ["B"]), card("Ancestral Vision", "", 0)]);
  expect(manaAudit(deck)).toEqual([]);
});

/** The definitional half of the same fix `castability.ts` carries: a ritual adds mana once and is
 *  gone, so it is not a source you can hold to the audit's 90% confidence. Measured over the 71
 *  calibration decks it moved `supplied` on 103 of 153 colour rows. */
test("a one-shot ritual is not a coloured source", () => {
  const ritual = (i: number) => card(`Dark Ritual-${i}`, "{B}", 1, { producedMana: ["B"], typeLine: "Instant" });
  const deck = fillTo(100, [
    card("Damnation", "{2}{B}{B}", 4),
    ...Array.from({ length: 8 }, (_, i) => ritual(i)),
    ...Array.from({ length: 20 }, (_, i) => source(`Swamp-${i}`, ["B"])),
  ]);
  expect(manaAudit(deck).find((r) => r.color === "B")!.supplied).toBe(20);
});

/** …and a mana ROCK still is one: the exclusion is about one-shots, not about nonlands. */
test("a permanent source is still counted", () => {
  const deck = fillTo(100, [
    card("Damnation", "{2}{B}{B}", 4),
    card("Charcoal Diamond", "{2}", 2, { producedMana: ["B"], typeLine: "Artifact" }),
    ...Array.from({ length: 20 }, (_, i) => source(`Swamp-${i}`, ["B"])),
  ]);
  expect(manaAudit(deck).find((r) => r.color === "B")!.supplied).toBe(21);
});

/** T18b. THE PANEL SAID "25 SOURCES, ENOUGH" AND THE SIMULATOR SAID 40% ABOUT THE SAME CARD ON THE
 *  SAME TURN, and both were printed on one screen. `supplied` counted every repeatable producer in
 *  the deck against a turn-1 demand: mana rocks that cost two, and lands that enter tapped exactly
 *  then. Two of the three ceilings this module has documented since it was written.
 *
 *  A demand now carries its OWN `available` -- the sources that could be producing by ITS deadline
 *  -- and `met` reads that. `supplied` is unchanged and still means what it says: every source in
 *  the deck, which is a true deck fact and the wrong number to hold a turn-1 demand to. */
test("a turn-1 demand does not count a two-mana rock as a source", () => {
  const rock = (name: string): DeckCard => ({
    card: {
      name, typeLine: "Artifact", manaCost: "{2}", manaValue: 2, oracleText: "{T}: Add {R}.",
      keywords: [], colors: [], producedMana: ["R"],
    } as Card,
    tags: null,
  });
  const deck = fillTo(100, [
    card("Curse of Opulence", "{R}", 1),
    ...Array.from({ length: 12 }, () => source("Mountain", ["R"])),
    ...Array.from({ length: 8 }, (_, i) => rock(`Signet ${i}`)),
  ]);
  const row = manaAudit(deck).find((r) => r.color === "R")!;
  // The deck fact is unchanged: 20 cards in the library can produce red.
  expect(row.supplied).toBe(20);
  const turn1 = row.demands.find((d) => d.turn === 1 && d.pips === 1)!;
  // A {2} rock cannot pay for a turn-1 spell. Twelve Mountains can.
  expect(turn1.available).toBe(12);
});

test("a turn-1 demand does not count a land that enters tapped on turn 1", () => {
  const tapland = (name: string): DeckCard => ({
    card: {
      name, typeLine: "Land", manaValue: 0, keywords: [], colors: [], producedMana: ["R"],
      oracleText: `${name} enters the battlefield tapped.`,
    } as Card,
    tags: null,
  });
  const slow = (name: string): DeckCard => ({
    card: {
      name, typeLine: "Land", manaValue: 0, keywords: [], colors: [], producedMana: ["R"],
      oracleText: `${name} enters the battlefield tapped unless you control two or more other lands.`,
    } as Card,
    tags: null,
  });
  const deck = fillTo(100, [
    card("Curse of Opulence", "{R}", 1),
    card("Three Drop", "{2}{R}", 3),
    ...Array.from({ length: 10 }, () => source("Mountain", ["R"])),
    ...Array.from({ length: 5 }, (_, i) => tapland(`Tapland ${i}`)),
    ...Array.from({ length: 4 }, (_, i) => slow(`Slow Land ${i}`)),
  ]);
  const row = manaAudit(deck).find((r) => r.color === "R")!;
  expect(row.supplied).toBe(19);
  // Turn 1: no other lands, so the slow lands are tapped too. Ten Mountains only.
  expect(row.demands.find((d) => d.turn === 1)!.available).toBe(10);
  // Turn 3: two other lands are already down, which is exactly what a slow land asks for.
  // The unconditional taplands are still tapped the turn they arrive.
  expect(row.demands.find((d) => d.turn === 3)!.available).toBe(14);
});

test("met and worst read the deadline-aware count, not the deck total", () => {
  const rock = (name: string): DeckCard => ({
    card: {
      name, typeLine: "Artifact", manaCost: "{2}", manaValue: 2, oracleText: "{T}: Add {B}.",
      keywords: [], colors: [], producedMana: ["B"],
    } as Card,
    tags: null,
  });
  // Enough sources on paper, none of them able to pay on turn one.
  const deck = fillTo(100, [
    card("One Drop", "{B}", 1),
    ...Array.from({ length: 30 }, (_, i) => rock(`Rock ${i}`)),
    ...islands(20),
  ]);
  const row = manaAudit(deck).find((r) => r.color === "B")!;
  expect(row.supplied).toBe(30);
  const turn1 = row.demands.find((d) => d.turn === 1)!;
  expect(turn1.available).toBe(0);
  expect(turn1.met).toBe(false);
  expect(row.worst).toBeDefined();
  expect(row.worst!.turn).toBe(1);
});

/** A FETCHLAND PRODUCES THE COLOUR IT FINDS (2026-09-04). `producedMana` is empty on a real fetch and
 *  correctly so, which told a mono-blue deck with six fetchlands that blue was short at the top of
 *  its curve. The simulator has counted them since N2; this is the colour panel catching up. */
/** A fetch reads the TYPE LINE of what it looks for, so these fixtures print real ones: "Island" on
 *  a `Land` line is not findable by a card searching for an Island. */
const basic = (name: string, type: string, produces: string[]): DeckCard => ({
  card: {
    name, typeLine: `Basic Land — ${type}`, oracleText: "", keywords: [], colors: [], manaValue: 0,
    producedMana: produces,
  } as Card,
  tags: null,
});

const fetchland = (name: string, text: string): DeckCard => ({
  card: {
    name, typeLine: "Land", oracleText: text, keywords: [], colors: [], manaValue: 0,
  } as Card,
  tags: null,
});
const DELTA = "{T}, Pay 1 life, Sacrifice this land: Search your library for an Island or Swamp card, put it onto the battlefield, then shuffle.";
const WILDS = "{T}, Sacrifice this land: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.";
const PASSAGE = "{T}, Sacrifice this land: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle. Then if you control four or more lands, untap that land.";

test("a fetchland counts for the colours it can find, and only those", () => {
  const islands = Array.from({ length: 20 }, (_, i) => basic(`Island-${i}`, "Island", ["U"]));
  const blue = manaAudit(fillTo(100, [
    card("Counterspell", "{U}{U}", 2), ...islands,
    ...Array.from({ length: 4 }, (_, i) => fetchland(`Polluted Delta-${i}`, DELTA)),
  ])).find((r) => r.color === "U")!;
  expect(blue.supplied).toBe(24);

  // The same fetch in a deck it can find nothing in: a Delta names Island and Swamp, so a Forest is
  // not a target and the fetch is not a green source.
  const green = manaAudit(fillTo(100, [
    card("Overrun", "{2}{G}{G}{G}", 5),
    ...Array.from({ length: 20 }, (_, i) => basic(`Forest-${i}`, "Forest", ["G"])),
    ...Array.from({ length: 4 }, (_, i) => fetchland(`Polluted Delta-${i}`, DELTA)),
  ])).find((r) => r.color === "G")!;
  expect(green.supplied).toBe(20);
});

/** THE CAP: every fetch is a wildcard for its own fetchable set, but the library is finite. Fifteen
 *  fetches over five white lands is five white sources, not fifteen. Binds on 31 of the 153
 *  calibration colour rows. */
test("fetches are capped at what the deck gives them to find", () => {
  const deck = fillTo(100, [
    card("Counterspell", "{U}{U}", 2),
    ...Array.from({ length: 2 }, (_, i) => basic(`Island-${i}`, "Island", ["U"])),
    ...Array.from({ length: 8 }, (_, i) => fetchland(`Polluted Delta-${i}`, DELTA)),
  ]);
  expect(manaAudit(deck).find((r) => r.color === "U")!.supplied).toBe(4);
});

/** `classifyLand` reads the card in front of it and calls Evolving Wilds untapped, which it is -- the
 *  BASIC it finds is the one that arrives tapped, and no land classifier can see that. */
test("a fetch whose land arrives tapped is not available on its deadline", () => {
  const build = (text: string) => fillTo(100, [
    card("Ancestral Recall", "{U}", 1),
    card("Counterspell", "{U}{U}", 2),
    card("Fact or Fiction", "{3}{U}", 4),
    card("Mystical Tutor", "{2}{U}", 3),
    ...Array.from({ length: 30 }, (_, i) => basic(`Island-${i}`, "Island", ["U"])),
    ...Array.from({ length: 4 }, (_, i) => fetchland(`fetch-${i}`, text)),
  ]);
  const at = (text: string, turn: number) =>
    manaAudit(build(text)).find((r) => r.color === "U")!.demands.find((d) => d.turn === turn)!.available;
  // A Delta's Island is untapped, so all four count from turn 1.
  expect(at(DELTA, 1)).toBe(34);
  // Evolving Wilds' basic is tapped on every turn, so the four never count.
  expect(at(WILDS, 1)).toBe(30);
  expect(at(WILDS, 4)).toBe(30);
  // Fabled Passage untaps it once four lands are down -- three before the drop it makes itself.
  expect(at(PASSAGE, 3)).toBe(30);
  expect(at(PASSAGE, 4)).toBe(34);
});

/** THE ONE PLACE `isManaSource` IS BYPASSED. That gate refuses a sorcery because a RITUAL is a
 *  one-shot; Cultivate is not one -- it leaves a Forest on the battlefield permanently. It is still
 *  on a rock's clock: cast on turn 3, it pays from turn 4. */
test("a land-fetch sorcery is a source, and a ritual still is not", () => {
  const cultivate = (i: number) => card(`Cultivate-${i}`, "{2}{G}", 3, {
    oracleText: "Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.",
  });
  const deck = fillTo(100, [
    card("Overrun", "{2}{G}{G}{G}", 5),
    ...Array.from({ length: 20 }, (_, i) => basic(`Forest-${i}`, "Forest", ["G"])),
    ...Array.from({ length: 4 }, (_, i) => cultivate(i)),
  ]);
  const green = manaAudit(deck).find((r) => r.color === "G")!;
  expect(green.supplied).toBe(24);
  // On a rock's clock: cast on turn 3, its Forest taps for mana on turn 4. The tapped arrival is
  // not charged twice -- that IS the turn the rock clock already skips.
  expect(green.demands.find((d) => d.turn === 3)!.available).toBe(20);
  expect(green.demands.find((d) => d.turn === 5)!.available).toBe(24);
});

test("the colour deficit is the worst demand's shortfall per colour, and absent when the colour is met", () => {
  // Black wants {B}{B} early and has two sources while blue has plenty of its own: black is short, blue is not.
  const deck = fillTo(100, [
    card("Damnation", "{2}{B}{B}", 4),
    card("Counterspell", "{U}{U}", 2),
    ...Array.from({ length: 2 }, () => source("Swamp", ["B"])),
    ...islands(30),
  ]);
  const rows = manaAudit(deck);
  const black = rows.find((r) => r.color === "B")!.worst!;
  const d = colourDeficit(deck);
  expect(d.B).toBe(black.required - black.available);
  expect(d.B).toBeGreaterThan(0);
  expect(d.U).toBeUndefined();
});

/** COST AGAINST PRODUCTION (owner, 2026-10-08, #1114): a colour counts only when a line that makes it produces
 *  at least its cost plus its own tap. Cards as the corpus prints them. */
import rocks from "./ramp-colour.fixtures.json" with { type: "json" };
import { fixedColours, manaLines } from "./mana-lines.js";
const real = (name: keyof typeof rocks) => rocks[name] as unknown as DeckCard;

test("a filter land is a full source of both its colours; Cascading Cataracts and Prismatic Lens fix none; a Signet still does", () => {
  expect([...fixedColours(real("Cascade Bluffs"))].sort()).toEqual(["C", "R", "U"]);
  expect([...fixedColours(real("Sunken Ruins"))].sort()).toEqual(["B", "C", "U"]);
  expect([...fixedColours(real("Darkwater Catacombs"))].sort()).toEqual(["B", "U"]);
  expect([...fixedColours(real("Izzet Signet"))].sort()).toEqual(["R", "U"]);
  expect(fixedColours(real("Cascading Cataracts"))).toEqual(["C"]);
  expect(fixedColours(real("Prismatic Lens"))).toEqual(["C"]);
  // An amount that scales cannot be judged from the line, so Cabal Coffers keeps its black.
  expect(fixedColours(real("Cabal Coffers"))).toEqual(["B"]);
  // The scaling exemption reads the produced-mana clause only: a later "where X is" / "equal to" sentence
  // (Study Hall, Opal Palace) is no part of the amount, and these are Prismatic Lens lines.
  expect(fixedColours(real("Study Hall"))).toEqual(["C"]);
  expect(fixedColours(real("Opal Palace"))).toEqual(["C"]);
  expect(manaLines(real("Cascading Cataracts")).map((l) => [l.net, l.qualifies])).toEqual([[1, true], [0, false]]);
});

test("the audit counts a source only for the colours it fixes", () => {
  const blue = fillTo(100, [card("Counterspell", "{U}{U}", 2), ...islands(10)]);
  const suppliedU = (extra: DeckCard) => manaAudit([...blue.slice(0, 11), extra, ...blue.slice(11, 99)]).find((r) => r.color === "U")!.supplied;
  const base = suppliedU(filler(999));
  expect(suppliedU(real("Cascade Bluffs"))).toBe(base + 1);
  expect(suppliedU(real("Izzet Signet"))).toBe(base + 1);
  expect(suppliedU(real("Cascading Cataracts"))).toBe(base);
  expect(suppliedU(real("Prismatic Lens"))).toBe(base);
});

test("the mana base score counts sources by what they fix: Cascading Cataracts is not a blue source there either", async () => {
  const { colourSources } = await import("./mana-base.js");
  const deck = (extra: DeckCard) => fillTo(100, [card("Counterspell", "{U}{U}", 2), ...islands(10), extra]);
  const withCataracts = deck(real("Cascading Cataracts"));
  expect(colourSources(withCataracts).get("U")).toBe(10);
  expect(colourSources(deck(real("Cascade Bluffs"))).get("U")).toBe(11);
});

/** STATIC COLOUR FIXERS (owner, 2026-10-08, #1115): once Chromatic Lantern is out, every land is a source of every
 *  colour. One card, not always drawn, so the credit is weighted by P(at least one seen by the turn). */
import { pAtLeast, seen } from "@edh-seer/engine";

const mountains = (n: number) => Array.from({ length: n }, (_, i) => source(`Mountain-${i}`, ["R"]));

test("a Lantern credits blue to the lands that were not blue, weighted by P(seen), floored; without it nothing moves", () => {
  const base = [card("Cancel", "{2}{U}{U}", 4), ...mountains(30), ...islands(6)];
  const withLantern = fillTo(100, [...base, real("Chromatic Lantern")]);
  const without = fillTo(100, [...base, filler(900)]);
  const uDemand = (deck: DeckCard[]) => manaAudit(deck).find((r) => r.color === "U")!.demands.find((d) => d.turn === 4)!;

  const plain = uDemand(without);
  expect(plain.available).toBe(6);
  expect(plain.fixedBy).toBeUndefined();

  // Lantern itself is one blue source (mana value 3 < 4); the 30 Mountains are the lands it newly fixes.
  const lantern = uDemand(withLantern);
  const p = pAtLeast(1, 1, seen(4), 100);
  expect(lantern.available).toBe(7 + Math.floor(p * 30));
  expect(lantern.available).toBeGreaterThan(7);
  expect(lantern.fixedBy).toEqual(["Chromatic Lantern"]);
  expect(lantern.met).toBe(lantern.available >= lantern.required);
});

test("a fixer that is not out yet by the deadline credits nothing", () => {
  // Lantern costs 3: a turn-3 demand sees it only as a card in hand.
  const deck = fillTo(100, [card("Counterspell", "{U}{U}", 3), ...mountains(30), ...islands(6), real("Chromatic Lantern")]);
  const d = manaAudit(deck).find((r) => r.color === "U")!.demands[0]!;
  expect(d.fixedBy).toBeUndefined();
  expect(d.available).toBe(6);
});

test("Urborg fixes black only", () => {
  const swamps = (n: number) => Array.from({ length: n }, (_, i) => source(`Swamp-${i}`, ["B"]));
  const urborg = real("Urborg, Tomb of Yawgmoth");
  const inert = { ...urborg, card: { ...urborg.card, oracleText: "" } } as DeckCard;
  const build = (u: DeckCard) => fillTo(100, [card("Cancel", "{2}{U}{U}", 4), card("Doom", "{2}{B}{B}", 4), ...mountains(30), ...islands(6), ...swamps(6), u]);
  const at = (deck: DeckCard[], c: string) => manaAudit(deck).find((r) => r.color === c)!.demands[0]!;
  expect(at(build(urborg), "B").available).toBeGreaterThan(at(build(inert), "B").available);
  expect(at(build(urborg), "U").available).toBe(at(build(inert), "U").available);
});

test("an all-mana fixer (Chromatic Orrery) credits rocks and dorks too, once it is out", () => {
  const rock = (i: number) => ({ card: { name: `Rock-${i}`, typeLine: "Artifact", oracleText: "{T}: Add {C}.", keywords: [], colors: [], manaValue: 1, producedMana: ["C"] }, tags: null }) as unknown as DeckCard;
  const rocksN = Array.from({ length: 10 }, (_, i) => rock(i));
  const build = (extra: DeckCard) => fillTo(100, [card("Big Blue", "{6}{U}{U}", 8), ...mountains(30), ...islands(6), ...rocksN, extra]);
  const at = (deck: DeckCard[]) => manaAudit(deck).find((r) => r.color === "U")!.demands[0]!;
  const withOrrery = at(build(real("Chromatic Orrery")));
  const none = at(build(filler(901)));
  // Orrery costs 7, so it is out for an eight-drop; lands AND the ten rocks gain blue.
  // Everything online that was not blue: 30 Mountains, 10 rocks and the Orrery itself (it taps for {C}).
  expect(withOrrery.available).toBe(none.available + Math.floor(pAtLeast(1, 1, seen(8), 100) * 41 + 1e-9));
  expect(withOrrery.fixedBy).toEqual(["Chromatic Orrery"]);
});

/** GOLD CARDS ARE A JOINT DEMAND (#1116, owner 2026-10-08): the per-colour rows stay, and the joint check surfaces only
 *  when every colour alone passes and the cost as a whole does not. */
import { manaAuditFull, plainPips } from "./mana-audit.js";
import { pCanPayByTurn } from "./mulligan.js";

const many = (n: number, produces: string[], tag: string) => Array.from({ length: n }, (_, i) => source(`${tag}-${i}`, produces));

test("a hybrid or Phyrexian symbol is not a joint pip", () => {
  expect(plainPips("{W}{U}")).toEqual({ W: 1, U: 1 });
  expect(plainPips("{W/U}{B}")).toEqual({ B: 1 });
  expect(plainPips("{2/B}{B/P}{G}")).toEqual({ G: 1 });
});

test("{W}{U} on turn 2 fails jointly while white and blue each pass alone", () => {
  const deck = fillTo(100, [card("Absorb-ish", "{W}{U}", 2), ...many(25, ["W"], "Plains"), ...many(25, ["U"], "Island")]);
  const { gold } = manaAuditFull(deck);
  expect(gold).toBeDefined();
  expect(gold!.colours).toEqual(["W", "U"]);
  expect(gold!.turn).toBe(2);
  expect(gold!.names).toEqual(["Absorb-ish"]);
  expect(gold!.pEach).toBeCloseTo(pCanPayByTurn([75, 25], [1], 2), 10);
  expect(gold!.pEach).toBeGreaterThanOrEqual(0.9);
  expect(gold!.pJoint).toBeCloseTo(pCanPayByTurn([50, 25, 25, 0], [1, 1], 2), 10);
  expect(gold!.pJoint).toBeLessThan(0.9);
});

test("enough duals make the joint demand pass, so there is no gold field", () => {
  const deck = fillTo(100, [card("Absorb-ish", "{W}{U}", 2), ...many(25, ["W"], "Plains"), ...many(25, ["U"], "Island"), ...many(20, ["W", "U"], "Dual")]);
  expect(manaAuditFull(deck).gold).toBeUndefined();
});

test("a deck with no gold demand has no gold field, and a colour alone short is not a gold finding", () => {
  expect(manaAuditFull(fillTo(100, [card("Mono", "{W}{W}", 2), ...many(25, ["W"], "Plains")])).gold).toBeUndefined();
  // White is short alone (3 sources): the per-colour row owns that, the joint check stays quiet.
  expect(manaAuditFull(fillTo(100, [card("Absorb-ish", "{W}{U}", 2), ...many(3, ["W"], "Plains"), ...many(25, ["U"], "Island")])).gold).toBeUndefined();
  // A hybrid-only gold cost is not a joint demand.
  expect(manaAuditFull(fillTo(100, [card("Hybrid", "{W/U}{W/U}", 2), ...many(25, ["W"], "Plains")])).gold).toBeUndefined();
});

test("manaAudit still returns the rows alone", () => {
  expect(Array.isArray(manaAudit(fillTo(100, [card("Mono", "{W}{W}", 2), ...many(25, ["W"], "Plains")])))).toBe(true);
});
