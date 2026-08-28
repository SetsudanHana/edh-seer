import { expect, test } from "vitest";
import type { CardTags } from "@edh-seer/tagger";
import type { Hierarchy } from "./types.js";
import { buildCensus } from "./census.js";

const H: Hierarchy = { wizard: ["creature"], zombie: ["creature"] };

const card = (
  id: string,
  abilities: CardTags["abilities"],
  types = ["creature"],
  subtypes: string[] = [],
  power: string | null = null,
): CardTags => ({
  oracleId: id, schemaVersion: 1, promptVersion: 1, model: "t",
  characteristics: { types, subtypes, colors: [], identity: [], cmc: 0, power, toughness: power, token: false, keywords: [] },
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
  expect(row(c.consumers, "enters:type:creature")!.counterpart).toBeGreaterThan(0);
  // ...and nothing supplies the artifact-ETB listener (all three cards are creatures).
  expect(row(c.consumers, "enters:type:artifact")).toMatchObject({ cards: 1, counterpart: 0 });
});

test("a card is counted once per key however many abilities carry it", () => {
  const twice = card("twice", [
    { kind: "triggered", trigger: { verbs: ["enters"], subject: { type: "creature", control: "you", token: null } }, effect: { kind: "draw-card" } },
    { kind: "triggered", trigger: { verbs: ["enters"], subject: { type: "creature", control: "you", token: null } }, effect: { kind: "lifegain" } },
  ]);
  expect(row(buildCensus([twice], H).consumers, "enters:type:creature")!.cards).toBe(1);
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
  expect(row(c.consumers, "cast:type:instant+sorcery")).toMatchObject({ cards: 1, shapes: 1 });
  expect(row(c.consumers, "cast:type:artifact+instant+sorcery")).toMatchObject({ cards: 1, shapes: 1 });
});

test("member order does not split a row", () => {
  const a = card("a", [{ kind: "triggered", trigger: { verbs: ["cast"], subject: { type: ["instant", "sorcery"], control: "you", token: null } }, effect: { kind: "draw-card" } }]);
  const b = card("b", [{ kind: "triggered", trigger: { verbs: ["cast"], subject: { type: ["sorcery", "instant"], control: "you", token: null } }, effect: { kind: "draw-card" } }]);
  expect(row(buildCensus([a, b], H).consumers, "cast:type:instant+sorcery")).toMatchObject({ cards: 2, shapes: 2 });
});

/** A subtype-derived key and a type-derived key must never collide: a tagger mis-extraction with
 *  `subtype: "creature"` used to roll up into the same row as `type: "creature"` shapes and drag
 *  correctly self-supplied listeners into the SATURATED table. */
test("a subtype-derived key and a type-derived key of the same name do not collide", () => {
  const bySubtype = card("bySubtype", [{
    kind: "triggered",
    trigger: { verbs: ["attacks"], subject: { subtype: "creature", control: "you", token: null } },
    effect: { kind: "pump" },
  }]);
  const byType = card("byType", [{
    kind: "triggered",
    trigger: { verbs: ["attacks"], subject: { type: "creature", control: "you", token: null } },
    effect: { kind: "pump" },
  }]);
  const c = buildCensus([bySubtype, byType], H);
  expect(row(c.consumers, "attacks:subtype:creature")).toMatchObject({ cards: 1, selfSupplied: false });
  expect(row(c.consumers, "attacks:type:creature")).toMatchObject({ cards: 1, selfSupplied: true });
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
  expect(row(c.consumers, "attacks:subtype:samurai")).toMatchObject({ counterpart: 1, selfSupplied: false });
  // `type: creature` narrows nothing on an attack trigger — only creatures attack.
  expect(row(c.consumers, "attacks:any")).toMatchObject({ counterpart: 0, selfSupplied: true });
  expect(row(c.consumers, "attacks:type:creature")).toMatchObject({ counterpart: 0, selfSupplied: true });
});

