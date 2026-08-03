import { expect, test } from "vitest";
import type { CardTags } from "@mtg/tagger";
import type { Hierarchy } from "./types.js";
import { buildCensus } from "./census.js";

const H: Hierarchy = { wizard: ["creature"], zombie: ["creature"] };

const card = (id: string, abilities: CardTags["abilities"], types = ["creature"], subtypes: string[] = []): CardTags => ({
  oracleId: id, schemaVersion: 1, promptVersion: 1, model: "t",
  characteristics: { types, subtypes, colors: [], identity: [], cmc: 0, power: null, toughness: null, token: false, keywords: [] },
  abilities,
});

const row = (rows: ReturnType<typeof buildCensus>["consumers"], key: string) => rows.find((r) => r.key === key);

/** The whole point of the census: supply is counted under the engine's subsumption rules, not
 *  key equality. A specific producer must count as supply for a general consumer, and must NOT
 *  count for a sibling consumer it cannot satisfy. Counting on exact keys would report the
 *  general consumer as an unsupplied hole and the specific producer as a dead emission — both
 *  false, and both exactly the kind of "missing" claim this tool exists to make.
 */
test("supply counts a specific producer for a general consumer, but not for a sibling", () => {
  const maker = card("maker", [{
    kind: "triggered",
    trigger: { verbs: ["cast"], subject: { type: "instant", control: "you", token: null } },
    effect: { kind: "token-generation", subject: { subtype: "wizard", control: "you", token: true } },
    emits: [{ verb: "enters", subject: { subtype: "wizard", control: "you", token: true } }],
  }]);
  const general = card("general", [{
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { type: "creature", control: "you", token: null } },
    effect: { kind: "draw-card" },
  }]);
  const sibling = card("sibling", [{
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { type: "artifact", control: "you", token: null } },
    effect: { kind: "draw-card" },
  }]);

  const c = buildCensus([maker, general, sibling], H);
  expect(c.cards).toBe(3);

  // The wizard-token emit supplies the creature-ETB listener...
  expect(row(c.consumers, "enters:creature")!.counterpart).toBeGreaterThan(0);
  // ...and nothing supplies the artifact-ETB listener (all three cards are creatures).
  expect(row(c.consumers, "enters:artifact")).toMatchObject({ cards: 1, counterpart: 0 });
});

test("a card is counted once per key however many abilities carry it", () => {
  const twice = card("twice", [
    { kind: "triggered", trigger: { verbs: ["enters"], subject: { type: "creature", control: "you", token: null } }, effect: { kind: "draw-card" } },
    { kind: "triggered", trigger: { verbs: ["enters"], subject: { type: "creature", control: "you", token: null } }, effect: { kind: "lifegain" } },
  ]);
  expect(row(buildCensus([twice], H).consumers, "enters:creature")!.cards).toBe(1);
});

/** Rolling up on the first type alone merged 16 differently-broad consumer shapes onto
 *  `cast:instant` and unioned their supplier sets, inflating that row to 19277. Breadth must be
 *  part of the key. */
test("consumer shapes of different breadth get different keys", () => {
  const narrow = card("narrow", [{
    kind: "triggered",
    trigger: { verbs: ["cast"], subject: { type: ["instant", "sorcery"], control: "you", token: null } },
    effect: { kind: "draw-card" },
  }]);
  const broad = card("broad", [{
    kind: "triggered",
    trigger: { verbs: ["cast"], subject: { type: ["instant", "sorcery", "artifact"], control: "you", token: null } },
    effect: { kind: "draw-card" },
  }]);
  const c = buildCensus([narrow, broad], H);
  expect(row(c.consumers, "cast:instant+sorcery")).toMatchObject({ cards: 1, shapes: 1 });
  expect(row(c.consumers, "cast:artifact+instant+sorcery")).toMatchObject({ cards: 1, shapes: 1 });
});

