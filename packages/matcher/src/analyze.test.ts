import { describe, expect, it, test } from "vitest";
import { analyzeDeckStructured, collectTokenNodes } from "./analyze.js";
import { faceDeckCards } from "./faces.js";
import { SEED_IMPACT_WEIGHTS, loadImpactWeights } from "@edh-seer/engine";
import type { TagStats } from "@edh-seer/engine";
import type { CardTags } from "@edh-seer/tagger";
import type { DeckCard, Hierarchy } from "./types.js";
import { directedReasons } from "./edges.js";

const H: Hierarchy = { wizard: ["creature"] };

const dc = (
  name: string,
  abilities: CardTags["abilities"],
  subtypes: string[] = [],
  typeLine = "Creature",
): DeckCard => ({
  card: { name, typeLine, oracleText: "", keywords: [], colors: [], manaValue: 0 } as never,
  tags: {
    oracleId: name, schemaVersion: 1, promptVersion: 1, model: "t",
    characteristics: { types: [typeLine.toLowerCase()], subtypes, colors: [], identity: [], cmc: 0, power: null, toughness: null, token: false, keywords: [] },
    abilities,
  },
});

const dcWithPT = (name: string, power: number, toughness: number): DeckCard => ({
  card: { name, typeLine: "Creature", oracleText: "", keywords: [], colors: [], manaValue: 0 } as never,
  tags: {
    oracleId: name, schemaVersion: 1, promptVersion: 1, model: "t",
    characteristics: { types: ["creature"], subtypes: [], colors: [], identity: [], cmc: 0, power: String(power), toughness: String(toughness), token: false, keywords: [] },
    abilities: [],
  },
});

const inallaAbility: CardTags["abilities"] = [{
  kind: "triggered",
  trigger: { verbs: ["enters"], subject: { subtype: "wizard", control: "you", token: false } },
  effect: { kind: "token-generation", subject: { subtype: "wizard", control: "you", token: true } },
  emits: [{ verb: "enters", subject: { subtype: "wizard", control: "you", token: true } }],
}];

const kindredDiscoveryAbility: CardTags["abilities"] = [{
  kind: "triggered",
  trigger: { verbs: ["enters"], subject: { type: "creature", control: "you", token: null } },
  effect: { kind: "draw-card" },
}];

// Fixtures for the axis-discrimination test below.
//
// The commander's trigger seeds the axis with tag "enters:wizard" but requires control:"opp",
// which nothing in this deck ever emits (all authored emits below are control:"you") — so it
// never forms a real edge to the commander itself. This also means the commander must NOT be a
// permanent type: every permanent implicitly "enters the battlefield" as its own producer event
// (see implied.ts impliedEvents), and that implied event is always control:"you" regardless of
// the card's own trigger — so a permanent commander with subtype "wizard" would silently pick up
// edges with Wizard Maker/Wizard Payoff via its own self-ETB, contaminating the comparison with
// COMMANDER_BOOST (x3, applied only to edges touching the commander). Making the commander an
// instant sidesteps this: impliedEvents only gives non-permanents a "cast" event, never "enters".
const commanderAxisAbility: CardTags["abilities"] = [{
  kind: "triggered",
  trigger: { verbs: ["enters"], subject: { subtype: "wizard", control: "opp", token: null } },
  effect: { kind: "draw-card" },
}];

// On-axis payoff: matches Wizard Maker's wizard-token emit (subtype "wizard", same as the
// commander's axis tag) directly on subtype, no hierarchy widening needed.
const wizardPayoffAbility: CardTags["abilities"] = [{
  kind: "triggered",
  trigger: { verbs: ["enters"], subject: { subtype: "wizard", control: "you", token: null } },
  effect: { kind: "draw-card" },
}];

// Off-axis maker/payoff pair: structurally identical to the wizard pair (same effect kinds ->
// identical impactEdgeWeight) but on "attacks"/"goblin" instead of "enters"/"wizard", so its
// edge's reason tag ("attacks:goblin") is off the commander's axis. "attacks" is never an
// implied event (implied.ts only implies "cast"/"enters"), so this pair can't pick up stray
// edges from anyone's own self-ETB the way an "enters"-based off-axis pair could.
const goblinMakerAbility: CardTags["abilities"] = [{
  kind: "triggered",
  trigger: { verbs: ["attacks"], subject: { subtype: "goblin", control: "you", token: false } },
  effect: { kind: "token-generation", subject: { subtype: "goblin", control: "you", token: true } },
  emits: [{ verb: "attacks", subject: { subtype: "goblin", control: "you", token: true } }],
}];

const goblinPayoffAbility: CardTags["abilities"] = [{
  kind: "triggered",
  trigger: { verbs: ["attacks"], subject: { subtype: "goblin", control: "you", token: null } },
  effect: { kind: "draw-card" },
}];

// Fixtures for the directional-scoring test below.
const impactTremorsAbility: CardTags["abilities"] = [{
  kind: "triggered",
  trigger: { verbs: ["enters"], subject: { type: "creature", control: "you", token: null } },
  effect: { kind: "damage", subject: { control: "opp", token: null } },
}];
// PURE producer: triggers on ATTACKS (not creature-ETB), so it feeds the payoff but does NOT itself
// consume the creature-ETB resource — otherwise makers become mutual payoffs and inflate past the
// anchor. It emits creature-enters (that's what feeds Impact Tremors).
const tokenMakerAbility: CardTags["abilities"] = [{
  kind: "triggered",
  trigger: { verbs: ["attacks"], subject: { type: "creature", control: "you", token: null } },
  effect: { kind: "token-generation", subject: { type: "creature", control: "you", token: true } },
  emits: [{ verb: "enters", subject: { type: "creature", control: "you", token: true } }],
}];

test("produces a DeckReport with a synergy edge between a maker and its payoff", () => {
  const maker = dc("Inalla", inallaAbility, ["wizard"]);
  const payoff = dc("Kindred Discovery", kindredDiscoveryAbility);
  const report = analyzeDeckStructured([maker, payoff], undefined, H);
  expect(report.edges.length).toBeGreaterThan(0);
  expect(report.edges[0].reasons.some((r) => r.tag === "enters:creature")).toBe(true);
  expect(report.cards.map((c) => c.name).sort()).toEqual(["Inalla", "Kindred Discovery"]);
  expect(report.cards.every((c) => c.score >= 0)).toBe(true);
  // Both cards should show up as each other's top partner (only 2 cards in the deck).
  const inallaCard = report.cards.find((c) => c.name === "Inalla")!;
  const kindredCard = report.cards.find((c) => c.name === "Kindred Discovery")!;
  expect(inallaCard.topPartners.map((p) => p.name)).toEqual(["Kindred Discovery"]);
  expect(kindredCard.topPartners.map((p) => p.name)).toEqual(["Inalla"]);
  expect(report.cohesion).not.toBeNull();
});

test("report exposes per-theme surplus/payoff/baseline counts", () => {
  const maker = dc("Inalla", inallaAbility, ["wizard"]);
  const payoff = dc("Kindred Discovery", wizardPayoffAbility);
  const report = analyzeDeckStructured([maker, payoff], ["Inalla"], H);

  const tm = report.themeMembership!;
  expect(tm.length).toBeGreaterThan(0);
  for (const t of tm) {
    expect(t.tag.startsWith("static:"), "statics never head a theme").toBe(false);
    expect(typeof t.surplus).toBe("number");
    expect(typeof t.baseline).toBe("number");
    expect(typeof t.selective).toBe("boolean");
  }
  // A gutted themeMembership returning all-zero counts would still pass the shape assertions
  // above. Pin real values on the Inalla fixture: Inalla's authored token emit makes her a
  // surplus producer of enters:wizard, and the nontoken-wizard trigger filter keeps the tag
  // selective in this 2-card deck.
  const entersWizard = tm.find((t) => t.tag === "enters:wizard")!;
  expect(entersWizard).toBeDefined();
  expect(entersWizard.surplus).toBeGreaterThanOrEqual(1);
  expect(entersWizard.selective).toBe(true);
});

test("untagged cards contribute no edges but still appear in the report", () => {
  const tagged = dc("A", []);
  const untagged: DeckCard = { card: { name: "B", typeLine: "Land", oracleText: "", keywords: [], colors: [], manaValue: 0 } as never, tags: null };
  const report = analyzeDeckStructured([tagged, untagged], undefined, H);
  expect(report.edges).toEqual([]);
  expect(report.cards.map((c) => c.name).sort()).toEqual(["A", "B"]);
});

test("commander boost is applied to the commander's partners", () => {
  const cmd = dc("Cmd", inallaAbility, ["wizard"]);
  const payoff = dc("Payoff", kindredDiscoveryAbility);
  const withoutBoost = analyzeDeckStructured([cmd, payoff], undefined, H);
  const withBoost = analyzeDeckStructured([cmd, payoff], ["Cmd"], H);
  const payoffNoBoost = withoutBoost.cards.find((c) => c.name === "Payoff")!;
  const payoffBoosted = withBoost.cards.find((c) => c.name === "Payoff")!;
  expect(payoffBoosted.score).toBeGreaterThan(0);
  // The commander boost multiplies the payoff's contribution from Cmd, so its score
  // with the boost must exceed its score without it.
  expect(payoffBoosted.score).toBeGreaterThan(payoffNoBoost.score);
  expect(withBoost.commanders).toEqual(["Cmd"]);
  const cmdCard = withBoost.cards.find((c) => c.name === "Cmd")!;
  expect(cmdCard.isCommander).toBe(true);
});

test("self-pairs are excluded: a lone card never synergizes with itself", () => {
  // Death Baron-style static lord whose effect subject matches its OWN characteristics
  // (a zombie lord that is itself a zombie). If self-pairs weren't excluded, this single
  // card would produce an edge (and topPartners entry) referencing itself.
  const selfLord = dc("Lone Lord", [{
    kind: "static",
    effect: { kind: "pump", subject: { subtype: "wizard", control: "you", token: null } },
  }], ["wizard"]);
  const report = analyzeDeckStructured([selfLord], undefined, H);
  expect(report.edges).toEqual([]);
  const card = report.cards.find((c) => c.name === "Lone Lord")!;
  expect(card.partnerCount).toBe(0);
  expect(card.topPartners).toEqual([]);
  expect(card.score).toBe(0);
});

test("deck-aware chosen-type resolution lets a chosenType payoff match the deck's top subtype", () => {
  const maker = dc("Zombie Maker", [{
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { subtype: "zombie", control: "you", token: false } },
    effect: { kind: "token-generation", subject: { subtype: "zombie", control: "you", token: true } },
    emits: [{ verb: "enters", subject: { subtype: "zombie", control: "you", token: true } }],
  }], ["zombie"]);
  const chosenPayoff = dc("Chosen Payoff", [{
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { control: "you", token: null, chosenType: true } },
    effect: { kind: "draw-card" },
  }]);
  const fillerZombie1 = dc("Filler Zombie 1", [], ["zombie"]);
  const fillerZombie2 = dc("Filler Zombie 2", [], ["zombie"]);
  const zombieHierarchy: Hierarchy = { zombie: ["creature"] };
  const report = analyzeDeckStructured(
    [maker, chosenPayoff, fillerZombie1, fillerZombie2],
    undefined,
    zombieHierarchy,
  );
  const edge = report.edges.find(
    (e) => (e.a === "Zombie Maker" && e.b === "Chosen Payoff") || (e.a === "Chosen Payoff" && e.b === "Zombie Maker"),
  );
  expect(edge).toBeDefined();
});

