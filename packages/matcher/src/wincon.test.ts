import { expect, test } from "vitest";
import type { Card } from "@mtg/engine";
import type { CardTags } from "@mtg/tagger";
import { detectWincons, focusIndex, winconReport } from "./wincon.js";
import type { DeckCard } from "./types.js";

/** `anthem` marks the ability as a STATIC pump on a class, which is what separates a real go-wide
 *  payoff from every combat trick that also carries the `pump` kind. */
const tags = (id: string, kinds: string[], subtypes: string[] = [], anthem = false): CardTags => ({
  oracleId: id, schemaVersion: 1, promptVersion: 1, model: "t",
  characteristics: {
    types: ["creature"], subtypes, colors: [], identity: [], cmc: 0,
    power: null, toughness: null, token: false, keywords: [],
  },
  abilities: kinds.map((kind) => ({
    kind: (anthem ? "static" : "on-cast") as never,
    effect: (anthem
      ? { kind, subject: { type: "creature", control: "you", token: null } }
      : kind === "token-generation"
        // Real token abilities name what they create, and that subject is the whole question: a
        // Treasure maker is ramp, a Goblin maker is a board.
        ? { kind, subject: { subtype: "goblin", control: "you", token: true } }
        : { kind }) as never,
  })),
});

const mk = (
  name: string,
  opts: { oracleText?: string; typeLine?: string; power?: string; mv?: number; kinds?: string[]; subtypes?: string[]; anthem?: boolean } = {},
): DeckCard => ({
  card: {
    name,
    typeLine: opts.typeLine ?? "Creature — Human",
    oracleText: opts.oracleText ?? "",
    keywords: [], colors: [],
    manaValue: opts.mv ?? 3,
    power: opts.power ?? null,
  } as Card,
  tags: tags(name, opts.kinds ?? [], opts.subtypes ?? [], opts.anthem ?? false),
});

test("each class is detected by its own structural signature", () => {
  const classes = detectWincons([
    mk("Krenko", { kinds: ["token-generation"] }),
    mk("Colossus Hammer", { typeLine: "Artifact — Equipment", subtypes: ["equipment"] }),
    mk("Ghalta", { power: "12", mv: 12 }),
    mk("Gurmag Angler", { power: "5", mv: 7 }),
    mk("Impact Tremors", { kinds: ["player-damage"], typeLine: "Enchantment" }),
    mk("Bruvac", { oracleText: "Each opponent mills twice that many cards instead." }),
    mk("Thassa's Oracle", { oracleText: "If X is greater than or equal to the number of cards in your library, you win the game." }),
  ]);
  expect([...(classes.get("go-wide") ?? [])]).toEqual(["Krenko"]);
  expect([...(classes.get("voltron") ?? [])]).toEqual(["Colossus Hammer"]);
  expect([...(classes.get("burn") ?? [])]).toEqual(["Impact Tremors"]);
  expect([...(classes.get("mill") ?? [])]).toEqual(["Bruvac"]);
  expect([...(classes.get("alt-win") ?? [])]).toEqual(["Thassa's Oracle"]);
});

/** The measured leak, and the reason go-wide is not a rules row: keying it on `token-generation`
 *  alone put the class in all 71 calibration decks and made it the primary plan of 52, because a
 *  Treasure is a token. */
test("a Treasure maker is ramp, not a board", () => {
  const treasure = (name: string): DeckCard => ({
    card: { name, typeLine: "Instant", oracleText: "", keywords: [], colors: [], manaValue: 2 } as Card,
    tags: {
      oracleId: name, schemaVersion: 1, promptVersion: 1, model: "t",
      characteristics: {
        types: ["instant"], subtypes: [], colors: [], identity: [], cmc: 2,
        power: null, toughness: null, token: false, keywords: [],
      },
      abilities: [{
        kind: "on-cast",
        effect: {
          kind: "token-generation",
          subject: { subtype: "treasure", type: "artifact", control: "you", token: true },
        },
      }],
    } as CardTags,
  });
  const classes = detectWincons([treasure("An Offer You Can't Refuse"), treasure("Pirate's Pillage")]);
  expect(classes.has("go-wide")).toBe(false);
});

test("stompy is a creature bigger than its cost, and an undersized one is not", () => {
  const classes = detectWincons([
    mk("Ghalta", { power: "12", mv: 12 }),        // 12 power for 12: not over its cost
    mk("Phyrexian Dreadnought", { power: "12", mv: 1 }),
    mk("Tarmogoyf", { power: "*", mv: 2 }),        // power is a board state, not a printed size
    mk("Grey Ogre", { power: "2", mv: 3 }),
  ]);
  expect([...(classes.get("stompy") ?? [])]).toEqual(["Phyrexian Dreadnought"]);
});

