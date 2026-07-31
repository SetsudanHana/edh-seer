import { expect, test } from "vitest";
import { analyzeDeckStructured } from "./analyze.js";
import { SEED_IMPACT_WEIGHTS, dampByAlpha } from "@mtg/engine";
import type { CardTags } from "@mtg/tagger";
import type { DeckCard, Hierarchy } from "./types.js";

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
  // Both also share a 4th edge with each other (Kindred and Tremors are themselves untyped
  // creatures, so each's own "enters" satisfies the other's enters:creature trigger).
  // impactEdgeWeight dedupes by reason TAG keeping the MAX-impact reason, and that shared
  // Kindred-Tremors edge carries two same-tag reasons (draw-card 1.0, damage 0.2) that collapse
  // to the higher one — draw-card's 1.0 — added identically to both totals:
  //   kindredTotal = 3×draw-card(1.0) + draw-card(1.0) = 4.0
  //   tremorsTotal = 3×damage(0.2)    + draw-card(1.0) = 1.6
  // giving ratio 2.5, not the naive draw-card/damage = 5 (which would hold only if Kindred and
  // Tremors didn't also synergize with each other).
  const draw = SEED_IMPACT_WEIGHTS.kinds["draw-card"];
  const dmg = SEED_IMPACT_WEIGHTS.kinds["damage"];
  const shared = Math.max(draw, dmg);
  const expectedRatio = (3 * draw + shared) / (3 * dmg + shared);
  expect(kScore / tScore).toBeCloseTo(expectedRatio, 5);
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