test("high-impact repeatable payoff out-scores a broad low-impact one (2.1 mis-ranking inverted)", () => {
  // Three vanilla wizard creatures: each implies a self enters:wizard (⊂ enters:creature) event.
  const w1 = dc("W1", [], ["wizard"]);
  const w2 = dc("W2", [], ["wizard"]);
  const w3 = dc("W3", [], ["wizard"]);
  // Kindred: draw-card, triggered on enters:creature (matches every wizard).
  const kindred = dc("Kindred", [{
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { type: "creature", control: "you", token: null } },
    effect: { kind: "draw-card" },
  }]);
  // Tremors: damage, triggered on the SAME enters:creature event — same partners, lower-impact kind.
  const tremors = dc("Tremors", [{
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { type: "creature", control: "you", token: null } },
    effect: { kind: "damage" },
  }]);
  const report = analyzeDeckStructured([w1, w2, w3, kindred, tremors], undefined, H);
  const kScore = report.cards.find((c) => c.name === "Kindred")!.score;
  const tScore = report.cards.find((c) => c.name === "Tremors")!.score;
  expect(kScore).toBeGreaterThan(tScore);
  // Recomputed for the directional model (was: symmetric weighted/partnerCount ratio 2.5).
  // W1-3 are pure feeders (no abilities, so they never trigger back): each feeds BOTH Kindred
  // (draw-card) and Tremors (damage) one-way. Kindred and Tremors also feed EACH OTHER (each's
  // own implied "enters:creature" satisfies the other's trigger) — but directionally, not merged
  // into one shared max-tag reason like the old undirected edge: Kindred→Tremors carries only
  // Tremors' effectKind (damage), and Tremors→Kindred carries only Kindred's (draw-card).
  //   support(Kindred)   = 3×draw (from W1-3) + draw (from Tremors)   = 4×draw × axisFactor
  //   support(Tremors)   = 3×dmg  (from W1-3) + dmg  (from Kindred)   = 4×dmg  × axisFactor
  //   feederSum(Kindred) = FEEDER_SHARE × dmg  (Kindred feeds Tremors) × axisFactor
  //   feederSum(Tremors) = FEEDER_SHARE × draw (Tremors feeds Kindred) × axisFactor
  // score = √support + √feederSum. Every reason here shares one tag ("enters:creature" — the
  // consumer-side trigger subject is untyped/unsubtyped "creature" for both Kindred and Tremors),
  // so axisFactor is a single common multiplier k across every term: score = √k × (√4×draw|dmg +
  // √(FEEDER_SHARE×dmg|draw)). It cancels in the ratio, so (unlike an absolute value) the ratio
  // stays exact regardless of the corpus-derived axis weight — same reasoning the old test used to
  // stay damping-invariant. FEEDER_SHARE mirrors analyze.ts's tunable (0.25).
  const draw = SEED_IMPACT_WEIGHTS.kinds["draw-card"];
  const dmg = SEED_IMPACT_WEIGHTS.kinds["damage"];
  const FEEDER_SHARE = 0.25;
  const expectedK = Math.sqrt(4 * draw) + Math.sqrt(FEEDER_SHARE * dmg);
  const expectedT = Math.sqrt(4 * dmg) + Math.sqrt(FEEDER_SHARE * draw);
  expect(kScore / tScore).toBeCloseTo(expectedK / expectedT, 5);
});

test("a scaling payoff out-ranks an otherwise-identical fixed payoff", () => {
  // Two drain payoffs with identical partners (3 wizards); one scales per-creature, one fixed.
  const w1 = dc("W1", [], ["wizard"]);
  const w2 = dc("W2", [], ["wizard"]);
  const w3 = dc("W3", [], ["wizard"]);
  const mk = (name: string, scaling?: string): DeckCard => dc(name, [{
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { type: "creature", control: "you", token: null } },
    effect: scaling ? { kind: "drain", scaling } : { kind: "drain" },
  }]);
  const report = analyzeDeckStructured([w1, w2, w3, mk("Scaler", "per-creature"), mk("Flat")], undefined, H);
  const scaler = report.cards.find((c) => c.name === "Scaler")!.score;
  const flat = report.cards.find((c) => c.name === "Flat")!.score;
  expect(scaler).toBeGreaterThan(flat);
});

// Fixture for the magnitude-discount test below: one payoff triggering on enters:creature against
// twelve vanilla creature bodies, putting that tag's supply:demand ratio at ~12:1 on `avail` —
// comfortably past GLUT = 3.
function gluttedDeck(): DeckCard[] {
  const payoff = dc("Payoff", [{
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { type: "creature", control: "you", token: null } },
    effect: { kind: "draw-card" },
  }]);
  const bodies = Array.from({ length: 12 }, (_, i) => dc(`Body ${i + 1}`, []));
  return [payoff, ...bodies];
}

test("a glutted shape's feeder credit falls when the magnitude term is on, and is untouched at beta 0", () => {
  // Build a deck with one payoff and many identical feeders so `enters:creature` is heavily
  // supply-glutted, then read the feeder's own rating with the term off and on.
  const weightsOff = { ...SEED_IMPACT_WEIGHTS, magnitude: { glut: 3, beta: 0 } };
  const weightsOn = { ...SEED_IMPACT_WEIGHTS, magnitude: { glut: 3, beta: 0.5 } };
  // Signature is (inputs, commanderNames?, hierarchy, impactWeights, combos?, themeStats, tokenTags?)
  // — impactWeights is the FOURTH argument, verified at analyze.ts:125-138.
  const off = analyzeDeckStructured(gluttedDeck(), [], undefined, weightsOff);
  const on = analyzeDeckStructured(gluttedDeck(), [], undefined, weightsOn);
  const feederOff = off.cards.find((c) => c.name === "Body 1")!;
  const feederOn = on.cards.find((c) => c.name === "Body 1")!;
  expect(feederOn.score).toBeLessThan(feederOff.score);
  const payoffOff = off.cards.find((c) => c.name === "Payoff")!;
  const payoffOn = on.cards.find((c) => c.name === "Payoff")!;
  expect(payoffOn.score).toBe(payoffOff.score); // the scarce side's RAW score never moves
});

import { ComboIndex } from "@edh-seer/engine";

const rampAbility: CardTags["abilities"] = [{
  kind: "static",
  effect: { kind: "mana-generation", subject: { control: "you", token: null } },
}];

const drawAbility: CardTags["abilities"] = [{
  kind: "triggered",
  trigger: { verbs: ["enters"], subject: { control: "you", token: null } },
  effect: { kind: "draw-card" },
}];

const removalAbility: CardTags["abilities"] = [{
  kind: "on-cast",
  effect: { kind: "damage", subject: { control: "opp", token: null } },
}];

test("combos are found when a ComboIndex is provided and cards match", () => {
  const a = dc("A", []);
  const b = dc("B", []);
  const combos = new ComboIndex([{ cards: ["A", "B"], result: "Win the game." }]);
  const report = analyzeDeckStructured([a, b], undefined, H, undefined, combos);
  expect(report.combos).toEqual([{ cards: ["A", "B"], result: "Win the game." }]);
});

test("combos default to empty when no ComboIndex is provided", () => {
  const a = dc("A", []);
  const report = analyzeDeckStructured([a], undefined, H);
  expect(report.combos).toEqual([]);
});

test("combos are empty when the ComboIndex's cards aren't all present", () => {
  const a = dc("A", []);
  const combos = new ComboIndex([{ cards: ["A", "Missing Card"], result: "Win the game." }]);
  const report = analyzeDeckStructured([a], undefined, H, undefined, combos);
  expect(report.combos).toEqual([]);
});

test("roles counts distinct cards per structured effect-kind bucket", () => {
  const ramp = dc("Sol Ring", rampAbility, [], "Artifact");
  const draw = dc("Phyrexian Arena", drawAbility);
  const removal = dc("Lightning Bolt", removalAbility, [], "Instant");
  const vanilla = dc("Grizzly Bears", []);
  const report = analyzeDeckStructured([ramp, draw, removal, vanilla], undefined, H);
  expect(report.roles).toEqual({ ramp: 1, draw: 1, removal: 1 });
});

test("roles ignores damage/forced-sacrifice targeting your own side", () => {
  const ownDamage: CardTags["abilities"] = [{
    kind: "on-cast",
    effect: { kind: "damage", subject: { control: "you", token: null } },
  }];
  const card = dc("Self Damage", ownDamage);
  const report = analyzeDeckStructured([card], undefined, H);
  expect(report.roles).toEqual({ ramp: 0, draw: 0, removal: 0 });
});

test("power≤2 trigger edges with a small creature, NOT a big one", () => {
  const vamp = dc("Welcoming Vampire", [{
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { type: "creature", control: "you", token: null, stats: [{ metric: "power", op: "lte", value: 2 }] } },
    effect: { kind: "draw-card" }, emits: [{ verb: "draw", subject: { control: "you", token: null } }],
  }], [], "Creature");
  const small = dcWithPT("Small", 1, 1);
  const big = dcWithPT("Big", 5, 5);
  expect(analyzeDeckStructured([vamp, small]).edges.length).toBeGreaterThan(0);
  expect(analyzeDeckStructured([vamp, big]).edges).toEqual([]);
});

test("toughness-matters static edges with a wall, NOT a beater", () => {
  const doran = dc("Doran", [{ kind: "static", effect: { kind: "damage-multiplier", subject: { type: "creature", control: "you", token: null, stats: [{ metric: "toughness", op: "gte", vs: "power" }] } } }], [], "Creature");
  const wall = dcWithPT("Wall", 0, 6);
  const beater = dcWithPT("Beater", 5, 2);
  expect(analyzeDeckStructured([doran, wall]).edges.length).toBeGreaterThan(0);
  expect(analyzeDeckStructured([doran, beater]).edges).toEqual([]);
});

test("bucketScores reflect own-ability classification; unrelated buckets stay 0", () => {
  const drawer = dc("Drawer", drawAbility);
  const ramper = dc("Ramper", rampAbility);
  const report = analyzeDeckStructured([drawer, ramper], undefined, H);
  const drawerCard = report.cards.find((c) => c.name === "Drawer")!;
  const ramperCard = report.cards.find((c) => c.name === "Ramper")!;
  expect(drawerCard.bucketScores?.consistency).toBeGreaterThan(0);
  expect(drawerCard.bucketScores?.efficiency).toBe(0);
  expect(ramperCard.bucketScores?.efficiency).toBeGreaterThan(0);
  expect(ramperCard.bucketScores?.consistency).toBe(0);
});

test("a card with no qualifying abilities and no synergy has no bucketScores/bucketCount", () => {
  const vanilla = dc("Vanilla", []);
  const report = analyzeDeckStructured([vanilla], undefined, H);
  const card = report.cards.find((c) => c.name === "Vanilla")!;
  expect(card.bucketScores).toBeUndefined();
  expect(card.bucketCount).toBeUndefined();
});

test("combo-piece cards get a win-condition bonus even with no win-condition abilities of their own", () => {
  const a = dc("A", []);
  const b = dc("B", []);
  const combos = new ComboIndex([{ cards: ["A", "B"], result: "Win the game." }]);
  const report = analyzeDeckStructured([a, b], undefined, H, undefined, combos);
  const cardA = report.cards.find((c) => c.name === "A")!;
  expect(cardA.bucketScores?.["win-condition"]).toBeGreaterThan(0);
  expect(cardA.bucketCount).toBe(1);
});

