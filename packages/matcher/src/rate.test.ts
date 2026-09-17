import { expect, test } from "vitest";
import type { CardTags } from "@edh-seer/tagger";
import { bestRates, compareRates, manaOf, ratesOf, spanOf, type Rate, type RateSpan } from "./rate.js";
import type { DeckCard } from "./types.js";

/** A card with one derived ability and a printed cost. Verified oracle texts from the corpus
 *  (2026-09-17): Divination "Draw two cards." {2}{U}; Rhystic Study "Whenever an opponent casts a
 *  spell, you may draw a card unless that player pays {1}." {2}{U}; Blue Sun's Zenith "Target
 *  player draws X cards." {X}{U}{U}{U}. */
const card = (name: string, manaCost: string, abilities: unknown[], over: { types?: string[]; keywords?: string[]; text?: string } = {}): DeckCard => ({
  card: { name, typeLine: "", oracleText: over.text ?? "", keywords: over.keywords ?? [], colors: [], manaValue: manaOf(manaCost) ?? 0, manaCost } as unknown as DeckCard["card"],
  tags: {
    oracleId: name, schemaVersion: 1, promptVersion: 1, model: "t",
    characteristics: { types: over.types ?? ["sorcery"], subtypes: [], colors: [], identity: [], cmc: 0, power: null, toughness: null, token: false, keywords: [] },
    abilities: abilities as CardTags["abilities"],
  } as CardTags,
});

test("manaOf reads generic, pips and hybrids, skips tap and energy, refuses X", () => {
  expect(manaOf("{2}{U}")).toBe(3);
  expect(manaOf("{4}, {T}")).toBe(4);
  expect(manaOf("{T}")).toBe(0);
  expect(manaOf("{B/R}{2/W}{C/G}")).toBe(3);
  expect(manaOf("{X}{U}{U}{U}")).toBeNull();
  expect(manaOf(undefined)).toBeNull();
});

/** A FIXED ONE-SHOT IS A POINT: floor and ceiling are the amount, for the card's own mana. */
test("Divination: two cards for three mana, floor and ceiling alike", () => {
  const [r, ...rest] = ratesOf(card("Divination", "{2}{U}", [
    { kind: "on-cast", effect: { kind: "draw-card", subject: { control: "you", token: null } }, amount: "2", repeats: "once" },
  ]));
  expect(rest).toEqual([]);
  expect(r).toEqual({ family: "cards", kind: "on-cast", amount: 2, mana: 3, repeats: "once", floor: 2, ceiling: 2 });
});

/** A TRIGGER HAS A FLOOR OF 0 AND AN OPEN CEILING (owner 2026-09-17: "Rhystic Study can draw you 0
 *  cards at worst, but it is still 'opponents' spells cost 1 more'"): the payment that stops it is
 *  the fallback, carried verbatim, never priced. */
test("Rhystic Study: one card per trigger, floor 0, open ceiling, the {1} tax as fallback", () => {
  const [r] = ratesOf(card("Rhystic Study", "{2}{U}", [
    { kind: "triggered", trigger: { verbs: ["cast"], subject: { type: "spell", control: "opp", token: null } },
      effect: { kind: "draw-card", subject: { control: "you", token: null } }, amount: "1", repeats: "repeatable",
      unless: { cost: "{1}", payer: "opponent" } },
  ]));
  expect(r).toEqual({ family: "cards", kind: "triggered", amount: 1, mana: 3, repeats: "repeatable", floor: 0, ceiling: null, fallback: { cost: "{1}", payer: "opponent" } });
});

/** AN X SPELL IS A SLOPE: the fixed part of the cost is the mana, and each further mana is one
 *  card. That is the honest answer where a mana value was not (the `{X}` deadline defect). */
test("Blue Sun's Zenith: a slope of one card per mana after three", () => {
  const [r] = ratesOf(card("Blue Sun's Zenith", "{X}{U}{U}{U}", [
    { kind: "on-cast", effect: { kind: "draw-card", scaling: "x-cost", subject: { control: "you", token: null } }, amount: "X", repeats: "once" },
  ]));
  expect(r).toEqual({ family: "cards", kind: "on-cast", amount: 0, mana: 3, slope: 1, repeats: "once", floor: 0, ceiling: null });
});

/** AN ACTIVATION IS PRICED ON ITS OWN COST AND THE CARD'S (owner 2026-09-17: "you are not
 *  accounting for actually casting the card to then use its ability"): the first card costs the
 *  cast plus the activation, every later one the activation alone. A land casts for nothing. */