test("member order does not split a row", () => {
  const a = card("a", [{ kind: "triggered", trigger: { verbs: ["cast"], subject: { type: ["instant", "sorcery"], control: "you", token: null } }, effect: { kind: "draw-card" } }]);
  const b = card("b", [{ kind: "triggered", trigger: { verbs: ["cast"], subject: { type: ["sorcery", "instant"], control: "you", token: null } }, effect: { kind: "draw-card" } }]);
  expect(row(buildCensus([a, b], H).consumers, "cast:instant+sorcery")).toMatchObject({ cards: 2, shapes: 2 });
});

/** Attacking is a normal game action. A typal attack payoff gets real edges from the creatures
 *  that satisfy it; a generic "whenever a creature you control attacks" must NOT be supplied from
 *  every creature in the corpus, or the graph gains a mesh with no information in it. */
test("implied combat supplies a typal attack payoff but not a generic one", () => {
  const samurai = card("samurai", [], ["creature"], ["samurai"]);
  const typalPayoff = card("typal", [{
    kind: "triggered",
    trigger: { verbs: ["attacks"], subject: { subtype: ["samurai"], control: "you", token: null } },
    effect: { kind: "pump" },
  }]);
  const genericPayoff = card("generic", [{
    kind: "triggered",
    trigger: { verbs: ["attacks"], subject: { control: "you", token: null } },
    effect: { kind: "pump" },
  }]);
  const vacuousPayoff = card("vacuous", [{
    kind: "triggered",
    trigger: { verbs: ["attacks"], subject: { type: "creature", control: "you", token: null } },
    effect: { kind: "pump" },
  }]);

  const c = buildCensus([samurai, typalPayoff, genericPayoff, vacuousPayoff], { ...H, samurai: ["creature"] });
  expect(row(c.consumers, "attacks:samurai")).toMatchObject({ counterpart: 1, selfSupplied: false });
  // `type: creature` narrows nothing on an attack trigger — only creatures attack.
  expect(row(c.consumers, "attacks:any")).toMatchObject({ counterpart: 0, selfSupplied: true });
  expect(row(c.consumers, "attacks:creature")).toMatchObject({ counterpart: 0, selfSupplied: true });
});

test("producer rows report dead emissions — an emit no trigger in the corpus matches", () => {
  const emitter = card("emitter", [{
    kind: "triggered",
    trigger: { verbs: ["attacks"], subject: { type: "creature", control: "you", token: null } },
    effect: { kind: "mana-generation" },
    emits: [{ verb: "mill", subject: { type: "creature", control: "opp", token: null } }],
  }]);
  const mill = row(buildCensus([emitter], H).producers, "mill:creature")!;
  expect(mill).toMatchObject({ cards: 1, counterpart: 0, authored: true });
});

/** Every creature implies an attack, so most `attacks:<subtype>` keys have emitters and no
 *  listener. Reporting those as dead extraction buries the authored emits that actually indicate
 *  a problem — 572 derived rows against 1 real one on the live corpus. */
test("derived events are not reported as authored emissions", () => {
  const bear = card("bear", [], ["creature"], ["spirit"]);
  const rows = buildCensus([bear], { ...H, spirit: ["creature"] }).producers;
  expect(row(rows, "attacks:spirit")).toMatchObject({ cards: 1, counterpart: 0, authored: false });
  expect(row(rows, "cast:spirit")).toMatchObject({ authored: false });
});

/** `dies` and `enters-graveyard` are legacy spellings that `normalizeZoneEvent` rewrites. Both
 *  sides must be normalized or the census reports every `dies` listener as unsupplied — the exact
 *  artifact that made the first throwaway version of this tool claim 517 phantom holes. */
test("zone-transition aliases are normalized on both sides", () => {
  const sacOutlet = card("sac", [{
    kind: "activated",
    effect: { kind: "forced-sacrifice", subject: { type: "creature", control: "you", token: null } },
    emits: [{ verb: "dies", subject: { type: "creature", control: "you", token: null } }],
  }]);
  const payoff = card("payoff", [{
    kind: "triggered",
    trigger: { verbs: ["dies"], subject: { type: "creature", control: "you", token: null } },
    effect: { kind: "drain" },
  }]);
  const c = buildCensus([sacOutlet, payoff], H);
  expect(row(c.consumers, "dies:creature")).toMatchObject({ cards: 1, counterpart: 1 });
});