test("versatility multiplier scales the 3 new bucket scores with qualifying-bucket count, never touching score", () => {
  const single = dc("Single", drawAbility);
  const versatile = dc("Versatile", [...drawAbility, ...rampAbility]);
  const singleReport = analyzeDeckStructured([single], undefined, H);
  const versatileReport = analyzeDeckStructured([versatile], undefined, H);
  const s = singleReport.cards.find((c) => c.name === "Single")!;
  const v = versatileReport.cards.find((c) => c.name === "Versatile")!;
  // Each card is alone in its own deck, so neither forms any synergy edge (see the existing
  // "self-pairs are excluded" test above) — score stays 0 for both, deterministically.
  expect(s.score).toBe(0);
  expect(v.score).toBe(0);
  expect(s.bucketCount).toBe(1); // consistency only
  expect(v.bucketCount).toBe(2); // consistency + efficiency
  // Identical drawAbility in both, so the raw consistency contribution is identical — the
  // ratio between their consistency scores must equal exactly the versatility-multiplier
  // ratio for bucketCount 2 (1 + 0.15*1 = 1.15) vs bucketCount 1 (1 + 0.15*0 = 1.0).
  expect(v.bucketScores!.consistency / s.bucketScores!.consistency).toBeCloseTo(1.15, 5);
});

test("deck stats: mana curve / land count / avg & median manaValue", () => {
  const land: DeckCard = {
    card: { name: "Forest", typeLine: "Basic Land — Forest", oracleText: "", keywords: [], colors: [], manaValue: 0 } as never,
    tags: null,
  };
  const two: DeckCard = {
    card: { name: "Two", typeLine: "Creature", oracleText: "", keywords: [], colors: [], manaValue: 2 } as never,
    tags: null,
  };
  const four: DeckCard = {
    card: { name: "Four", typeLine: "Creature", oracleText: "", keywords: [], colors: [], manaValue: 4 } as never,
    tags: null,
  };
  const report = analyzeDeckStructured([land, two, four], undefined, H);
  expect(report.landCount).toBe(1);
  expect(report.avgManaValue).toBe(3);
  expect(report.medianManaValue).toBe(3);
  expect(report.manaCurve[2].count).toBe(1);
  expect(report.manaCurve[4].count).toBe(1);
  expect(report.manaCurve.reduce((s, b) => s + b.count, 0)).toBe(2);
});

test("archetypes are attached to the report", () => {
  const maker = dc("Inalla", inallaAbility, ["wizard"]);
  const payoff = dc("Kindred Discovery", kindredDiscoveryAbility);
  const report = analyzeDeckStructured([maker, payoff], undefined, H);
  expect(report.archetypes).toBeDefined();
  expect(Array.isArray(report.archetypes)).toBe(true);
});

test("populates synergyRating (0-5) on every card and positiveCoherence on the deck", () => {
  const maker = dc("Inalla", inallaAbility, ["wizard"]);
  const payoff = dc("Kindred Discovery", kindredDiscoveryAbility);
  const land = dc("Island", [], [], "Land");
  const report = analyzeDeckStructured([maker, payoff, land], undefined, H);

  for (const c of report.cards) {
    expect(c.synergyRating).toBeGreaterThanOrEqual(0);
    expect(c.synergyRating).toBeLessThanOrEqual(5);
  }
  // The top synergy card reaches the deck-relative ceiling of 5.
  expect(Math.max(...report.cards.map((c) => c.synergyRating ?? -1))).toBe(5);
  // The land carries no synergy edges → rating 0.
  expect(report.cards.find((c) => c.name === "Island")?.synergyRating).toBe(0);
  expect(report.positiveCoherence).toBeGreaterThanOrEqual(0);
  expect(report.positiveCoherence).toBeLessThanOrEqual(5);
});

test("positiveCoherence reflects on-axis coverage (0-5)", () => {
  const commander = dc("Cmd", kindredDiscoveryAbility, ["wizard"]); // creature-ETB payoff anchors the axis
  const maker = dc("Wizard Maker", inallaAbility, ["wizard"]); // on-axis wizard-token maker
  const report = analyzeDeckStructured([commander, maker], ["Cmd"], H);
  expect(report.positiveCoherence).toBeGreaterThan(0);
  expect(report.positiveCoherence).toBeLessThanOrEqual(5);
});

test("an on-axis edge outscores an equal-strength off-axis edge (commander anchors the axis)", () => {
  // Two structurally-identical maker/payoff pairs (same effect kinds, so identical base
  // impactEdgeWeight): one on the commander's "enters:wizard" axis (Wizard Maker <->
  // Wizard Payoff), one off it (Goblin Maker <-> Goblin Payoff, "attacks:goblin"). The
  // commander itself never edges with anyone (control:"opp" trigger matches nothing here, and
  // its own type — instant — never implies an "enters" event), so COMMANDER_BOOST can't be the
  // thing driving the difference — only axisFactor can.
  const commander = dc("Cmd", commanderAxisAbility, [], "Instant");
  const wizardMaker = dc("Wizard Maker", inallaAbility, ["wizard"]);
  const wizardPayoff = dc("Wizard Payoff", wizardPayoffAbility);
  const goblinMaker = dc("Goblin Maker", goblinMakerAbility, ["goblin"]);
  const goblinPayoff = dc("Goblin Payoff", goblinPayoffAbility);
  const report = analyzeDeckStructured(
    [commander, wizardMaker, wizardPayoff, goblinMaker, goblinPayoff],
    ["Cmd"],
    H,
  );

  // Sanity: the commander itself picked up no edges (isolates the comparison from COMMANDER_BOOST).
  expect(report.cards.find((c) => c.name === "Cmd")?.partnerCount).toBe(0);

  const onAxis = report.cards.find((c) => c.name === "Wizard Maker")!;
  const offAxis = report.cards.find((c) => c.name === "Goblin Maker")!;
  expect(onAxis.partnerCount).toBe(1);
  expect(offAxis.partnerCount).toBe(1);
  expect(onAxis.score).toBeGreaterThan(offAxis.score);
  expect(onAxis.synergyRating!).toBeGreaterThan(offAxis.synergyRating!);
});

test("populates report.strategies with a ranked layer-1 archetype", () => {
  // Inalla makes wizard tokens; Kindred Discovery is a wizard-ETB payoff. The token
  // mechanism should surface "tokens" as a strategy (or another real archetype), never
  // an empty list.
  const maker = dc("Inalla", inallaAbility, ["wizard"]);
  const payoff = dc("Kindred Discovery", kindredDiscoveryAbility);
  const report = analyzeDeckStructured([maker, payoff], undefined, H);
  expect(Array.isArray(report.strategies)).toBe(true);
  expect(report.strategies!.length).toBeGreaterThan(0);
  expect(typeof report.strategies![0].name).toBe("string");
  expect(typeof report.strategies![0].label).toBe("string");
});

test("report carries a BUILD score, categories, and suggestions", () => {
  const maker = dc("Inalla", inallaAbility, ["wizard"]);
  const payoff = dc("Kindred Discovery", kindredDiscoveryAbility);
  // A thin deck: expect a low-ish BUILD and at least one concrete gap suggestion.
  const report = analyzeDeckStructured([maker, payoff], ["Inalla"], H);
  expect(typeof report.buildScore).toBe("number");
  expect(report.buildScore).toBeGreaterThanOrEqual(0);
  expect(report.buildScore).toBeLessThanOrEqual(5);
  expect(report.buildCategories?.some((c) => c.category === "ramp")).toBe(true);
  expect(report.suggestions?.length).toBeGreaterThan(0);
});

test("a card filling a functional role AND on-axis is flagged double-duty and boosted", () => {
  const maker = dc("Inalla", inallaAbility, ["wizard"]);
  // wizardPayoffAbility triggers on subtype:wizard directly (same subject key as Inalla's own
  // emit/commander tag "enters:wizard"), so under real-corpus TF-IDF this edge lands squarely
  // on-axis regardless of corpus specifics — unlike kindredDiscoveryAbility's generic
  // "enters:creature" (hierarchy-widened, and common enough in the real corpus to fall below
  // AXIS_ON_THRESHOLD). Still carries the draw-card role for the double-duty check.
  const payoff = dc("Kindred Discovery", wizardPayoffAbility); // draws (role) + on-axis edge
  const report = analyzeDeckStructured([maker, payoff], ["Inalla"], H);
  const kd = report.cards.find((c) => c.name === "Kindred Discovery")!;
  expect(kd.doubleDuty).toBe(true);
  expect(kd.doubleDutyRoles).toContain("draw");
  expect(kd.synergyRating).toBeGreaterThan(0);
});

test("on-axis is thresholded by IDF weight; positiveCoherence stays a valid 0-5", () => {
  // Corpus where 'enters:wizard' is distinctive (rare) and 'draw:any' is universal.
  const stats: TagStats = { N: 1000, counts: { "enters:wizard": 20, "draw:any": 995 } };
  const maker = dc("Inalla", inallaAbility, ["wizard"]);          // emits enters:wizard (distinctive)
  const payoff = dc("Kindred Discovery", kindredDiscoveryAbility); // draw-card theme (generic)
  const report = analyzeDeckStructured([maker, payoff], ["Inalla"], H, undefined, undefined, stats);
  expect(typeof report.positiveCoherence).toBe("number");
  expect(report.positiveCoherence).toBeGreaterThanOrEqual(0);
  expect(report.positiveCoherence).toBeLessThanOrEqual(5);
});

test("exposes the continuous axisWeight per card and the deck axis, ranked", () => {
  // Same fixtures as the double-duty test: the payoff sits on the commander's "enters:wizard"
  // axis, the rock has no theme tags at all. doubleDuty is a hard cut at AXIS_ON_THRESHOLD and
  // fires on ~half a real deck; the underlying weight is what the board needs.
  const maker = dc("Inalla", inallaAbility, ["wizard"]);
  const payoff = dc("Kindred Discovery", wizardPayoffAbility);
  const rock = dc("Mana Rock", [{ kind: "static", effect: { kind: "mana-generation" } }], [], "Artifact");
  const report = analyzeDeckStructured([maker, payoff, rock], ["Inalla"], H);

  const kd = report.cards.find((c) => c.name === "Kindred Discovery")!;
  const mr = report.cards.find((c) => c.name === "Mana Rock")!;
  expect(kd.axisWeight).toBeGreaterThan(0);
  expect(kd.axisWeight).toBeLessThanOrEqual(1);
  expect(mr.axisWeight).toBe(0); // no theme tags, so no on-axis edge

  const axis = report.axis!;
  expect(axis.length).toBeGreaterThan(0);
  expect(axis[0].weight).toBe(1); // normalized: the deck's strongest theme is 1.0
  expect(axis.map((e) => e.weight)).toEqual([...axis.map((e) => e.weight)].sort((x, y) => y - x));
  expect(axis.map((e) => e.tag)).toContain("enters:wizard"); // the commander's anchor tag
});

test("a card filling a functional role but OFF-axis is NOT double-duty (needs both)", () => {
  const maker = dc("Inalla", inallaAbility, ["wizard"]);
  const payoff = dc("Kindred Discovery", kindredDiscoveryAbility); // on-axis draw → double-duty
  // A plain mana rock: has the ramp role but no theme tags, so it forms no on-axis edge.
  const rock = dc("Mana Rock", [{ kind: "static", effect: { kind: "mana-generation" } }], [], "Artifact");
  const report = analyzeDeckStructured([maker, payoff, rock], ["Inalla"], H);
  const mr = report.cards.find((c) => c.name === "Mana Rock")!;
  expect(mr.doubleDuty).toBeFalsy();       // has a role, but off-axis
  expect(mr.doubleDutyRoles).toBeUndefined();
});