/** Fix 2a: a combat consumer that narrows via stats, counter, chosenType, colors, or a non-
 *  wildcarded token filter is a real typal/statistical payoff and must receive supply — it was
 *  wrongly treated as self-supplied before because only `subtype` counted as narrowing. */
test("a stats-narrowed combat trigger (power 4+) receives supply, unlike the bare case", () => {
  // Power matters: `parseStat` maps a null printed power to 0, so a vanilla fixture would fail
  // `power >= 4` and the row would read as unsupplied for the wrong reason.
  const bigAttacker = card("bigAttacker", [], ["creature"], [], "5");
  const smallAttacker = card("smallAttacker", [], ["creature"], [], "1");
  const statsPayoff = card("statsPayoff", [{
    kind: "triggered",
    trigger: {
      verbs: ["attacks"],
      subject: { type: "creature", control: "you", token: null, stats: [{ metric: "power", op: "gte", value: 4 }] },
    },
    effect: { kind: "pump" },
  }]);
  const c = buildCensus([bigAttacker, smallAttacker, statsPayoff], H);
  // Narrowed off the type line, so it gets its own row rather than merging with bare combat rows.
  const r = row(c.consumers, "attacks:type:creature (narrowed)")!;
  expect(r).toMatchObject({ selfSupplied: false });
  // Exactly the 5-power creature supplies it; the 1-power one does not.
  expect(r.counterpart).toBe(1);
});

/** Fix 2b: an AUTHORED attacks emit (goad, Mage Slayer, Saskia) is real information for a generic
 *  combat consumer -- unlike the implied "any creature can attack" event, it must form an edge. */
test("an authored attacks emit supplies a generic combat consumer even though an implied one would not", () => {
  const goader = card("goader", [{
    kind: "activated", cost: "{1}",
    effect: { kind: "forced-sacrifice" },
    emits: [{ verb: "attacks", subject: { control: "opp", token: null } }],
  }]);
  const genericPayoff2 = card("genericPayoff2", [{
    kind: "triggered",
    trigger: { verbs: ["attacks"], subject: { control: "any", token: null } },
    effect: { kind: "pump" },
  }]);
  const c = buildCensus([goader, genericPayoff2], H);
  // The row is still (by design) one an implied producer alone could satisfy -- selfSupplied
  // reflects that hypothetical, independent of the authored supply this producer also provides.
  expect(row(c.consumers, "attacks:any")).toMatchObject({ counterpart: 1, selfSupplied: true });
});

test("producer rows report dead emissions — an emit no trigger in the corpus matches", () => {
  const emitter = card("emitter", [{
    kind: "triggered",
    trigger: { verbs: ["attacks"], subject: { type: "creature", control: "you", token: null } },
    effect: { kind: "mana-generation" },
    emits: [{ verb: "mill", subject: { type: "creature", control: "opp", token: null } }],
  }]);
  const mill = row(buildCensus([emitter], H).producers, "mill:type:creature")!;
  expect(mill).toMatchObject({ cards: 1, counterpart: 0, authored: true });
});

/** Every creature implies an attack, so most `attacks:<subtype>` keys have emitters and no
 *  listener. Reporting those as dead extraction buries the authored emits that actually indicate
 *  a problem — 572 derived rows against 1 real one on the live corpus. */
test("derived events are not reported as authored emissions", () => {
  const bear = card("bear", [], ["creature"], ["spirit"]);
  const rows = buildCensus([bear], { ...H, spirit: ["creature"] }).producers;
  expect(row(rows, "attacks:subtype:spirit")).toMatchObject({ cards: 1, counterpart: 0, authored: false });
  expect(row(rows, "cast:subtype:spirit")).toMatchObject({ authored: false });
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
  expect(row(c.consumers, "dies:type:creature")).toMatchObject({ cards: 1, counterpart: 1 });
});