test("an activated draw carries the cast: the first card is eight mana, each later one four", () => {
  const tome = { kind: "activated", cost: "{4}, {T}", effect: { kind: "draw-card", subject: { control: "you", token: null } }, amount: "1", repeats: "repeatable" };
  const [r] = ratesOf(card("Jayemdae Tome", "{4}", [tome]));
  expect(r).toEqual({ family: "cards", kind: "activated", amount: 1, mana: 4, cast: 4, repeats: "repeatable", floor: 1, ceiling: 1 });
  expect(spanOf(r!)).toEqual([1, 8, 1, 4]);
  expect(spanOf({ ...r!, repeats: "once" })).toEqual([1, 8, 1, 8]);
  const land = card("Mikokoro-ish", "", [tome], { types: ["land"] }); delete (land.card as { manaCost?: string }).manaCost;
  expect(ratesOf(land)[0]).toMatchObject({ mana: 4, cast: 0 });
  const suspendOnly = card("Sol Talisman-ish", "", [tome], { types: ["artifact"] }); delete (suspendOnly.card as { manaCost?: string }).manaCost;
  expect(ratesOf(suspendOnly)).toEqual([]);
  expect(ratesOf(card("Sol Talisman-ish", "", [tome], { types: ["artifact"] }))).toEqual([]); // Scryfall's "" for no cost
  expect(ratesOf(card("X Creature", "{X}{U}", [tome], { types: ["creature"] }))).toEqual([]);
});

/** A DRAW IS NET OF WHAT THE SAME CLAUSE TAKES BACK (owner 2026-09-17: "brainstorm makes you
 *  draw 3 cards, but then you have to put 2 cards back"). Brainstorm: draw 3, `top-set` 2 from
 *  the hand, +1. Faithless Looting: draw 2, discard 2, 0 -- selection, not advantage. Merfolk
 *  Looter's "discard a card" states no amount, so its draw is refused, not left gross. Damage is
 *  never netted, and a discard on another cost is not this ability's. Derived shapes verified
 *  in the corpus 2026-09-17. */
test("Brainstorm nets to one card, a loot to zero, an unamounted discard refuses the draw", () => {
  const draw = (n: string, kind = "on-cast", cost?: string) => ({ kind, ...(cost ? { cost } : {}), effect: { kind: "draw-card", subject: { control: "you", token: null } }, amount: n, repeats: kind === "on-cast" ? "once" : "per-cycle" });
  const [b] = ratesOf(card("Brainstorm", "{U}", [draw("3"),
    { kind: "on-cast", effect: { kind: "top-set", subject: { control: "you", token: null, fromZone: "hand" } }, amount: "2", repeats: "once" }]));
  expect(b).toEqual({ family: "cards", kind: "on-cast", amount: 1, back: 2, mana: 1, repeats: "once", floor: 1, ceiling: 1 });
  const [l] = ratesOf(card("Faithless Looting", "{R}", [draw("2"),
    { kind: "on-cast", effect: { kind: "" }, amount: "2", emits: [{ verb: "discard", subject: { control: "you", token: null } }], repeats: "once" }]));
  expect(l).toMatchObject({ amount: 0, back: 2, floor: 0, ceiling: 0 });
  expect(ratesOf(card("Merfolk Looter", "{1}{U}", [draw("1", "activated", "{T}"),
    { kind: "activated", cost: "{T}", effect: { kind: "" }, emits: [{ verb: "discard", subject: { control: "you", token: null } }], repeats: "per-cycle" }], { types: ["creature"] }))).toEqual([]);
  expect(ratesOf(card("Two Abilities", "{1}{U}", [draw("1", "activated", "{T}"),
    { kind: "activated", cost: "{2}", effect: { kind: "" }, emits: [{ verb: "discard", subject: { control: "you", token: null } }], repeats: "repeatable" }]))[0]).toMatchObject({ amount: 1 });
});

test("damage is its own family, and a bolt is three for one", () => {
  const [r] = ratesOf(card("Lightning Bolt", "{R}", [
    { kind: "on-cast", effect: { kind: "damage", subject: { control: "any", token: null } }, amount: "3", repeats: "once" },
  ]));
  expect(r).toEqual({ family: "damage", kind: "on-cast", amount: 3, mana: 1, repeats: "once", floor: 3, ceiling: 3 });
});