test("every card carries its functional roles, not just double-duty cards", () => {
  const ramp = dc("Sol Ring", rampAbility, [], "Artifact");
  const draw = dc("Phyrexian Arena", drawAbility);
  const removal = dc("Lightning Bolt", removalAbility, [], "Instant");
  const vanilla = dc("Grizzly Bears", []);
  const report = analyzeDeckStructured([ramp, draw, removal, vanilla], undefined, H);
  const sol = report.cards.find((c) => c.name === "Sol Ring")!; // ramp, not necessarily double-duty
  expect(sol.roles).toContain("ramp");
  expect(report.cards.find((c) => c.name === "Grizzly Bears")!.roles).toBeUndefined();
});

test("directedReasons is a pure one-way feed: maker -> payoff only, not payoff -> maker", () => {
  const payoff = dc("Impact Tremors", impactTremorsAbility);
  const maker = dc("Maker 1", tokenMakerAbility, ["goblin"]);
  expect(directedReasons(maker, payoff, H).length).toBeGreaterThanOrEqual(1);
  expect(directedReasons(payoff, maker, H).length).toBe(0);
});

test("directional scoring: a payoff fed by many makers outranks each maker (anchor rises)", () => {
  // One payoff + several makers that all feed it. The payoff should be the top synergy card;
  // each maker should sit clearly below (slight lift), not tie the payoff (the old flattening).
  const payoff = dc("Impact Tremors", impactTremorsAbility);      // triggers on a creature ETB → damage
  const makers = [1, 2, 3, 4, 5].map((i) => dc(`Maker ${i}`, tokenMakerAbility, ["goblin"]));
  const report = analyzeDeckStructured([payoff, ...makers], undefined, H);
  const byName = new Map(report.cards.map((c) => [c.name, c] as const));
  const pf = byName.get("Impact Tremors")!;
  const m1 = byName.get("Maker 1")!;
  expect(pf.score).toBeGreaterThan(m1.score);          // anchor tops its feeders
  expect(pf.authority).toBeGreaterThan(0);             // it has payoff support
  expect(report.cards[0].name).toBe("Impact Tremors"); // #1 in the deck
  expect(m1.score).toBeGreaterThan(0);                 // feeders still get a lift
});

test("a well-fed anchor's win-condition bucket is boosted by its authority", () => {
  const payoff = dc("Impact Tremors", impactTremorsAbility);
  const makers = [1, 2, 3, 4, 5].map((i) => dc(`Maker ${i}`, tokenMakerAbility, ["goblin"]));
  const report = analyzeDeckStructured([payoff, ...makers], undefined, H);
  const pf = report.cards.find((c) => c.name === "Impact Tremors")!;
  // Impact Tremors' own damage ability is minor; its win-condition standing comes from being fed.
  expect(pf.bucketScores?.["win-condition"]).toBeGreaterThan(0);
});

test("deck exposes anchoring and a composite synergyOverall, both 0-5", () => {
  const payoff = dc("Impact Tremors", impactTremorsAbility);
  const makers = [1, 2, 3, 4, 5].map((i) => dc(`Maker ${i}`, tokenMakerAbility, ["goblin"]));
  const report = analyzeDeckStructured([payoff, ...makers], undefined, H);
  expect(report.anchoring).toBeGreaterThan(0);
  expect(report.anchoring).toBeLessThanOrEqual(5);
  expect(report.synergyOverall).toBeGreaterThanOrEqual(0);
  expect(report.synergyOverall).toBeLessThanOrEqual(5);
});

test("a mutual pair (each feeds and is fed by the same partner) appears once in topPartners; partnerCount counts distinct partners", () => {
  // Kindred and Tremors are both Creatures whose trigger is "enters:creature" (draw / damage) —
  // each card's own implied self-ETB event satisfies the OTHER card's trigger (see the mutual-feed
  // note in the "high-impact repeatable payoff" test above), so they feed each other. Without the
  // dedupe fix, each would list the other TWICE in topPartners (once per direction) and count
  // partnerCount as 2 instead of the 1 distinct partner it actually has.
  const kindred = dc("Kindred", [{
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { type: "creature", control: "you", token: null } },
    effect: { kind: "draw-card" },
  }]);
  const tremors = dc("Tremors", [{
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { type: "creature", control: "you", token: null } },
    effect: { kind: "damage" },
  }]);
  const report = analyzeDeckStructured([kindred, tremors], undefined, H);
  const k = report.cards.find((c) => c.name === "Kindred")!;
  const t = report.cards.find((c) => c.name === "Tremors")!;
  expect(k.topPartners.map((p) => p.name)).toEqual(["Tremors"]);
  expect(k.partnerCount).toBe(1);
  expect(t.topPartners.map((p) => p.name)).toEqual(["Kindred"]);
  expect(t.partnerCount).toBe(1);
});

/** The turn every deck-math figure is priced against comes from the deck's own clock. The wiring
 *  that carries it is one argument in this file, and it was passed a hardcoded 5 for a whole
 *  change: every unit test passed, because they call computeDeckMath directly, and only a live
 *  deck showed `turnSource: "override"`. This asserts the pipeline, not the maths. */
test("the report prices deck math at the deck's own clock, not at a fixed turn", () => {
  const beater = (name: string): DeckCard => ({
    card: { name, typeLine: "Creature", oracleText: "", keywords: [], colors: [], manaValue: 1, power: "5" } as never,
    tags: null,
  });
  const deck = Array.from({ length: 40 }, (_, i) => beater(`Bear-${i}`));
  const report = analyzeDeckStructured(deck, undefined, H);
  expect(report.deckMath!.turnSource).not.toBe("override");
  expect(report.deckMath!.turn).toBe(report.deckMath!.clock.turn);
});

/** The other shape of the same defect, and the one an emptiness check cannot see: a wired field
 *  that is never empty, never null and perfectly plausible -- it just never MOVES. `turn` was a
 *  hardcoded 5 on every deck alike, and nothing about the value itself looked wrong.
 *
 *  `bin/report-audit.ts` finds this class across the calibration decks by flagging any scalar
 *  identical on all of them; this is the same idea small enough to live in CI. */
test("the pricing turn moves between decks, rather than being one number everywhere", () => {
  const body = (name: string, mv: number, power: string): DeckCard => ({
    card: { name, typeLine: "Creature", oracleText: "", keywords: [], colors: [], manaValue: mv, power } as never,
    tags: null,
  });
  const fast = Array.from({ length: 40 }, (_, i) => body(`Bear-${i}`, 1, "5"));
  const slow = Array.from({ length: 40 }, (_, i) => body(`Ogre-${i}`, 6, "3"));

  const fastTurn = analyzeDeckStructured(fast, undefined, H).deckMath!.turn;
  const slowTurn = analyzeDeckStructured(slow, undefined, H).deckMath!.turn;
  expect(fastTurn).toBeLessThan(slowTurn);
});

/** THE THEME LINE MUST READ THE CORPUS STATS IT IS HANDED.
 *
 *  `analyzeDeckStructured` takes `themeStats` and fed it to `buildAxis`, but ranked the THEMES with
 *  `UNIFORM_STATS` -- the deliberate empty-corpus fallback, where `globalIDF` is `log 2` for every
 *  tag. A constant idf collapses ranking to raw deck frequency, so the commonest tag wins in every
 *  deck: measured on the 71 calibration decks, SEVEN of eight spellslinger/aristocrat decks themed
 *  as "draw", and orzhov-spellslinger led with "lose life".
 *
 *  This deck has MORE draw than damage. With honest stats saying draw is corpus-universal and
 *  non-combat damage is rare, the rare mechanism must lead -- that is the whole point of weighting
 *  by idf, and the assertion fails when the ranking ignores the stats it was given. */
test("themes rank by corpus rarity, not raw frequency", () => {
  const drawAbility: CardTags["abilities"] = [{
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { control: "you", token: null } },
    effect: { kind: "draw-card", subject: { control: "you", token: null } },
    emits: [{ verb: "draw", subject: { control: "you", token: null } }],
  }];
  const damageAbility: CardTags["abilities"] = [{
    kind: "triggered",
    trigger: { verbs: ["cast"], subject: { type: "instant", control: "you", token: null } },
    effect: { kind: "damage", subject: { control: "opp", token: null } },
    emits: [{ verb: "non-combat-damage", subject: { control: "opp", token: null } }],
  }];
  const deck = [
    dc("Drawer A", drawAbility), dc("Drawer B", drawAbility), dc("Drawer C", drawAbility),
    dc("Bolt A", damageAbility), dc("Bolt B", damageAbility),
  ];
  // draw is in nearly every card in the corpus; the damage trigger is rare.
  const stats: TagStats = { N: 1000, counts: { "draw:any": 900, "enters:any": 900, "cast:instant": 5, "non-combat-damage:opp": 5 } };
  const report = analyzeDeckStructured(deck, undefined, H, SEED_IMPACT_WEIGHTS, undefined, stats);
  expect(report.cohesion).not.toBeNull();
  expect(report.cohesion!.tag).not.toBe("draw:any");
});

/** A DECK IS WHAT ITS PAYOFFS CARE ABOUT, NOT WHAT ITS CARDS HAPPEN TO DO.
 *
 *  `cardThemeTags` counts triggers, emits and static effects indistinguishably, so a mechanic the
 *  deck merely DOES outvoted the one it is BUILT AROUND. Measured on the owner's Sorin list
 *  (orzhov-spellslinger): 20 cards emit life loss — mostly removal spells that drain incidentally —
 *  against 7 that trigger on casting a noncreature spell, so it themed "lose life / gain life"
 *  despite Charitable Levy, Monastery Mentor, Sedgemoor Witch and Primal Amulet being the engine.
 *
 *  Here three cards EMIT damage and two TRIGGER on casting. The consumers must lead. */
test("theme ranking weighs what a card cares about above what it merely does", () => {
  const emitsDamage: CardTags["abilities"] = [{
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { control: "you", token: null } },
    effect: { kind: "damage", subject: { control: "opp", token: null } },
    emits: [{ verb: "non-combat-damage", subject: { control: "opp", token: null } }],
  }];
  const caresAboutCasting: CardTags["abilities"] = [{
    kind: "triggered",
    trigger: { verbs: ["cast"], subject: { type: "instant", control: "you", token: null } },
    effect: { kind: "draw-card", subject: { control: "you", token: null } },
  }];
  const deck = [
    dc("Burn A", emitsDamage), dc("Burn B", emitsDamage), dc("Burn C", emitsDamage),
    dc("Mentor A", caresAboutCasting), dc("Mentor B", caresAboutCasting),
  ];
  // Equally rare in the corpus, so rarity cannot decide it — only the cares/does split can.
  const stats: TagStats = { N: 1000, counts: { "non-combat-damage:opp": 20, "cast:instant": 20, "enters:any": 900 } };
  const report = analyzeDeckStructured(deck, undefined, H, SEED_IMPACT_WEIGHTS, undefined, stats);
  expect(report.cohesion!.tag).toBe("cast:instant");
});

