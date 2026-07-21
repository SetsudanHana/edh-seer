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
  // impactEdgeWeight dedupes by reason TAG (not effectKind), and that shared Kindred-Tremors
  // edge carries two same-tag reasons (draw-card, damage) that collapse to one — the first
  // reason produced by pairReasons, damage's 0.2 — added identically to both totals:
  //   kindredTotal = 3×draw-card(1.0) + damage(0.2) = 3.2
  //   tremorsTotal = 3×damage(0.2)    + damage(0.2) = 0.8
  // giving ratio 4, not the naive draw-card/damage = 5 (which would hold only if Kindred and
  // Tremors didn't also synergize with each other).
  const draw = SEED_IMPACT_WEIGHTS.kinds["draw-card"];
  const dmg = SEED_IMPACT_WEIGHTS.kinds["damage"];
  const expectedRatio = (3 * draw + dmg) / (3 * dmg + dmg);
  expect(kScore / tScore).toBeCloseTo(expectedRatio, 5);
});