/** REFUSALS, each a distinct reason: cards drawn by someone else are not your rate; an amount the
 *  card states as a count of something is not a number; a payment YOU make to keep the effect is a
 *  cost, not a rate; damage to your own side is a cost too; a family the axis does not cover has
 *  no row. */
test("what refuses a rate: another player's draw, a counted amount, your own upkeep payment, an uncovered family", () => {
  expect(ratesOf(card("Howling Mine", "{2}", [
    { kind: "triggered", effect: { kind: "draw-card", subject: { control: "any", token: null } }, amount: "1", repeats: "per-cycle" },
  ]))).toEqual([]);
  expect(ratesOf(card("Blue Sun's Cousin", "{2}{U}", [
    { kind: "on-cast", effect: { kind: "draw-card", scaling: "per-creature", subject: { control: "you", token: null } }, amount: "X", repeats: "once" },
  ]))).toEqual([]);
  expect(ratesOf(card("Phantasmal Forces", "{3}{U}", [
    { kind: "triggered", effect: { kind: "draw-card", subject: { control: "you", token: null } }, amount: "1", repeats: "per-cycle", unless: { cost: "{U}", payer: "you" } },
  ]))).toEqual([]);
  expect(ratesOf(card("Self-Immolation", "{R}", [
    { kind: "on-cast", effect: { kind: "damage", subject: { control: "you", token: null } }, amount: "4", repeats: "once" },
  ]))).toEqual([]);
  expect(ratesOf(card("Llanowar Elves", "{G}", [
    { kind: "activated", cost: "{T}", effect: { kind: "mana-generation" }, repeats: "repeatable" },
  ]))).toEqual([]);
});

/** SUMMONING SICKNESS (CR 302.6; owner 2026-09-17: "account for summoning sickness on the
 *  creatures"). A creature's tap ability and its own attack trigger wait a turn; haste, a
 *  noncreature, and a cast-trigger do not. The rate is unchanged -- the first yield is later. */
test("a creature's tap ability and attack trigger are delayed; haste, an artifact and a cast trigger are not", () => {
  const tapDraw = [{ kind: "activated", cost: "{T}", effect: { kind: "draw-card", subject: { control: "you", token: null } }, amount: "1", repeats: "repeatable" }];
  expect(ratesOf(card("Merfolk Looter-ish", "{1}{U}", tapDraw, { types: ["creature"] }))[0]?.delayed).toBe(true);
  expect(ratesOf(card("Hasty Looter", "{1}{U}", tapDraw, { types: ["creature"], keywords: ["Haste"] }))[0]?.delayed).toBeUndefined();
  expect(ratesOf(card("Jayemdae Tome", "{4}", tapDraw, { types: ["artifact"] }))[0]?.delayed).toBeUndefined();
  const attackDraw = [{ kind: "triggered", trigger: { verbs: ["attacks"], subject: { self: true, control: "you", token: null } }, effect: { kind: "draw-card", subject: { control: "you", token: null } }, amount: "1", repeats: "per-turn" }];
  expect(ratesOf(card("Attacking Drawer", "{2}{U}", attackDraw, { types: ["creature"] }))[0]?.delayed).toBe(true);
  const castDraw = [{ kind: "triggered", trigger: { verbs: ["cast"], subject: { type: "spell", control: "you", token: null } }, effect: { kind: "draw-card", subject: { control: "you", token: null } }, amount: "1", repeats: "repeatable" }];
  expect(ratesOf(card("Cast Drawer", "{2}{U}", castDraw, { types: ["creature"] }))[0]?.delayed).toBeUndefined();
});

/** A CONDITION THE ABILITY CANNOT SHOW PUTS THE FLOOR AT 0 (Fiery Gambit's nine cards are behind
 *  coin flips; the derived ability says "draw 9" and nothing else). The amount stays the ceiling. */
