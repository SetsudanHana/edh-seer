import { expect, test } from "vitest";
import { analyzeDeckStructured } from "./analyze.js";
import { SEED_IMPACT_WEIGHTS } from "@mtg/engine";
import type { TagStats } from "@mtg/engine";
import type { CardTags } from "@mtg/tagger";
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

import { ComboIndex } from "@mtg/engine";

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