// Task 6 (tokens-as-nodes): a Treasure-making card and a Treasure-caring card. The carer's trigger
// is "sacrifice a Treasure" — neither the maker's authored emits (create-token, enters) nor the
// (vanilla, ability-less) token's own characteristics satisfy a `sacrifice` verb, so nothing in this
// two-card deck connects maker to carer directly. The only edge either card can form is the maker's
// NEW `creates:` edge to the Treasure node itself.
const treasureMakerAbility: CardTags["abilities"] = [{
  kind: "triggered",
  trigger: { verbs: ["enters"], subject: { self: true, control: "you", token: false } },
  effect: { kind: "token-generation", subject: { subtype: "treasure", control: "you", token: true } },
  emits: [
    { verb: "create-token", subject: { subtype: "treasure", control: "you", token: true } },
    { verb: "enters", subject: { subtype: "treasure", control: "you", token: true } },
  ],
}];
const treasureCarerAbility: CardTags["abilities"] = [{
  kind: "triggered",
  trigger: { verbs: ["sacrifice"], subject: { subtype: "treasure", control: "you", token: null } },
  effect: { kind: "draw-card" },
}];
// Vanilla, per Task 5's measurement that 59 of 94 derived tokens carry zero abilities (a plain
// Flying Bird) — exercises the fact that `createsReasons` cannot lean on the token having any
// trigger of its own, unlike every other reason-forming pass in edges.ts.
const treasureTags: CardTags = {
  oracleId: "token-treasure-oracle", schemaVersion: 1, promptVersion: 1, model: "t",
  characteristics: { types: ["token", "artifact"], subtypes: ["treasure"], colors: [], identity: [], cmc: 0, power: null, toughness: null, token: true, keywords: [] },
  abilities: [],
};
const makerCard = {
  name: "Treasure Maker", typeLine: "Creature", oracleText: "", keywords: [], colors: [], manaValue: 0,
  // `createdTokenRefs` (tokens.ts) reads this positionally-untyped field off the raw Card; it isn't
  // part of the `Card` interface, hence the cast, matching how `dc()` above already casts its literal.
  allParts: [{ component: "token", name: "Treasure", typeLine: "Token Artifact — Treasure", printingId: "treasure-printing-id" }],
} as never;
const maker: DeckCard = {
  card: makerCard,
  tags: {
    oracleId: "Treasure Maker", schemaVersion: 1, promptVersion: 1, model: "t",
    characteristics: { types: ["creature"], subtypes: [], colors: [], identity: [], cmc: 0, power: null, toughness: null, token: false, keywords: [] },
    abilities: treasureMakerAbility,
  },
};
const carer = dc("Treasure Carer", treasureCarerAbility);

test("a token maker produces a token node, and edges to it rather than to an unrelated carer", () => {
  const report = analyzeDeckStructured(
    [maker, carer], undefined, H, undefined, undefined, undefined,
    (ref) => (ref.printingId === "treasure-printing-id" ? treasureTags : null),
  );
  const creates = report.edges.find((e) => e.reasons.some((r) => r.tag === "creates:treasure"));
  expect(creates).toBeDefined();
  expect([creates!.a, creates!.b].sort()).toEqual(["Treasure", "Treasure Maker"]);
  // The maker edges to the NODE, not to the carer — nothing here structurally links them.
  expect(report.edges.some((e) => [e.a, e.b].includes("Treasure Maker") && [e.a, e.b].includes("Treasure Carer"))).toBe(false);
  // Exclusion list (owner's ruling, 2026-08-15): the token must not leak into the ranked card list.
  expect(report.cards.map((c) => c.name).sort()).toEqual(["Treasure Carer", "Treasure Maker"]);
});

test("without a tokenTags lookup, no token node is created (existing callers are unaffected)", () => {
  const report = analyzeDeckStructured([maker, carer], undefined, H);
  expect(report.edges.some((e) => e.a === "Treasure" || e.b === "Treasure")).toBe(false);
});

// Findings 1/2 (owner review, 2026-08-16): archetype grouping and theme membership both read card
// names straight out of token-inclusive edges/reasons with no filter, so a token name leaked into
// `report.archetypes[].cards` and inflated `themeMembership[].surplus/payoffs/baseline`. Reuses the
// exact Inalla/Kindred Discovery fixture the pre-existing themeMembership test above pins, plus a
// Wizard token: Inalla structurally creates it, and the token's OWN implied "enters" event (subtype
// wizard, per its own characteristics) now correctly satisfies Kindred Discovery's "enters:wizard"
// trigger — the token becomes a real, additional BASELINE producer of that tag (impliedProducer:
// true), which is exactly the shape that leaked before the fix.
test("Findings 1/2: a token node's name does not leak into archetype card lists or theme membership counts", () => {
  const makerCard = {
    name: "Inalla", typeLine: "Legendary Creature", oracleText: "", keywords: [], colors: [], manaValue: 0,
    allParts: [{ component: "token", name: "Wizard", typeLine: "Token Creature — Wizard", printingId: "wizard-printing-id" }],
  } as never;
  const maker: DeckCard = {
    card: makerCard,
    tags: {
      oracleId: "Inalla", schemaVersion: 1, promptVersion: 1, model: "t",
      characteristics: { types: ["legendary", "creature"], subtypes: ["wizard"], colors: [], identity: [], cmc: 0, power: null, toughness: null, token: false, keywords: [] },
      abilities: inallaAbility,
    },
  };
  const payoff = dc("Kindred Discovery", wizardPayoffAbility);
  const wizardTokenTags: CardTags = {
    oracleId: "token-wizard-oracle", schemaVersion: 1, promptVersion: 1, model: "t",
    characteristics: { types: ["token", "creature"], subtypes: ["wizard"], colors: [], identity: [], cmc: 0, power: "1", toughness: "1", token: true, keywords: [] },
    abilities: [],
  };
  const report = analyzeDeckStructured(
    [maker, payoff], ["Inalla"], H, undefined, undefined, undefined,
    (ref) => (ref.printingId === "wizard-printing-id" ? wizardTokenTags : null),
  );
  // Sanity: the token really is on the node/edge set, so the exclusions below are proven, not vacuous.
  expect(report.edges.some((e) => e.a === "Wizard" || e.b === "Wizard")).toBe(true);

  for (const g of report.archetypes ?? []) expect(g.cards).not.toContain("Wizard");

  const entersWizard = report.themeMembership!.find((t) => t.tag === "enters:wizard")!;
  expect(entersWizard).toBeDefined();
  expect(entersWizard.surplus).toBeGreaterThanOrEqual(1); // Inalla's authored emit, unaffected
  expect(entersWizard.baseline).toBe(0); // would be >=1 (the token) if the leak were still present
});

// Round-1 re-review (2026-08-16): the fix above filtered `cardEdges` by matching `edge.a`/`edge.b`
// against a set of token NAMES -- wrong, because names are not unique. 10 of the 71 calibration
// decks run a real card whose name matches a token IT creates (witnessed live: "Coruscation Mage" in
// kuja-spellslinger.txt makes a "Coruscation Mage" copy token). The name filter dropped every edge
// naming that string, real-card edges included -- silent data loss, worse than the leak it replaced.
// Reproduces the collision directly: "Twin" is a real card that (a) creates a token ALSO named
// "Twin" and (b) has a genuine, unrelated static edge to "Payoff". A name-based filter zaps both;
// an identity-based one (`a.isToken`/`b.isToken` at edge-creation time) must keep (b).
const twinStaticAbility: CardTags["abilities"] = [{
  kind: "static",
  effect: { kind: "pump", subject: { subtype: "elf", control: "you", token: null } },
}];
const twinTokenMakerAbility: CardTags["abilities"] = [{
  kind: "triggered",
  trigger: { verbs: ["enters"], subject: { self: true, control: "you", token: false } },
  effect: { kind: "token-generation", subject: { subtype: "twin-copy", control: "you", token: true } },
  emits: [{ verb: "create-token", subject: { subtype: "twin-copy", control: "you", token: true } }],
}];
test("a real card whose name collides with the token it creates keeps its OWN edges in archetypes[].cards", () => {
  const makerCard = {
    name: "Twin", typeLine: "Creature", oracleText: "", keywords: [], colors: [], manaValue: 0,
    allParts: [{ component: "token", name: "Twin", typeLine: "Token Creature — Twin", printingId: "twin-printing-id" }],
  } as never;
  const maker: DeckCard = {
    card: makerCard,
    tags: {
      oracleId: "Twin", schemaVersion: 1, promptVersion: 1, model: "t",
      characteristics: { types: ["creature"], subtypes: [], colors: [], identity: [], cmc: 0, power: null, toughness: null, token: false, keywords: [] },
      abilities: [...twinStaticAbility, ...twinTokenMakerAbility],
    },
  };
  const payoff = dc("Payoff", [], ["elf"]);
  const twinTokenTags: CardTags = {
    oracleId: "token-twin-oracle", schemaVersion: 1, promptVersion: 1, model: "t",
    characteristics: { types: ["token", "creature"], subtypes: ["twin-copy"], colors: [], identity: [], cmc: 0, power: "2", toughness: "2", token: true, keywords: [] },
    abilities: [],
  };
  const report = analyzeDeckStructured(
    [maker, payoff], undefined, H, undefined, undefined, undefined,
    (ref) => (ref.printingId === "twin-printing-id" ? twinTokenTags : null),
  );
  // Sanity: the collision is real -- two edges share the endpoint name "Twin", one to the token,
  // one to a real card, so the exclusion below is being tested against the actual failure shape.
  expect(report.edges.filter((e) => e.a === "Twin" || e.b === "Twin").length).toBe(2);
  expect(report.edges.some((e) => [e.a, e.b].includes("Twin") && [e.a, e.b].includes("Payoff"))).toBe(true);

  const cardsInArchetypes = new Set((report.archetypes ?? []).flatMap((g) => g.cards));
  expect(cardsInArchetypes.has("Twin")).toBe(true); // the REAL card's own static edge must survive
  expect(cardsInArchetypes.has("Payoff")).toBe(true); // its genuine partner must survive too
});

test("a token nothing but its maker relates to is reported unpartnered", () => {
  const makerCard = {
    name: "Inalla", typeLine: "Legendary Creature", oracleText: "", keywords: [], colors: [], manaValue: 0,
    allParts: [{ component: "token", name: "Wizard", typeLine: "Token Creature — Wizard", printingId: "wizard-printing-id" }],
  } as never;
  const maker: DeckCard = {
    card: makerCard,
    tags: {
      oracleId: "Inalla", schemaVersion: 1, promptVersion: 1, model: "t",
      characteristics: { types: ["legendary", "creature"], subtypes: ["wizard"], colors: [], identity: [], cmc: 0, power: null, toughness: null, token: false, keywords: [] },
      abilities: inallaAbility,
    },
  };
  const payoff = dc("Kindred Discovery", wizardPayoffAbility);
  const wizardTokenTags: CardTags = {
    oracleId: "token-wizard-oracle", schemaVersion: 1, promptVersion: 1, model: "t",
    characteristics: { types: ["token", "creature"], subtypes: ["wizard"], colors: [], identity: [], cmc: 0, power: "1", toughness: "1", token: true, keywords: [] },
    abilities: [],
  };
  const lookup = (ref: { printingId?: string }) =>
    (ref.printingId === "wizard-printing-id" ? wizardTokenTags : null);

  // With the payoff in the deck the Wizard has a relation beyond its own maker.
  const withPayoff = analyzeDeckStructured(
    [maker, payoff], ["Inalla"], H, undefined, undefined, undefined, lookup,
  );
  expect(withPayoff.tokenNodes).toEqual([{ name: "Wizard", hasPartner: true }]);
  // Every reason touching the token says WHICH SIDE it is, so the graph can key it apart from a
  // real card of the same name -- 92 corpus token names are also a card.
  const tokenReasons = withPayoff.edges
    .filter((e) => e.a === "Wizard" || e.b === "Wizard")
    .flatMap((e) => e.reasons);
  expect(tokenReasons.length).toBeGreaterThan(0);
  expect(tokenReasons.every((r) => r.producerIsToken === true || r.consumerIsToken === true)).toBe(true);

  // Maker alone: the only edge the Wizard can have is the `creates:` one back to Inalla, which is
  // exactly what does NOT count as a partner -- the "this deck makes Clues and nothing cares" case.
  const alone = analyzeDeckStructured(
    [maker, dc("Bear", [])], ["Inalla"], H, undefined, undefined, undefined, lookup,
  );
  expect(alone.tokenNodes).toEqual([{ name: "Wizard", hasPartner: false }]);
});