test("an amount behind a condition on the card's text has a floor of 0 and keeps its ceiling", () => {
  const draw9 = [{ kind: "on-cast", effect: { kind: "draw-card", subject: { control: "you", token: null } }, amount: "9", repeats: "once" }];
  const gambit = ratesOf(card("Fiery Gambit", "{2}{R}", draw9, { text: "Flip a coin until you lose a flip or choose to stop flipping. If you win three or more flips, draw nine cards." }))[0];
  expect(gambit).toMatchObject({ floor: 0, ceiling: 9, conditional: true });
  const plain = ratesOf(card("Divination", "{2}{U}", [{ kind: "on-cast", effect: { kind: "draw-card", subject: { control: "you", token: null } }, amount: "2", repeats: "once" }], { text: "Draw two cards." }))[0];
  expect(plain).toMatchObject({ floor: 2, ceiling: 2 });
  expect(plain).not.toHaveProperty("conditional");
  // A GRANT BEHIND A STATE: Learned Learner has "{T}: Draw a card" only while your hand size is not
  // seven (corpus, 2026-09-17); the derived activation says nothing of the state.
  const learner = ratesOf(card("Learned Learner", "{U}", [{ kind: "activated", cost: "{T}", effect: { kind: "draw-card", subject: { control: "you", token: null } }, amount: "1", repeats: "per-cycle" }],
    { types: ["creature"], text: "As long as you have a maximum hand size other than 7, this creature has \"{T}: Draw a card.\"" }))[0];
  expect(learner).toMatchObject({ floor: 0, ceiling: 1, conditional: true });
  // Kazandu Tuskcaller's "{T}: Create two 1/1 Elephant tokens" sits at LEVEL 2-5 (corpus, 2026-09-17).
  const tuskcaller = ratesOf(card("Kazandu Tuskcaller", "{1}{G}", [{ kind: "activated", cost: "{T}", effect: { kind: "token-generation", subject: { control: "you", token: true } }, amount: "2", repeats: "per-cycle" }],
    { types: ["creature"], text: "Level up {1}\nLEVEL 2-5\n1/1\n{T}: Create two 1/1 green Elephant creature tokens." }))[0];
  expect(tuskcaller).toMatchObject({ floor: 0, ceiling: 2, conditional: true, delayed: true });
});

/** AN ACTIVATION THAT CHARGES MORE THAN MANA says so: "{R}, Sacrifice this creature: 6 damage" is
 *  not six for one. The rate stands, the flag lets a per-mana sort leave it out. */
test("an activation cost with words in it is flagged as more than mana", () => {
  const sac = [{ kind: "activated", cost: "{R}, Sacrifice this creature", effect: { kind: "damage", subject: { control: "any", token: null } }, amount: "6", repeats: "once" }];
  expect(ratesOf(card("Bloodfire Colossus", "{6}{R}{R}", sac, { types: ["creature"] }))[0]).toMatchObject({ mana: 1, floor: 6, extraCost: true });
  const tap = [{ kind: "activated", cost: "{4}, {T}", effect: { kind: "draw-card", subject: { control: "you", token: null } }, amount: "1", repeats: "repeatable" }];
  expect(ratesOf(card("Jayemdae Tome", "{4}", tap))[0]).not.toHaveProperty("extraCost");
});

/** THE ORDER A SEARCH ROW SORTS BY: floor per mana, then ceiling per mana with open above bounded,
 *  then the cheaper ability. */
test("compareRates: free first, then floor per mana, open ceiling breaks above a bounded one, cheaper last", () => {
  const rows: RateSpan[] = [
    [0, 3, 9, 3],      // Fiery Gambit: conditional, ceiling 9
    [2, 3, 2, 3],      // Divination
    [1, 1, 1, 1],      // Brainstorm, net
    [0, 3, null, 3],   // Rhystic Study: a trigger
    [1, 0, 1, 0],      // Mana Crypt: free
    [1, 8, 1, 4],      // Jayemdae Tome: cast and activation, then activation
    [1, 2, 1, 2],      // one for two
  ];
  expect([...rows].sort(compareRates)).toEqual([[1, 0, 1, 0], [1, 1, 1, 1], [2, 3, 2, 3], [1, 2, 1, 2], [1, 8, 1, 4], [0, 3, null, 3], [0, 3, 9, 3]]);
  expect(compareRates([3, 0, 3, 0], [1, 0, 1, 0])).toBeLessThan(0);
  expect(compareRates([0, 0, null, 0], [0, 0, null, 0])).toBe(0);
});

test("bestRates keeps the best per family and leaves an extraCost activation out", () => {
  const rate = (over: Partial<Rate>): Rate => ({ family: "cards", kind: "activated", amount: 1, mana: 1, cast: 2, repeats: "repeatable", floor: 1, ceiling: 1, ...over });
  expect(bestRates([
    rate({ floor: 1, ceiling: 1, mana: 2 }),
    rate({ floor: 1, ceiling: 1, mana: 1 }),
    rate({ family: "damage", floor: 6, ceiling: 6, mana: 1, extraCost: true }),
    rate({ family: "damage", kind: "triggered", floor: 0, ceiling: null, mana: 4, cast: undefined }),
  ])).toEqual({ cards: [1, 3, 1, 1], damage: [0, 4, null, 4] });
  expect(bestRates([])).toEqual({});
});