/** Design §12.5: an anthem is `pump`, it is the go-wide PAYOFF, and giving it its own bucket would
 *  count a go-wide deck twice. */
test("an anthem is not its own class", () => {
  const classes = detectWincons([mk("Intangible Virtue", { kinds: ["pump"], typeLine: "Enchantment", anthem: true })]);
  expect([...classes.keys()]).toEqual([]);
});

test("a token producer that is also a big body is go-wide, not stompy", () => {
  const classes = detectWincons([
    mk("Hornet Queen", { kinds: ["token-generation"], power: "8", mv: 7 }),
  ]);
  expect([...(classes.get("go-wide") ?? [])]).toEqual(["Hornet Queen"]);
  expect(classes.has("stompy")).toBe(false);
});

/** The load-bearing point of §12.5: interaction wants COVERAGE, wincons want CONCENTRATION. A deck
 *  all-in on one plan beats a deck with three half-plans, so breadth here is a defect and the two
 *  axes must never share a scoring instrument. */
test("focus is 1 for one plan and falls as the plans multiply", () => {
  expect(focusIndex(new Map([["go-wide", 10]]))).toBe(1);
  expect(focusIndex(new Map([["go-wide", 5], ["burn", 5]]))).toBeCloseTo(0.5, 10);
  expect(focusIndex(new Map([["go-wide", 4], ["burn", 4], ["mill", 4], ["stompy", 4]]))).toBeCloseTo(0.25, 10);
  // Weighted by SHARE, not by count: eight cards on one plan against two on another is focused.
  expect(focusIndex(new Map([["go-wide", 8], ["burn", 2]]))).toBeCloseTo(0.68, 10);
});

test("focus is 0 when the deck names no wincon at all", () => {
  expect(focusIndex(new Map())).toBe(0);
});

/** The consumer half of §12.5's go-wide signature, and it is not optional detail: without it every
 *  one of the 71 calibration decks read as go-wide and 52 of them as go-wide FIRST, because almost
 *  every EDH deck makes a token somewhere. */
test("token makers are only a win plan when something pays them off", () => {
  const makers = Array.from({ length: 6 }, (_, i) => mk(`Maker-${i}`, { kinds: ["token-generation"] }));
  expect(winconReport(makers).classes.find((c) => c.class === "go-wide")).toBeUndefined();

  const withAnthem = [...makers, mk("Intangible Virtue", { kinds: ["pump"], typeLine: "Enchantment", anthem: true })];
  expect(winconReport(withAnthem).classes.find((c) => c.class === "go-wide")!.count).toBe(6);
});

test("the report ranks classes by size and carries the focus index", () => {
  const deck = [
    ...Array.from({ length: 6 }, (_, i) => mk(`Maker-${i}`, { kinds: ["token-generation"] })),
    mk("Intangible Virtue", { kinds: ["pump"], typeLine: "Enchantment", anthem: true }),
    ...Array.from({ length: 2 }, (_, i) => mk(`Bolt-${i}`, { kinds: ["player-damage"], typeLine: "Instant" })),
  ];
  const report = winconReport(deck);
  expect(report.classes.map((c) => c.class)).toEqual(["go-wide", "burn"]);
  expect(report.classes[0].count).toBe(6);
  expect(report.focus).toBeCloseTo(0.625, 10);
  expect(report.primary).toBe("go-wide");
});

test("two stray cards are not a win plan, but one alt-win is", () => {
  const deck = [
    ...Array.from({ length: 20 }, (_, i) => mk(`Maker-${i}`, { kinds: ["token-generation"] })),
    mk("Intangible Virtue", { kinds: ["pump"], typeLine: "Enchantment", anthem: true }),
    // One stray beater against twenty token makers: below the floor, and reporting it would drag
    // the focus index down as if the deck were split between two plans.
    mk("Big Body", { power: "6", mv: 4 }),
    mk("Thassa's Oracle", { oracleText: "you win the game" }),
  ];
  const report = winconReport(deck);
  expect(report.classes.map((c) => c.class)).toEqual(["go-wide", "alt-win"]);
  expect(report.focus).toBeGreaterThan(0.9);
});

/** A known combo is real data -- the report already carries it from the combo index -- but it is
 *  NOT chain detection, and the class exists to say the deck has one, not to claim we derived it. */
test("a known combo becomes the combo class, and it is not inferred from the graph", () => {
  const deck = [mk("Thassa's Oracle", { oracleText: "you win the game" }), mk("Consultation", {})];
  const report = winconReport(deck, { comboCards: ["Thassa's Oracle", "Consultation"] });
  expect(report.classes.find((c) => c.class === "combo")!.count).toBe(2);
  // Thassa's Oracle says it wins the game in words, so it is alt-win too. A card can serve two
  // plans and both are true.
  expect(report.classes.find((c) => c.class === "alt-win")!.count).toBe(1);
});