// THE RATINGS PASS WALKS THE TWO HOPS (2026-08-18). Task 7's mediation moved a maker's relation to
// its payoff onto the token node, and the directional pass iterates real cards only -- so a token
// payoff read as synergising with nothing. Measured before the fix across the 71 decks: 100 cards
// with ZERO directed partners while carrying token edges, 43 of which HAD partners pre-mediation;
// the worst was Caretaker's Talent at 30 partners -> 0 in a token deck.
const treasureSacTokenTags: CardTags = {
  oracleId: "token-treasure-oracle", schemaVersion: 1, promptVersion: 1, model: "t",
  characteristics: { types: ["token", "artifact"], subtypes: ["treasure"], colors: [], identity: [], cmc: 0, power: null, toughness: null, token: true, keywords: [] },
  abilities: [{
    kind: "activated",
    effect: { kind: "mana-generation" },
    emits: [{ verb: "sacrifice", subject: { subtype: "treasure", control: "you", token: true } }],
  }],
};

test("a maker and a token payoff are partners THROUGH the token, with the token named in the reason", () => {
  const report = analyzeDeckStructured(
    [maker, carer], undefined, H, undefined, undefined, undefined,
    (ref) => (ref.printingId === "treasure-printing-id" ? treasureSacTokenTags : null),
  );

  const makerCardOut = report.cards.find((c) => c.name === "Treasure Maker")!;
  const carerCardOut = report.cards.find((c) => c.name === "Treasure Carer")!;
  expect(makerCardOut.partnerCount).toBe(1);
  expect(carerCardOut.partnerCount).toBe(1);
  expect(makerCardOut.topPartners[0]?.name).toBe("Treasure Carer");
  // The reason is the TOKEN's, borrowed for the pair -- one fact, one path. The text still names the
  // token, so the inspector can show which token mediates.
  expect(carerCardOut.topPartners[0]?.reasons[0]?.text).toContain("Treasure");
  // Still no DIRECT edge between them: the graph keeps mediating, only the ratings traverse.
  expect(report.edges.some((e) => [e.a, e.b].includes("Treasure Maker") && [e.a, e.b].includes("Treasure Carer"))).toBe(false);
});

// THE MEMBERSHIP CENSUS WALKS THE SAME TWO HOPS (roadmap A2, 2026-08-19). `allReasons` is built
// from `cardEdges`, which excludes every token-touching edge, so a token deck's plan sat on exactly
// the excluded edges and `themeMembership` reported a split that was missing it -- and any loop-based
// ranking reading that split measures a lie.
test("a token-mediated relation reaches themeMembership, credited to the REAL cards", () => {
  const report = analyzeDeckStructured(
    [maker, carer], undefined, H, undefined, undefined, undefined,
    (ref) => (ref.printingId === "treasure-printing-id" ? treasureSacTokenTags : null),
  );
  const sac = report.themeMembership!.find((t) => t.tag === "sacrifice:treasure");
  expect(sac).toBeDefined();
  // The maker SUPPLIES it through the token it makes, and the carer is the payoff. Neither is a
  // token, because the hop is re-stamped onto the cards at its ends.
  expect(sac!.surplus + sac!.payoffs).toBeGreaterThan(0);
  expect(sac!.payoffs).toBeGreaterThan(0);
  // No token name leaks into the census -- the tags are a card-level split, and 92 of 661 token
  // names collide with a real card's.
  expect(report.themeMembership!.some((t) => t.tag.startsWith("static:"))).toBe(false);
});

// WHO GETS THE TOKEN DECIDES WHETHER THE HOP EXISTS. Beast Within's Beast goes to the permanent's
// controller -- an opponent -- and a payoff says "tokens YOU control", so crediting its maker would
// state a synergy the card cannot supply. Caught by measuring: the first cut lifted Beast Within and
// Generous Gift from 0 to 2.0 in naya-spellslinger.
test("a maker that gives its token to an OPPONENT earns no two-hop credit", () => {
  const oppMaker: DeckCard = {
    card: {
      name: "Beast Giver", typeLine: "Instant", oracleText: "", keywords: [], colors: [], manaValue: 0,
      allParts: [{ component: "token", name: "Treasure", typeLine: "Token Artifact — Treasure", printingId: "treasure-printing-id" }],
    } as never,
    tags: {
      oracleId: "Beast Giver", schemaVersion: 1, promptVersion: 1, model: "t",
      characteristics: { types: ["instant"], subtypes: [], colors: [], identity: [], cmc: 0, power: null, toughness: null, token: false, keywords: [] },
      abilities: [{
        kind: "on-cast",
        effect: { kind: "token-generation", subject: { subtype: "treasure", control: "opp", token: true } },
        emits: [
          { verb: "create-token", subject: { subtype: "treasure", control: "opp", token: true } },
          { verb: "enters", subject: { subtype: "treasure", control: "opp", token: true } },
        ],
      }],
    },
  };

  const report = analyzeDeckStructured(
    [oppMaker, carer], undefined, H, undefined, undefined, undefined,
    (ref) => (ref.printingId === "treasure-printing-id" ? treasureSacTokenTags : null),
  );

  expect(report.cards.find((c) => c.name === "Beast Giver")!.partnerCount).toBe(0);
  expect(report.cards.find((c) => c.name === "Treasure Carer")!.partnerCount).toBe(0);
});

/** `dc`, `H`, `inallaAbility` and `kindredDiscoveryAbility` are the fixtures already defined at the
 *  top of this file — Inalla makes Wizard tokens (the FEEDER), Kindred Discovery triggers on a
 *  creature entering (the PAYOFF). */
test("payoff and feeder ratings reconstruct the headline at roleBlend 1", () => {
  const maker = dc("Inalla", inallaAbility, ["wizard"]);
  const payoff = dc("Kindred Discovery", kindredDiscoveryAbility);
  const report = analyzeDeckStructured([maker, payoff], undefined, H);
  for (const c of report.cards) {
    if (c.synergyRating === undefined || c.doubleDuty) continue; // the doubleDuty premium is headline-only
    const sum = (c.payoffRating ?? 0) + (c.feederRating ?? 0);
    // The identity is exact before rounding; all three are rounded to 0.1 independently, so allow
    // one rounding step per component.
    expect(Math.abs(sum - c.synergyRating)).toBeLessThanOrEqual(0.2);
  }
});

test("the two roles separate: the maker earns feeder credit, the payoff earns payoff credit", () => {
  const maker = dc("Inalla", inallaAbility, ["wizard"]);
  const payoff = dc("Kindred Discovery", kindredDiscoveryAbility);
  const report = analyzeDeckStructured([maker, payoff], undefined, H);
  const inalla = report.cards.find((c) => c.name === "Inalla")!;
  const kindred = report.cards.find((c) => c.name === "Kindred Discovery")!;
  // Inalla feeds Kindred Discovery, so Inalla carries feeder lift and Kindred Discovery authority.
  expect(inalla.feederLift!).toBeGreaterThan(0);
  expect(inalla.feederRating!).toBeGreaterThan(0);
  expect(kindred.authority!).toBeGreaterThan(0);
  expect(kindred.payoffRating!).toBeGreaterThan(0);
  // The sentence the blended rating could never say: the maker's payoff-side credit is not what
  // puts it in the deck.
  expect(inalla.payoffRating!).toBeLessThan(kindred.payoffRating!);
});

// Important 4 (final-review fix wave, 2026-08-18): `impact.test.ts` only asserts the committed JSON
// VALUE `roleBlend: 1`; nothing asserted the field is WIRED. Deleting `ROLE_BLEND *` from
// `analyze.ts:417` (score = authority + ROLE_BLEND * feederLift) left the whole suite green before
// this test existed.
test("roleBlend actually scales feederLift into score, not just a config field nothing reads", () => {
  const maker = dc("Inalla", inallaAbility, ["wizard"]);
  const payoff = dc("Kindred Discovery", kindredDiscoveryAbility);
  const w = { ...loadImpactWeights(), roleBlend: 0 };
  // Inalla is the feeder here (no authority of her own — nothing feeds her), so at roleBlend 0 her
  // score collapses to `authority` alone (~0) and must fall below the roleBlend-1 default, where it
  // is `authority + feederLift`.
  const blendOff = analyzeDeckStructured([maker, payoff], undefined, H, w);
  const blendOn = analyzeDeckStructured([maker, payoff], undefined, H);
  const inallaOff = blendOff.cards.find((c) => c.name === "Inalla")!;
  const inallaOn = blendOn.cards.find((c) => c.name === "Inalla")!;
  expect(inallaOff.score).toBeLessThan(inallaOn.score);
});

describe("answer coverage reaches the report", () => {
  it("weights by the COMMANDERS' identity, not by the whole deck's", () => {
    // A mono-black commander with an off-identity card in the 99 is not a five-colour deck.
    const deck = [
      { card: { name: "Black Commander", typeLine: "Legendary Creature — Zombie", oracleText: "", keywords: [], colors: ["B"], colorIdentity: ["B"], manaValue: 3, power: "3", toughness: "3" }, tags: null },
      { card: { name: "Naturalize", typeLine: "Instant", oracleText: "Destroy target artifact or enchantment.", keywords: [], colors: ["G"], colorIdentity: ["G"], manaValue: 2, power: null, toughness: null }, tags: null },
    ] as never[];
    const report = analyzeDeckStructured(deck, ["Black Commander"]);
    expect(report.answerCoverage!.source).toBe("weighted");
    const artifact = report.answerCoverage!.rows.find((r) => r.class === "artifact")!;
    // Black's artifact pool is the smallest of any identity; a five-colour read would be 1.
    expect(artifact.poolShare).toBeLessThan(0.2);
  });

  it("refuses the pool weight when no commander was detected", () => {
    const deck = [
      { card: { name: "Lone Card", typeLine: "Instant", oracleText: "Destroy target creature.", keywords: [], colors: ["B"], colorIdentity: ["B"], manaValue: 2, power: null, toughness: null }, tags: null },
    ] as never[];
    expect(analyzeDeckStructured(deck).answerCoverage!.source).toBe("unweighted");
  });

  it("refuses the pool weight when the named commander matches no card in the deck", () => {
    // A typo'd or unresolved commander name must not silently read as a matched-but-colorless
    // identity ([]) -- that is a real, thin pool (key "C") and gets weighted as one. It must fall
    // back to unweighted exactly like "no commander" does.
    const deck = [
      { card: { name: "Lone Card", typeLine: "Instant", oracleText: "Destroy target creature.", keywords: [], colors: ["B"], colorIdentity: ["B"], manaValue: 2, power: null, toughness: null }, tags: null },
    ] as never[];
    expect(analyzeDeckStructured(deck, ["Nonexistent Commander"]).answerCoverage!.source).toBe("unweighted");
  });
});