/** `censusSubjectKey` encodes only type/subtype, but `combatSelfSupplied` also reads stats, counter,
 *  chosenType, colors and token. Two shapes sharing a key while disagreeing on selfSupplied get
 *  AND-merged by rollUp, so ONE narrowed shape flipped the whole row -- which on the live corpus
 *  emptied the SELF-SUPPLIED table, reporting 1463 correctly self-supplied `attacks:any` listeners
 *  as a dense low-information edge class. The narrowed shape must get its own row. */
test("a narrowed combat trigger does not drag its bare siblings out of SELF-SUPPLIED", () => {
  const bare = card("bare", [{
    kind: "triggered",
    trigger: { verbs: ["attacks"], subject: { control: "you", token: null } },
    effect: { kind: "pump" },
  }]);
  const alsoBare = card("alsoBare", [{
    kind: "triggered",
    trigger: { verbs: ["attacks"], subject: { control: "you", token: null } },
    effect: { kind: "draw-card" },
  }]);
  // Garruk's Uprising: same type/subtype shape as the bare ones, but power 4+ is a real condition.
  const narrowed = card("narrowed", [{
    kind: "triggered",
    trigger: {
      verbs: ["attacks"],
      subject: { control: "you", token: null, stats: [{ metric: "power", op: "gte", value: 4 }] },
    },
    effect: { kind: "draw-card" },
  }]);
  const attacker = card("attacker", [], ["creature"], [], "5");

  const c = buildCensus([bare, alsoBare, narrowed, attacker], H);
  expect(row(c.consumers, "attacks:any")).toMatchObject({ cards: 2, selfSupplied: true, counterpart: 0 });
  const narrowedRow = row(c.consumers, "attacks:any (narrowed)")!;
  expect(narrowedRow).toMatchObject({ cards: 1, selfSupplied: false });
  expect(narrowedRow.counterpart).toBeGreaterThan(0);
});

/** Only combat rows split; every other verb's key must be untouched by the marker. */
test("non-combat consumer keys carry no narrowed marker", () => {
  const etb = card("etb", [{
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { type: "creature", control: "you", token: null, stats: [{ metric: "power", op: "gte", value: 4 }] } },
    effect: { kind: "draw-card" },
  }]);
  const keys = buildCensus([etb], H).consumers.map((r) => r.key);
  expect(keys).toContain("enters:type:creature");
  expect(keys.some((k) => k.includes("narrowed"))).toBe(false);
});

/** `token: false` means "nontoken", which nearly every creature already is — so it is not a real
 *  condition and must not pull implied edges from the whole creature pool. `token: true` is real:
 *  every implied event carries `token: false` (selfSubject stamps it), so a token-demanding consumer
 *  correctly gets no implied supply and shows up as a genuine hole. */
test("token:false is not a narrowing condition, token:true is", () => {
  const attacker = card("attacker", [], ["creature"], [], "2");
  const nontokenPayoff = card("nontokenPayoff", [{
    kind: "triggered",
    trigger: { verbs: ["attacks"], subject: { type: "creature", control: "you", token: false } },
    effect: { kind: "pump" },
  }]);
  const tokenPayoff = card("tokenPayoff", [{
    kind: "triggered",
    trigger: { verbs: ["attacks"], subject: { type: "creature", control: "you", token: true } },
    effect: { kind: "pump" },
  }]);

  const c = buildCensus([attacker, nontokenPayoff, tokenPayoff], H);
  // Nontoken: the game supplies it, so it merges into the bare row and draws no implied edges.
  expect(row(c.consumers, "attacks:type:creature")).toMatchObject({ selfSupplied: true, counterpart: 0 });
  // Token-demanding: a real condition, own row, and unsupplied because we don't model tokens attacking.
  expect(row(c.consumers, "attacks:type:creature (narrowed)")).toMatchObject({ selfSupplied: false, counterpart: 0 });
});