/** A LOYALTY COST IS NOT MANA (CR 606.5). Teferi, Temporal Pilgrim "0: Draw a card." (corpus,
 *  2026-09-17) read as one card for nothing on the first chip sort. */
test("a loyalty or empty cost has no mana to read and is refused", () => {
  const draw = (cost: string) => ({ kind: "activated", cost, effect: { kind: "draw-card", subject: { control: "you", token: null } }, amount: "1", repeats: "per-turn" });
  expect(ratesOf(card("Teferi, Temporal Pilgrim", "{3}{U}{U}", [draw("0"), draw("+1"), draw("−3"), draw("")], { types: ["planeswalker"] }))).toEqual([]);
  expect(ratesOf(card("Obsessive Stitcher", "{1}{U}{B}", [draw("{T}")], { types: ["creature"] }))).toMatchObject([{ mana: 0, cast: 3, floor: 1, delayed: true }]);
});

/** MANA PER MANA, the comparison the axis was named for (owner 2026-09-04: Arcane Signet {2} and
 *  Commander's Sphere {3} print the same ability; Sol Ring is {1} for {C}{C}). DERIVE 160 puts the
 *  mana added on the amount. A land's mana is its land drop and is refused; Mana Crypt's is free. */
test("mana is a family: Sol Ring two for one then two for nothing, Signet above Sphere, a land refused", () => {
  const rock = (name: string, manaCost: string, amount: string, types: string[] = ["artifact"]) =>
    ratesOf(card(name, manaCost, [{ kind: "activated", cost: "{T}", effect: { kind: "mana-generation", subject: { control: "you", token: null } }, amount, repeats: "per-cycle" }], { types }))[0];
  const sol = rock("Sol Ring", "{1}", "2");
  expect(sol).toEqual({ family: "mana", kind: "activated", amount: 2, mana: 0, cast: 1, repeats: "per-cycle", floor: 2, ceiling: 2 });
  expect(spanOf(sol!)).toEqual([2, 1, 2, 0]);
  const signet = spanOf(rock("Arcane Signet", "{2}", "1")!), sphere = spanOf(rock("Commander's Sphere", "{3}", "1")!);
  expect([sphere, signet, spanOf(sol!)].sort(compareRates)).toEqual([[2, 1, 2, 0], [1, 2, 1, 0], [1, 3, 1, 0]]);
  expect(spanOf(rock("Mana Crypt", "{0}", "2")!)).toEqual([2, 0, 2, 0]);
  expect(rock("Forest", "", "1", ["land"])).toBeUndefined();
  expect(ratesOf(card("Cabal Coffers-ish", "", [{ kind: "activated", cost: "{2}, {T}", effect: { kind: "mana-generation", subject: { control: "you", token: null }, scaling: "per-swamp" }, amount: "X", repeats: "per-cycle" }], { types: ["land"] }))).toEqual([]);
});

/** FIVE MORE FAMILIES (owner 2026-09-17: "what about the rest of effects"). Derived shapes verified
 *  in the corpus 2026-09-17: Lightning Helix's lifegain is `you` amount 3; Swords to Plowshares'
 *  goes to `opp`; Zulaport Cutthroat's loss is `opp` scope each amount 1; Glimpse the Unthinkable
 *  mills `any` 10; Raise the Alarm creates 2 for `you`; a counter lands on `any`. */