// Whole-branch review IMPORTANT 5: a decklist whose library resolves to ZERO cards -- only a
// commander line, or every other name failing to resolve -- used to 500 the whole analysis.
// `computeDeckMath`'s `minCopies` (hypergeometric.ts) THROWS at library=0 on purpose ("a silent
// wrong answer is worse than a missing one"), and nothing upstream of the call guarded it.
// Confirmed BEFORE this fix (direct `computeDeckMath` call, one commander, no library):
// `minCopies: P(>= 1 by turn 9) >= 0.5 is unreachable at any copy count in 0`.
it("analyses a commander-only deck instead of throwing, with deckMath simply absent", () => {
  const cmd = {
    card: { name: "Solo Commander", typeLine: "Legendary Creature — Zombie", oracleText: "", keywords: [], colors: ["B"], colorIdentity: ["B"], manaValue: 3, power: "3", toughness: "3" },
    tags: null,
  } as never;
  const report = analyzeDeckStructured([cmd], ["Solo Commander"]);
  expect(report.deckMath).toBeUndefined();
  // Every other section still reports -- the guard skips one block, not the whole analysis.
  expect(report.commanders).toEqual(["Solo Commander"]);
});

// A FACE IS A NODE (2026-08-27, owner's ruling): "if you flip the card it can care about different
// events and produce different ones". Expanded in `unique` and nowhere above it -- `resolved` stays
// the physical cards, so `computeDeckMath`, `deckFreq`, `computeRoles` and `detectBuildCategories`
// keep counting a two-faced card once. This deck is 3 physical cards, one of them the modal DFC
// "Fell the Profane // Fell Mire" (Instant // Land) already used as the faces.ts/edges.ts fixture.
const fellTheProfane = (): DeckCard => ({
  card: {
    name: "Fell the Profane // Fell Mire",
    typeLine: "Instant // Land",
    oracleText: "Destroy target creature or planeswalker.\n// Fell Mire enters the battlefield tapped.",
    // A CARD-LEVEL COST THE FRONT FACE OWNS. `docToCard` fills `manaCost` from `faces[0]` when the
    // document has none, which is every modal DFC -- so a fixture without it cannot show the row
    // that used to print "{1}{B}" beside a Land.
    keywords: [], colors: ["B"], manaValue: 2, manaCost: "{1}{B}",
    faces: [
      { name: "Fell the Profane", typeLine: "Instant", oracleText: "Destroy target creature or planeswalker.", manaCost: "{1}{B}", colors: ["B"] },
      { name: "Fell Mire", typeLine: "Land", oracleText: "Fell Mire enters the battlefield tapped.", colors: [] },
    ],
  } as never,
  tags: {
    oracleId: "fell-the-profane", schemaVersion: 1, promptVersion: 1, model: "t",
    characteristics: {
      types: ["instant", "land"], subtypes: [], colors: [], identity: [], cmc: 2,
      power: null, toughness: null, token: false, keywords: [],
      faces: [
        { types: ["instant"], subtypes: [] },
        { types: ["land"], subtypes: [] },
      ],
    },
    abilities: [],
  } as CardTags,
});

test("a multi-face card is rated once per face and counted once as a card", () => {
  const beater = dc("Vanilla Beater", []);
  const another = dc("Another Beater", []);
  const report = analyzeDeckStructured([beater, another, fellTheProfane()], undefined, H);
  const rated = report.cards.map((c) => c.name);
  expect(rated).toContain("Fell the Profane");
  expect(rated).toContain("Fell Mire");
  expect(rated).not.toContain("Fell the Profane // Fell Mire");
  // `DeckReport` has no `stats.totalCards` field (checked -- @edh-seer/engine's DeckReport carries
  // `manaCurve`/`landCount` directly, both from `computeDeckStats(resolved.map(dc => dc.card))`).
  // Same invariant, real fields: the library stayed 3 PHYSICAL cards. A face split that leaked past
  // `unique` into `resolved` would count the DFC's Instant face AND its Land face separately here,
  // reading landCount 1 + nonland 3 = 4 instead of 3.
  const nonlandCount = report.manaCurve.reduce((sum, b) => sum + b.count, 0);
  expect(nonlandCount + report.landCount).toBe(3);
});

test("a commander that is a multi-face card is still the commander on its front face", () => {
  const dfcCommander: DeckCard = {
    card: {
      name: "Ajani, Nacatl Pariah // Ajani, Nacatl Avenger",
      typeLine: "Legendary Creature — Cat Cleric // Legendary Planeswalker — Ajani",
      oracleText: "a\n// b",
      keywords: [], colors: ["W"], manaValue: 2,
      faces: [
        { name: "Ajani, Nacatl Pariah", typeLine: "Legendary Creature — Cat Cleric", oracleText: "a", manaCost: "{1}{W}", colors: ["W"] },
        { name: "Ajani, Nacatl Avenger", typeLine: "Legendary Planeswalker — Ajani", oracleText: "b", colors: ["W", "G"] },
      ],
    } as never,
    tags: {
      oracleId: "ajani-nacatl-pariah", schemaVersion: 1, promptVersion: 1, model: "t",
      characteristics: {
        types: ["creature"], subtypes: ["cat", "cleric"], colors: ["W"], identity: ["W", "G"], cmc: 2,
        power: "1", toughness: "1", token: false, keywords: [],
        faces: [
          { types: ["creature"], subtypes: ["cat", "cleric"] },
          { types: ["planeswalker"], subtypes: ["ajani"] },
        ],
      },
      abilities: [],
    } as CardTags,
  };
  const other = dc("Filler", []);
  const report = analyzeDeckStructured(
    [dfcCommander, other],
    ["Ajani, Nacatl Pariah // Ajani, Nacatl Avenger"],
    H,
  );
  expect(report.cards.find((c) => c.name === "Ajani, Nacatl Pariah")?.isCommander).toBe(true);
});


// ============================================================================
// REVIEW FIXES (2026-08-27) -- Task 4 quality review found four defects in the first cut of
// face-splitting. Covering tests below, one block per fix.
// ============================================================================

// CRITICAL: two faces of one physical card must not partner with each other -- they are never
// both on the battlefield (CR 712.4a for a transform, one chosen face for an MDFC). Reproduced on
// the reviewer's own probe shape: a front face with a landfall-caring trigger, a back face that is
// itself a Land. Pre-fix, the back face's own implied `enters` (a land entering) satisfied the
// front face's trigger, reading as a genuine synergy -- the board's ruling is "shared rim, no
// link".
const selfLandfall = (): DeckCard => ({
  card: {
    name: "Landfall Front // Landfall Back",
    typeLine: "Sorcery // Land",
    oracleText: "a\n// b",
    keywords: [], colors: ["G"], manaValue: 2,
    faces: [
      { name: "Landfall Front", typeLine: "Sorcery", oracleText: "a", manaCost: "{1}{G}", colors: ["G"] },
      { name: "Landfall Back", typeLine: "Land", oracleText: "b", colors: [] },
    ],
  } as never,
  tags: {
    oracleId: "landfall-front", schemaVersion: 1, promptVersion: 1, model: "t",
    characteristics: {
      types: ["sorcery", "land"], subtypes: [], colors: [], identity: [], cmc: 2,
      power: null, toughness: null, token: false, keywords: [],
      faces: [
        { types: ["sorcery"], subtypes: [] },
        { types: ["land"], subtypes: [] },
      ],
    },
    abilities: [
      // Face 0 (front, default) only: watches a land entering.
      { kind: "triggered", trigger: { verbs: ["enters"], subject: { control: "you", token: null, type: ["land"] } }, effect: { kind: "add-mana" } },
    ],
  } as CardTags,
});

test("CRITICAL: two faces of one physical card form no edge with each other", () => {
  const filler = dc("Filler", []);
  const report = analyzeDeckStructured([selfLandfall(), filler], undefined, H);
  const selfEdge = report.edges.find(
    (e) =>
      (e.a === "Landfall Front" && e.b === "Landfall Back") ||
      (e.a === "Landfall Back" && e.b === "Landfall Front"),
  );
  expect(selfEdge).toBeUndefined();
  const front = report.cards.find((c) => c.name === "Landfall Front");
  expect(front?.topPartners.some((p) => p.name === "Landfall Back")).toBe(false);
  expect(front?.partnerCount).toBe(0);
});

// IMPORTANT: nine joins built off `resolved` (keyed by PHYSICAL card) were being read with a FACE
// name, silently missing every time. `manaValue`/`derived` are the two with the clearest,
// deterministic assertions: a physical card's manaValue must reach both its face rows, and an
// UNDERIVED two-faced card must report `derived: false`, never silently default to read.
test("IMPORTANT: a rated face row carries its physical card's mana value and cost", () => {
  const beater = dc("Vanilla Beater", []);
  const report = analyzeDeckStructured([beater, fellTheProfane()], undefined, H);
  const front = report.cards.find((c) => c.name === "Fell the Profane")!;
  const back = report.cards.find((c) => c.name === "Fell Mire")!;
  // The card-level manaValue (2), not the (absent) per-face one -- faces don't split cmc (E4).
  expect(front.manaValue).toBe(2);
  expect(back.manaValue).toBe(2);
  expect(front.derived).toBe(true);
  expect(back.derived).toBe(true);
  // `cardName`/`face` themselves -- the fields every consumer of a face row joins BACK through
  // (`c.cardName ?? c.name`). Untested until 2026-08-27: because that join degrades silently and
  // exactly to pre-fix behaviour when the producer field is absent, deleting the two lines that
  // set them in `analyze.ts` passed all 2,667 tests. `cardName` on BOTH faces, `face` absent on
  // the front and 1 on the back -- the "front is unmarked" convention `WireGraphNode.face` and
  // `Reason.producerFace` already keep.
  expect(front.cardName).toBe("Fell the Profane // Fell Mire");
  expect(back.cardName).toBe("Fell the Profane // Fell Mire");
  expect(front.face).toBeUndefined();
  expect(back.face).toBe(1);
  // THE COST IS THE FACE'S OWN, unlike the mana value. Fell Mire is a Land and prints none, and the
  // card-level cost it used to inherit is the FRONT face's -- review fix, 2026-08-28.
  expect(front.manaCost).toBe("{1}{B}");
  expect(back.manaCost).toBeUndefined();
});

test("IMPORTANT: an underived two-faced card is reported as underived, not silently read", () => {
  const underivedMdfc: DeckCard = {
    card: {
      name: "Underived Front // Underived Back",
      typeLine: "Sorcery // Land",
      oracleText: "a\n// b",
      keywords: [], colors: [], manaValue: 2,
      faces: [
        { name: "Underived Front", typeLine: "Sorcery", oracleText: "a", manaCost: "{1}{G}", colors: ["G"] },
        { name: "Underived Back", typeLine: "Land", oracleText: "b", colors: [] },
      ],
    } as never,
    tags: null,
  };
  const filler = dc("Filler", []);
  const report = analyzeDeckStructured([underivedMdfc, filler], undefined, H);
  const front = report.cards.find((c) => c.name === "Underived Front");
  // The `?? true` default is for a name genuinely absent from `resolved`, which cannot happen for
  // a rated card once the lookup goes through the PHYSICAL name -- this card really has no tags.
  expect(front?.derived).toBe(false);
});

