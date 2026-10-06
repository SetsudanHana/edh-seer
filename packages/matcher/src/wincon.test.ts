import { describe, expect, test } from "vitest";
import type { Card } from "@edh-seer/engine";
import type { CardTags } from "@edh-seer/tagger";
import { detectWincons, drainClock, focusIndex, winconReport } from "./wincon.js";
import type { Reason } from "@edh-seer/engine";
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

/** A token that leaves the turn it arrived is not a board you win with, but it IS still a board.
 *  Inalla copies a Wizard and exiles it at the beginning of the next end step; she was counted among
 *  12 go-wide cards in her own deck on a board that does not exist when the turn ends. Found by the
 *  TUNER persona rejecting its own deck's report.
 *
 *  The second half is the one that matters: the flag must exclude the WIN PLAN and nothing else. A
 *  temporary token still enters (its ETB payoffs are real, and that is Inalla's actual engine),
 *  still attacks with haste, and can still be sacrificed in response. `wincon.ts` is deliberately
 *  the only reader of `temporary` — deleting the token's relations to fix a label would repeat the
 *  `entersTapped` mistake, which silently removed 29 real claims. */
test("a token that leaves the turn it arrived is not a go-wide plan", () => {
  const permanent = mk("Krenko", { kinds: ["token-generation"] });
  expect([...(detectWincons([permanent]).get("go-wide") ?? [])]).toEqual(["Krenko"]);

  const temporary = mk("Inalla, Archmage Ritualist", { kinds: ["token-generation"] });
  temporary.tags!.abilities[0].temporary = true;
  expect(detectWincons([temporary]).has("go-wide")).toBe(false);
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

/** "Pick a way" is r/EDH's first advice to a deck that stalls, and a count cannot be picked from:
 *  every plan names its cards, and go-wide also names what turns the board into a win. */
test("every plan names its cards, and go-wide names its payoffs", () => {
  const deck = [
    ...Array.from({ length: 3 }, (_, i) => mk(`Maker-${i}`, { kinds: ["token-generation"] })),
    mk("Intangible Virtue", { kinds: ["pump"], typeLine: "Enchantment", anthem: true }),
    ...Array.from({ length: 2 }, (_, i) => mk(`Bolt-${i}`, { kinds: ["player-damage"], typeLine: "Instant" })),
  ];
  const [wide, burn] = winconReport(deck).classes;
  expect(wide).toMatchObject({ class: "go-wide", cards: ["Maker-0", "Maker-1", "Maker-2"], payoffs: ["Intangible Virtue"] });
  expect(burn).toMatchObject({ class: "burn", cards: ["Bolt-0", "Bolt-1"] });
  expect(burn!.payoffs).toBeUndefined();
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

/** A LOOP'S PAYOFF IS ITS WIN (owner, 2026-09-29): the combo class names the cards that turn what the
 *  loop repeats into lost games, even when they are not the loop's own pieces. */
test("the combo class names the deck's payoffs for its loops", () => {
  const deck = [mk("Gravecrawler", {}), mk("Phyrexian Altar", {}), mk("Blood Artist", {})];
  const report = winconReport(deck, { comboCards: ["Gravecrawler", "Phyrexian Altar"], comboPayoffs: ["Blood Artist", "Not In Deck"] });
  const combo = report.classes.find((c) => c.class === "combo")!;
  expect(combo.cards).toEqual(["Gravecrawler", "Phyrexian Altar"]);
  expect(combo.payoffs).toEqual(["Blood Artist"]);
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

/** #574, #647: Blasphemous Act's per-creature scaling is its COST, and it read as the one card that
 *  turns a wide board into a win. The effect that scales has to be one that can win. */
test("a cost or mana that scales with creatures is not a go-wide payoff; a drain that does is", () => {
  const makers = Array.from({ length: 6 }, (_, i) => mk(`Maker-${i}`, { kinds: ["token-generation"] }));
  const scaling = (name: string, kind: string): DeckCard => {
    const c = mk(name, { kinds: [kind], typeLine: "Sorcery" });
    (c.tags!.abilities[0].effect as { scaling?: string }).scaling = "per-creature";
    return c;
  };
  const wide = (extra: DeckCard) => winconReport([...makers, extra]).classes.find((c) => c.class === "go-wide");
  expect(wide(scaling("Blasphemous Act", "cost-reduction"))).toBeUndefined();
  expect(wide(scaling("Axebane Guardian", "mana-generation"))).toBeUndefined();
  expect(wide(scaling("Malakir Blood-Priest", ""))?.payoffs).toEqual(["Malakir Blood-Priest"]);
});

/** #574: "enchant creature" alone put Eaten by Piranhas and Sugar Coat -- removal cast on an
 *  opponent's creature -- in Rani's voltron plan. An Aura counts when it helps what it enchants. */
test("an Aura is voltron when it helps the creature it enchants, not when it takes one away", () => {
  const aura = (name: string, oracleText: string) => mk(name, { typeLine: "Enchantment — Aura", oracleText });
  const voltron = (c: DeckCard) => detectWincons([c]).get("voltron")?.has(c.card.name) ?? false;
  expect(voltron(aura("Rancor", "Enchant creature\nEnchanted creature gets +2/+0 and has trample."))).toBe(true);
  expect(voltron(aura("Aqueous Form", "Enchant creature\nEnchanted creature can't be blocked."))).toBe(true);
  expect(voltron(aura("Crab Umbra", "Enchant creature\n{2}{U}: Untap enchanted creature.\nUmbra armor"))).toBe(true);
  expect(voltron(aura("Eaten by Piranhas", "Flash\nEnchant creature\nEnchanted creature loses all abilities and is a black Skeleton creature with base power and toughness 1/1."))).toBe(false);
  expect(voltron(aura("Utter Insignificance", "Flash\nEnchant creature\nEnchanted creature loses all abilities and has base power and toughness 1/1."))).toBe(false);
  expect(voltron(aura("Shiny Impetus", "Enchant creature\nEnchanted creature gets +2/+2 and is goaded."))).toBe(false);
});

/** #574: Beast Within, Generous Gift and Stroke of Midnight were 3 of Yuna's 7 go-wide cards. The
 *  token they make is the opponent's. */
test("a token an opponent gets is not a go-wide card", () => {
  const giver = mk("Beast Within", { kinds: ["token-generation"], typeLine: "Instant" });
  (giver.tags!.abilities[0].effect.subject as { control: string }).control = "opp";
  expect(detectWincons([giver]).get("go-wide")?.has("Beast Within") ?? false).toBe(false);
  expect(detectWincons([mk("Krenko", { kinds: ["token-generation"] })]).get("go-wide")?.has("Krenko")).toBe(true);
});

/** #574's smaller cases: The Chain Veil's "you lose 2 life" read as a burn plan, and Corpse Augur's
 *  count of creature CARDS in a graveyard as a go-wide payoff. */
test("life you lose is not burn, and a count of creature cards is not the board", () => {
  const loss = (name: string, control: string): DeckCard => {
    const c = mk(name, { kinds: ["player-life-loss"], typeLine: "Artifact" });
    (c.tags!.abilities[0].effect as { subject?: object }).subject = { control, token: null };
    return c;
  };
  const burn = (cards: DeckCard[]) => detectWincons(cards).get("burn") ?? new Set();
  expect(burn([loss("The Chain Veil", "you")]).has("The Chain Veil")).toBe(false);
  expect(burn([loss("Suspended Sentence", "opp")]).has("Suspended Sentence")).toBe(true);

  const makers = Array.from({ length: 6 }, (_, i) => mk(`Maker-${i}`, { kinds: ["token-generation"] }));
  const scaler = (name: string, oracleText: string): DeckCard => {
    const c = mk(name, { kinds: ["draw-card"], oracleText });
    (c.tags!.abilities[0].effect as { scaling?: string }).scaling = "per-creature";
    return c;
  };
  const payoffs = (extra: DeckCard) => winconReport([...makers, extra]).classes.find((c) => c.class === "go-wide")?.payoffs ?? [];
  expect(payoffs(scaler("Corpse Augur", "When this creature dies, you draw X cards and you lose X life, where X is the number of creature cards in target player's graveyard."))).toEqual([]);
  expect(payoffs(scaler("Shamanic Revelation", "Draw a card for each creature you control."))).toEqual(["Shamanic Revelation"]);
});

/** THE DRAIN, SAID PER TURN (#984, owner ruling 2026-10-06): the route keeps its "not timed" refusal,
 *  and says how much life its repeating drains take from each opponent if each fires once. A one-shot
 *  (an instant) is not a per-turn drain, and an X amount is not a number. */
test("the burn plan carries its repeating drain per turn: one fire per card, X and one-shots left out", () => {
  const drain = (name: string, amount: string, kind = "triggered", repeats: string | null = "repeatable", scope = "each"): DeckCard => {
    const dc = mk(name, { kinds: ["player-damage"] });
    dc.tags!.abilities = [{ kind, effect: { kind: "player-damage", subject: { control: "opp", token: null, scope } }, amount, ...(repeats ? { repeats } : {}) } as never];
    return dc;
  };
  // Unset repeats (the rules could not tell) and a single-target drain are not "each opponent a turn".
  const deck = [drain("Leech", "1"), drain("Guardian", "2"), drain("Fireball", "X"), drain("Bolt", "3", "on-cast", "once"),
    drain("Unsure", "5", "triggered", null), drain("Sniper", "4", "triggered", "repeatable", "target")];
  const burn = winconReport(deck).classes.find((c) => c.class === "burn")!;
  expect(burn.drain).toEqual({ cards: 2, life: 3 });
});

/** THE DRAIN ROUTE'S TURN (#1056, R5; owner 2026-10-06: "how many triggers of Impact Tremors would
 *  you have"). A drain fires once per SOURCE of its trigger, and the sources are the reasons the edge
 *  layer already joined to that ability: a creature entering once on the turn it arrives, a token
 *  dated by its maker (every turn if the maker repeats), a phase trigger once a turn. Every card is a
 *  commander here so arrival is exact: on board from the turn its mana value is affordable. */
describe("drainClock", () => {
  const ability = (amount: string, verbs: string[], extra: Record<string, unknown> = {}) => ({
    kind: "triggered", repeats: "repeatable", amount, trigger: { verbs, subject: {} , ...extra },
    effect: { kind: "player-damage", subject: { control: "opp", token: null, scope: "each" } },
  });
  const card = (name: string, mv: number, abilities: unknown[] = []): DeckCard => {
    const dc = mk(name, { mv });
    dc.tags!.abilities = abilities as never;
    return dc;
  };
  const maker = card("Maker", 4, [{ kind: "triggered", repeats: "per-turn", trigger: { verbs: ["upkeep"], subject: {} }, effect: { kind: "token-generation" } }]);
  const reasons: Reason[] = [
    { tag: "enters:creature", text: "", consumer: "Tremors", consumerAbility: 0, producer: "Bear" },
    { tag: "enters:creature", text: "", consumer: "Tremors", consumerAbility: 0, producer: "Goblin", producerIsToken: true },
    { tag: "creates:goblin", text: "", consumer: "Goblin", consumerIsToken: true, producer: "Maker", producerAbility: 0, magnitude: { floor: 2, ceiling: 2 } },
  ];
  const deck = (tremors = ability("1", ["enters"])) => [
    card("Tremors", 2, [tremors]), card("Bear", 3), maker, card("Upkeeper", 5, [ability("3", ["upkeep"])]),
  ];
  const all = (d: DeckCard[]) => ({ commanderNames: d.map((dc) => dc.card.name) });

  test("counts each source of the trigger: 1 for the Bear, 2 tokens a turn, 3 on upkeep; 40 by turn 12", () => {
    const d = deck();
    const clock = drainClock(d, reasons, all(d))!;
    expect(clock.perTurn.slice(0, 7)).toEqual([0, 0, 1, 2, 5, 5, 5]);
    expect(clock.turn).toBe(12);
    expect(clock.cards).toEqual(["Tremors", "Upkeeper"]);
    expect(clock.unbounded).toEqual([]);
  });

  test("a batched trigger fires at most once a turn, however many sources", () => {
    const d = deck(ability("1", ["enters"], { batched: true }));
    expect(drainClock(d, reasons, all(d))!.perTurn.slice(0, 5)).toEqual([0, 0, 1, 1, 4]);
  });

  test("a source that grows with the board counts as one, and is named", () => {
    const d = deck();
    const open = reasons.map((r) => r.tag.startsWith("creates:") ? { ...r, magnitude: { floor: 0, ceiling: null, scalesWith: "goblin" } } : r);
    const clock = drainClock(d, open, all(d))!;
    expect(clock.perTurn[3]).toBe(1);
    expect(clock.unbounded).toEqual(["Maker"]);
  });

  test("the route assumes its drain is out from the turn it can be cast, as the combo route assumes its pieces", () => {
    // Tremors and the Upkeeper are in the 99 now, among 90 lands: drawn by turn 3 one game in ten.
    const d = [...deck(), ...Array.from({ length: 90 }, (_, i) => mk(`Land ${i}`, { mv: 0, typeLine: "Basic Land — Mountain" }))];
    const clock = drainClock(d, reasons, { commanderNames: ["Bear", "Maker"] })!;
    expect(clock.perTurn.slice(0, 5)).toEqual([0, 0, 1, 2, 5]);
  });

  test("ability indexes are per FACE: a back-face drain joins the reasons stamped with its face", () => {
    const front = { kind: "static", face: 0, effect: { kind: "pump" } };
    const back = { ...ability("1", ["enters"]), face: 1 };
    const d = [card("Front // Tremors", 2, [front, back]), card("Bear", 3)];
    // The back face's drain is ability 0 OF FACE 1; a face-0 reason at index 0 is the static, not it.
    const r: Reason[] = [
      { tag: "enters:creature", text: "", consumer: "Front // Tremors", consumerFace: 1, consumerAbility: 0, producer: "Bear" },
      { tag: "enters:creature", text: "", consumer: "Front // Tremors", consumerAbility: 0, producer: "Bear" },
    ];
    expect(drainClock(d, r, all(d))!.perTurn.slice(0, 4)).toEqual([0, 0, 1, 0]);
  });

  test("one source said in several reasons (a trigger with a chain of effects) is still one source", () => {
    const d = deck();
    const twice = [...reasons, { ...reasons[0]!, effectKind: "other" }, { ...reasons[2]!, effectKind: "other" }];
    expect(drainClock(d, twice, all(d))!.perTurn.slice(0, 5)).toEqual([0, 0, 1, 2, 5]);
  });

  test("no repeating drain at each opponent, no route", () => {
    const d = [card("Bear", 3)];
    expect(drainClock(d, [], all(d))).toBeUndefined();
  });
});