test("life, life-loss, mill, tokens and counters are families; whose yield decides the refusal", () => {
  const one = (kind: string, control: string | undefined, amount = "1", abilityKind = "on-cast") =>
    ratesOf(card("T", "{1}{W}", [{ kind: abilityKind, effect: { kind, subject: { control, token: null } }, amount, repeats: "once" }]))[0];
  expect(one("lifegain", "you", "3")).toMatchObject({ family: "life", amount: 3, mana: 2, floor: 3, ceiling: 3 });
  expect(one("lifegain", "opp", "3")).toBeUndefined();
  expect(one("player-life-loss", "opp")).toMatchObject({ family: "life-loss", amount: 1 });
  expect(one("player-life-loss", "any")).toMatchObject({ family: "life-loss" });
  expect(one("player-life-loss", "you")).toBeUndefined();
  expect(one("mill", "any", "10")).toMatchObject({ family: "mill", amount: 10 });
  expect(one("mill", "you", "3")).toMatchObject({ family: "mill", amount: 3 });
  expect(one("token-generation", "you", "2")).toMatchObject({ family: "tokens", amount: 2 });
  expect(one("token-generation", "opp", "2")).toBeUndefined();
  expect(one("counter-placement", "any")).toMatchObject({ family: "counters", amount: 1 });
  expect(one("counter-placement", "any", "")).toBeUndefined(); // "put a +1/+1 counter" states no amount
  expect(one("drain", "opp")).toBeUndefined();
  // A land's free activation is its land drop: Fountain of Cho "{T}: Put a storage counter on this
  // land" is refused; Castle Locthwain's "{1}{B}{B}, {T}: Draw a card" is priced on its own mana.
  const landAbility = (cost: string, kind: string) => { const c = card("L", "", [{ kind: "activated", cost, effect: { kind, subject: { control: "any", token: null } }, amount: "1", repeats: "per-cycle" }], { types: ["land"] }); delete (c.card as { manaCost?: string }).manaCost; return ratesOf(c)[0]; };
  expect(landAbility("{T}", "counter-placement")).toBeUndefined();
  expect(landAbility("{1}{B}{B}, {T}", "counter-placement")).toMatchObject({ mana: 3, cast: 0 });
});

/** EQUIPPING IS A COST, AND THE CREATURE THAT TAPS CAN BE SICK (owner 2026-09-17: "for stuff like
 *  Paradise Mantle you forgot that equipping the equipment is also a cost, plus ... summoning
 *  sickness"). Paradise Mantle {0}, "Equipped creature has '{T}: Add one mana of any color.' Equip
 *  {1}" (corpus). The first mana costs the equip; later ones nothing; every one waits for an
 *  unsick creature. Two Equip lines take the cheapest; an Equip line with no mana refuses. */
test("an Equipment's tap ability pays the equip first and is delayed; the sort breaks a tie on the delay", () => {
  const tap = [{ kind: "activated", cost: "{T}", effect: { kind: "mana-generation", subject: { control: "any", token: null } }, amount: "1", repeats: "per-cycle" }];
  const withType = (text: string, typeLine: string) => { const c = card("E", "{0}", tap, { types: ["artifact"], text }); (c.card as { typeLine: string }).typeLine = typeLine; return ratesOf(c)[0]; };
  const m = withType("Equipped creature has \"{T}: Add one mana of any color.\"\nEquip {1}", "Artifact — Equipment");
  expect(m).toMatchObject({ equip: 1, delayed: true });
  expect(spanOf(m!)).toEqual([1, 1, 1, 0, 1]);
  expect(withType("Equipped creature has \"{T}: Add {G}.\"\nEquip {3}\nEquip legendary creature {1}", "Artifact — Equipment")).toMatchObject({ equip: 1 });
  expect(withType("Equipped creature has \"{T}: Add {G}.\"\nEquip—Pay 2 life.", "Artifact — Equipment")).toBeUndefined();
  // Skullclamp's trigger watches the equipped creature: the equip is paid before it can fire.
  const clamp = card("Skullclamp", "{1}", [{ kind: "triggered", trigger: { verbs: ["dies"], subject: { control: "you", token: null, type: "creature" } }, effect: { kind: "draw-card", subject: { control: "you", token: null } }, amount: "2", repeats: "repeatable" }], { types: ["artifact"], text: "Equipped creature gets +1/-1.\nWhenever equipped creature dies, draw two cards.\nEquip {1}" });
  (clamp.card as { typeLine: string }).typeLine = "Artifact — Equipment";
  expect(spanOf(ratesOf(clamp)[0]!)).toEqual([0, 2, null, 1]);
  const aura = withType("Enchant creature\nEnchanted creature has \"{T}: Add {G}.\"", "Enchantment — Aura");
  expect(aura).toMatchObject({ delayed: true });
  expect(aura).not.toHaveProperty("equip");
  // Llanowar Elves waits a turn; a rock at the same rate does not, and lists first.
  expect(compareRates([1, 1, 1, 0], [1, 1, 1, 0, 1])).toBeLessThan(0);
  expect(compareRates([2, 1, 2, 0, 1], [1, 1, 1, 0])).toBeLessThan(0); // but a better rate still wins
});