// SUPERSEDED 2026-08-28 by `facesCreating`, and kept as the FALLBACK case it now tests. `allParts`
// is a CARD-scoped Scryfall fact that `faceDeckCards` copies onto both faces, so the 2026-08-27 fix
// registered the PHYSICAL name to stop one maker splitting into two "creators". The attribution is
// real now -- the face whose printed text creates the token -- and this fixture stores NO oracle
// text on either face, so no face names it and both stay creators, which is the same answer the
// physical name gave: a maker's own edge is still not a partner.
test("collectTokenNodes keeps BOTH faces as creators when neither face's text names the token", () => {
  const parentName = "Probe Front // Probe Back";
  const allParts = [{ component: "token", name: "Treasure", typeLine: "Token Artifact — Treasure", printingId: "treasure-printing-id" }];
  const front: DeckCard = {
    card: { name: "Probe Front", typeLine: "Creature", oracleText: "", keywords: [], colors: [], manaValue: 2, allParts } as never,
    parentName, face: 0, tags: null,
  };
  const back: DeckCard = {
    card: { name: "Probe Back", typeLine: "Land", oracleText: "", keywords: [], colors: [], manaValue: 2, allParts } as never,
    parentName, face: 1, tags: null,
  };
  const treasureTags: CardTags = {
    oracleId: "token-treasure-probe-oracle", schemaVersion: 1, promptVersion: 1, model: "t",
    characteristics: { types: ["token", "artifact"], subtypes: ["treasure"], colors: [], identity: [], cmc: 0, power: null, toughness: null, token: true, keywords: [] },
    abilities: [],
  };
  const { tokenCreators } = collectTokenNodes(
    [front, back],
    (ref) => (ref.printingId === "treasure-printing-id" ? treasureTags : null),
  );
  expect(tokenCreators.get("token-treasure-probe-oracle")).toEqual(new Set(["Probe Front", "Probe Back"]));
});

// MINOR: pin the commander ruling. Both faces of a two-faced commander read `isCommander: true`
// (the card is the commander whichever face is up), and `COMMANDER_BOOST` therefore applies to
// EITHER face's partners through the same shared `isCommanderNode` helper -- nothing pinned that
// before this fix.
test("MINOR: COMMANDER_BOOST reaches partners of either face of a two-faced commander", () => {
  const dfcCommander = (): DeckCard => ({
    card: {
      name: "Ajani, Nacatl Pariah // Ajani, Nacatl Avenger",
      typeLine: "Legendary Creature — Cat Cleric // Legendary Planeswalker — Ajani",
      oracleText: "a\n// b",
      keywords: [], colors: ["W"], manaValue: 2,
      faces: [
        { name: "Ajani, Nacatl Pariah", typeLine: "Legendary Creature — Cat Cleric", oracleText: "a", manaCost: "{1}{W}", colors: ["W"] },
        { name: "Ajani, Nacatl Avenger", typeLine: "Legendary Planeswalker — Ajani", oracleText: "b", colors: ["W", "G"] },
      ],
    } as never,
    tags: {
      oracleId: "ajani-nacatl-pariah", schemaVersion: 1, promptVersion: 1, model: "t",
      characteristics: {
        types: ["creature"], subtypes: ["cat", "cleric"], colors: ["W"], identity: ["W", "G"], cmc: 2,
        power: "1", toughness: "1", token: false, keywords: [],
        faces: [{ types: ["creature"], subtypes: ["cat", "cleric"] }, { types: ["planeswalker"], subtypes: ["ajani"] }],
      },
      abilities: [
        // Face 0 (front, default): the same Wizard-token maker the standalone commander-boost test
        // above uses -- proves the boost reaches the FRONT face's partner.
        ...inallaAbility,
        // Face 1 (back): an unrelated static pump on goblins -- proves the boost reaches the BACK
        // face's partner too, through the SAME shared `isCommanderNode` helper.
        { face: 1, kind: "static", effect: { kind: "pump", subject: { subtype: "goblin", control: "you", token: null } } },
      ] as unknown as CardTags["abilities"],
    },
  });
  const wizardPayoff = dc("Kindred Discovery", kindredDiscoveryAbility);
  const goblinPayoff = dc("Goblin Grunt", [], ["goblin"]);
  const names = ["Ajani, Nacatl Pariah // Ajani, Nacatl Avenger"];
  const withoutBoost = analyzeDeckStructured([dfcCommander(), wizardPayoff, goblinPayoff], undefined, H);
  const withBoost = analyzeDeckStructured([dfcCommander(), wizardPayoff, goblinPayoff], names, H);

  expect(withBoost.cards.find((c) => c.name === "Ajani, Nacatl Pariah")?.isCommander).toBe(true);
  expect(withBoost.cards.find((c) => c.name === "Ajani, Nacatl Avenger")?.isCommander).toBe(true);

  const wizardNoBoost = withoutBoost.cards.find((c) => c.name === "Kindred Discovery")!;
  const wizardBoosted = withBoost.cards.find((c) => c.name === "Kindred Discovery")!;
  expect(wizardBoosted.score).toBeGreaterThan(wizardNoBoost.score); // front-face boost

  const goblinNoBoost = withoutBoost.cards.find((c) => c.name === "Goblin Grunt")!;
  const goblinBoosted = withBoost.cards.find((c) => c.name === "Goblin Grunt")!;
  expect(goblinBoosted.score).toBeGreaterThan(goblinNoBoost.score); // back-face boost
});

// ============================================================================
// REVIEW FIX ROUND 2 (2026-08-27) -- finding 3's own fix (tokenCreators keyed on physicalName)
// broke `ourMakers`: `uniqueByName` is keyed by FACE name and has no entry under a combined
// "Front // Back" string, so the lookup was always undefined and the whole two-hop pass was
// silently skipped for every two-faced token maker, in both directions.
// ============================================================================

const twoFacedTreasureMaker = (): DeckCard => ({
  card: {
    name: "Maker Front // Maker Back",
    typeLine: "Creature // Land",
    oracleText: "a\n// b",
    keywords: [], colors: [], manaValue: 2,
    faces: [
      { name: "Maker Front", typeLine: "Creature", oracleText: "a", manaCost: "{2}", colors: [] },
      { name: "Maker Back", typeLine: "Land", oracleText: "b", colors: [] },
    ],
    // Shared at the CARD level (faceDeckCards spreads it onto both faces) -- the exact shape that
    // made `tokenCreators` register both face names before finding 3's fix.
    allParts: [{ component: "token", name: "Treasure", typeLine: "Token Artifact — Treasure", printingId: "treasure-printing-id" }],
  } as never,
  tags: {
    oracleId: "maker-front", schemaVersion: 1, promptVersion: 1, model: "t",
    characteristics: {
      types: ["creature", "land"], subtypes: [], colors: [], identity: [], cmc: 2,
      power: null, toughness: null, token: false, keywords: [],
      faces: [{ types: ["creature"], subtypes: [] }, { types: ["land"], subtypes: [] }],
    },
    // Face 0 (front, default): genuinely creates the Treasure. Face 1 (back) has no abilities at
    // all -- it must NOT be the one that ends up "creating" anything.
    abilities: treasureMakerAbility,
  } as CardTags,
});

const treasurePayoff = dc("Treasure Payoff", [{
  kind: "triggered",
  trigger: { verbs: ["enters"], subject: { subtype: "treasure", control: "you", token: null } },
  effect: { kind: "draw-card" },
}]);

test("END-TO-END: a two-faced maker's token creation reaches a payoff through the two-hop path", () => {
  const report = analyzeDeckStructured(
    [twoFacedTreasureMaker(), treasurePayoff], undefined, H, undefined, undefined, undefined,
    (ref) => (ref.printingId === "treasure-printing-id" ? treasureTags : null),
  );
  // Sanity: the token really is on the graph, so the hop below is being tested against the real
  // failure shape and not a vacuous absence.
  expect(report.edges.some((e) => e.a === "Treasure" || e.b === "Treasure")).toBe(true);
  const front = report.cards.find((c) => c.name === "Maker Front")!;
  expect(front.topPartners.some((p) => p.name === "Treasure Payoff")).toBe(true);
  const payoff = report.cards.find((c) => c.name === "Treasure Payoff")!;
  expect(payoff.topPartners.some((p) => p.name === "Maker Front")).toBe(true);
});

// ============================================================================
// WHICH FACE MAKES THE TOKEN. `allParts` is a CARD-scoped Scryfall fact, so before this both faces
// of a two-faced maker counted as creators: the non-creating face drew a false `creates:` edge, and
// the token could never read `hasPartner` off that face's genuine payoff. Attribution is the face's
// own printed text -- the fact the card states -- with a card-scoped FALLBACK when no face names it.
// ============================================================================

const twoFacedNamedMaker = (frontText: string, backText: string): DeckCard => ({
  card: {
    name: "Named Front // Named Back",
    typeLine: "Creature // Creature",
    oracleText: `${frontText}\n${backText}`,
    keywords: [], colors: [], manaValue: 2,
    faces: [
      { name: "Named Front", typeLine: "Creature", oracleText: frontText, manaCost: "{2}", colors: [] },
      { name: "Named Back", typeLine: "Creature", oracleText: backText, colors: [] },
    ],
    allParts: [{ component: "token", name: "Treasure", typeLine: "Token Artifact — Treasure", printingId: "treasure-printing-id" }],
  } as never,
  tags: {
    oracleId: "named-front", schemaVersion: 1, promptVersion: 1, model: "t",
    characteristics: {
      types: ["creature"], subtypes: [], colors: [], identity: [], cmc: 2,
      power: null, toughness: null, token: false, keywords: [],
      faces: [{ types: ["creature"], subtypes: [] }, { types: ["creature"], subtypes: [] }],
    },
    abilities: [
      ...treasureMakerAbility,
      // The PAYOFF, printed on the back face: a token supplies its own `enters` and no `sacrifice`,
      // so an outlet-shaped trigger would form no edge and the test would pass vacuously.
      { kind: "triggered", trigger: { verbs: ["enters"], subject: { subtype: "treasure", control: "you", token: null } }, effect: { kind: "draw-card" }, face: 1 },
    ] as unknown as CardTags["abilities"],
  } as CardTags,
});

test("only the FACE that prints the token creates it", () => {
  const { producerTokenOracles, tokenCreators } = collectTokenNodes(
    faceDeckCards(twoFacedNamedMaker("When this creature enters, create a Treasure token.", "Sacrifice an artifact: draw a card.")),
    (ref) => (ref.printingId === "treasure-printing-id" ? treasureTags : null),
  );
  expect(producerTokenOracles.get("Named Front")).toEqual(new Set(["token-treasure-oracle"]));
  expect(producerTokenOracles.get("Named Back")).toBeUndefined();
  // Keyed by FACE now that the attribution is per face: the partner scan asks "is this endpoint the
  // maker", and the maker is a face.
  expect(tokenCreators.get("token-treasure-oracle")).toEqual(new Set(["Named Front"]));
});

test("...and when NO face names it, every face stays a creator — the conservative fallback", () => {
  // Scryfall's typeless "Copy" row is never named in printed text, and a card whose text was never
  // stored names nothing either. Refusing every face would make the token read partnered off its
  // own maker, which is the over-claim this scan exists to avoid.
  const { tokenCreators } = collectTokenNodes(
    faceDeckCards(twoFacedNamedMaker("When this creature enters, do nothing.", "Sacrifice an artifact: draw a card.")),
    (ref) => (ref.printingId === "treasure-printing-id" ? treasureTags : null),
  );
  expect(tokenCreators.get("token-treasure-oracle")).toEqual(new Set(["Named Front", "Named Back"]));
});

test("END-TO-END: a token read as unpartnered because its maker's OTHER face is the payoff", () => {
  const report = analyzeDeckStructured(
    [twoFacedNamedMaker("When this creature enters, create a Treasure token.", "Whenever a Treasure enters, draw a card."), dc("Filler", [])],
    undefined, H, undefined, undefined, undefined,
    (ref) => (ref.printingId === "treasure-printing-id" ? treasureTags : null),
  );
  const treasure = report.tokenNodes?.find((t) => t.name === "Treasure");
  expect(treasure).toBeDefined();
  expect(treasure!.hasPartner).toBe(true);
});
