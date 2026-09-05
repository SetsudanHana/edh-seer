import { expect, test, vi } from "vitest";
import type { CardTags } from "@edh-seer/tagger";
import type { DeckCard, Hierarchy } from "../types.js";
import {
  KEEP, PARTNER_SHARD_COUNT, PER_EVENT_CAP, buildPartnerArtifact, demandForms, eventKey, isSubstantive,
  partnerShardOf, partnersFor, resolveSlugs, slugOf, specificity, supplyCounts,
  supplyForms, supplyKeysOf, themesOf, unmetDemands, boardCountKeysOf, emitKeysOf, abilityRowsOf, staticKeysOf, meldKeysOf, identityKeyOf, demandKeysOf,
} from "./partners-core.js";

test("a slug is lowercase, punctuation-free and hyphen-joined", () => {
  expect(slugOf("Krenko, Mob Boss")).toBe("krenko-mob-boss");
  expect(slugOf("Ajani's Chosen")).toBe("ajanis-chosen");
  expect(slugOf("Fire // Ice")).toBe("fire-ice");
});

/** DIACRITICS ARE FOLDED, NOT STRIPPED. `Jötun Grunt` has to read as `jotun-grunt`; dropping the
 *  character instead gives `jtun-grunt`, which is a URL nobody would guess and nobody can search. */
test("a diacritic folds to its base letter", () => {
  expect(slugOf("Jötun Grunt")).toBe("jotun-grunt");
  expect(slugOf("Æther Vial")).toBe("aether-vial");
  expect(slugOf("Lim-Dûl's Vault")).toBe("lim-duls-vault");
});

/** A NAME THAT SLUGS TO NOTHING STILL NEEDS A URL, AND IT MUST NOT BE "".
 *
 *  `/cards/` with nothing after it is the card SEARCH route, so an empty slug does not 404 -- it
 *  serves a different page, which is worse. MEASURED over the corpus on 2026-09-04: two cards hit
 *  this, `_____` and `______`, whose names are entirely underscores. Uniqueness alone would have
 *  given one of them "" and the other "-2", and both are wrong. */
test("a name with nothing sluggable never yields the empty slug", () => {
  expect(slugOf("///")).toBe("");
  const m = resolveSlugs(["_____", "______"]);
  expect([...m.values()].sort()).toEqual(["card", "card-2"]);
  expect([...m.values()]).not.toContain("");
});

test("colliding names get a deterministic discriminator, ordered by sorted name", () => {
  const m = resolveSlugs(["Fire, Ice", "Fire // Ice"]);
  expect(m.get("Fire // Ice")).toBe("fire-ice");
  expect(m.get("Fire, Ice")).toBe("fire-ice-2");
});

/** THE ANSWER MUST NOT DEPEND ON CORPUS ITERATION ORDER. `build-static.ts` reads Mongo, and a
 *  rebuild that returned the same cards in a different order would otherwise swap two cards' URLs
 *  -- silently, and only for the pair that collided. */
test("collision resolution does not depend on input order", () => {
  const a = resolveSlugs(["Fire, Ice", "Fire // Ice"]);
  const b = resolveSlugs(["Fire // Ice", "Fire, Ice"]);
  expect([...a].sort()).toEqual([...b].sort());
});

test("an event key names the verb and the subject it is about", () => {
  expect(eventKey({ verb: "enters", subject: { control: "you", token: null, type: "creature", subtype: "goblin" } } as never))
    .toBe("enters|creature|goblin|-");
  expect(eventKey({ verb: "draw", subject: { control: "you", token: null } } as never))
    .toBe("draw|-|-|-");
});

/** `type` AND `subtype` ARE `string | string[]` IN THE SCHEMA. An array is sorted before joining so
 *  ["instant","sorcery"] and ["sorcery","instant"] count as one event and not two. */
test("an array-valued type is order-independent", () => {
  const a = eventKey({ verb: "cast", subject: { control: "you", token: null, type: ["instant", "sorcery"] } } as never);
  const b = eventKey({ verb: "cast", subject: { control: "you", token: null, type: ["sorcery", "instant"] } } as never);
  expect(a).toBe(b);
  expect(a).toBe("cast|instant,sorcery|-|-");
});

/** SPECIFICITY IS THE WHOLE RANKING. A rare event is a precise interaction; a universal one is
 *  noise. The numbers here are the measured corpus frequencies, so this test would notice a scoring
 *  change that reordered the two cases the design was argued from. */
test("a rarer event scores higher than a common one", () => {
  const freq = { "enters|creature|-|-": 1909, "enters|creature|goblin|-": 41 };
  expect(specificity("enters|creature|goblin|-", freq))
    .toBeGreaterThan(specificity("enters|creature|-|-", freq));
});

/** AN UNSEEN KEY SCORES AS ONE MEMBER, NOT AS MAXIMALLY RARE. `gen-theme-stats` recorded exactly
 *  this trap: an absent tag scored `log(N+1)`, the maximum, so every tag the derived layer invented
 *  after the artifact was built looked rarest and took the axis. One member is the floor. */
test("an event the table has never seen scores as if it had one member", () => {
  expect(specificity("never|seen|-", {})).toBe(specificity("x", { x: 1 }));
});

test("a key with one member outranks a key with a thousand", () => {
  const freq = { rare: 1, common: 1000 };
  expect(specificity("rare", freq)).toBeGreaterThan(specificity("common", freq));
});

/** COUNTING SUPPLIERS, NOT KEY STRINGS. The old metric counted how many cards shared an identical
 *  key; measured over the real corpus it put `enters|battle,creature,enchantment,land,planeswalker|-`
 *  -- a demand that fires on essentially any permanent -- at the TOP for 1,402 cards, because that
 *  exact string is rare even though the demand is not. */
test("a demand naming many types is counted as broad, not as rare", () => {
  const rows = [
    { emits: ["enters|creature|goblin|-"], demands: [] },
    { emits: ["enters|land|-|-"], demands: [] },
    { emits: ["enters|enchantment|-"], demands: [] },
    { emits: [], demands: ["enters|creature,land,enchantment|-|-", "enters|creature|goblin|-"] },
  ];
  const freq = supplyCounts(rows);
  expect(freq["enters|creature,land,enchantment|-|-"]).toBe(3);
  expect(freq["enters|creature|goblin|-"]).toBe(1);
  expect(specificity("enters|creature|goblin|-", freq))
    .toBeGreaterThan(specificity("enters|creature,land,enchantment|-|-", freq));
});

/** A DEMAND IS NEVER WIDENED. `enters|-|goblin` means a goblin entering; counting every permanent as
 *  satisfying it would rebuild the bug this replaced. */
test("a subtype demand is satisfied only by that subtype", () => {
  const freq = supplyCounts([
    { emits: ["enters|creature|goblin|-"], demands: [] },
    { emits: ["enters|creature|elf|-"], demands: [] },
    { emits: ["enters|artifact|-"], demands: [] },
    { emits: [], demands: ["enters|-|goblin|-", "enters|-|-|-"] },
  ]);
  expect(freq["enters|-|goblin|-"]).toBe(1);
  // The bare form IS satisfied by everything that enters, and must score accordingly.
  expect(freq["enters|-|-|-"]).toBe(3);
});

test("a supply form covers the coarser demands it satisfies, a demand form only splits", () => {
  expect(supplyForms("enters|creature|goblin|-").sort())
    .toEqual(["enters|-|-|-", "enters|-|-|n", "enters|-|goblin|-", "enters|-|goblin|n",
      "enters|creature|-|-", "enters|creature|-|n", "enters|creature|goblin|-", "enters|creature|goblin|n"]);
  expect(demandForms("enters|creature,land|-|-").sort())
    .toEqual(["enters|creature|-|-", "enters|land|-|-"]);
  expect(demandForms("enters|-|goblin|-")).toEqual(["enters|-|goblin|-"]);
});

// ---------------------------------------------------------------------------------------------
// partnersFor: rank by specificity, VERIFY with the engine.
// ---------------------------------------------------------------------------------------------

const H: Hierarchy = { goblin: ["creature"] };

/** Same shape as `edges.test.ts`'s own `base()`, including the cast it documents: `as
 *  DeckCard["card"]` and not `as never`, because `as never` erases `card.name` for every reader
 *  below -- tsc flags it while vitest runs happily, the recorded "a green suite is not a compiling
 *  one" trap. */
const base = (name: string, abilities: CardTags["abilities"], subtypes: string[] = []) => ({
  card: { name, typeLine: "", oracleText: "", keywords: [], colors: [], manaValue: 0 } as unknown as DeckCard["card"],
  tags: {
    oracleId: name, schemaVersion: 1, promptVersion: 1, model: "t",
    characteristics: { types: ["creature"], subtypes, colors: [], identity: [], cmc: 0, power: null, toughness: null, token: false, keywords: [] },
    abilities,
  } as CardTags,
});

/** THE REAL DERIVED SHAPES, read out of `cardTagsDerived` on 2026-09-04 rather than invented -- an
 *  invented fixture proves the function agrees with itself. */
const krenko = base("Krenko, Mob Boss", [{
  kind: "activated", cost: "{T}",
  effect: { kind: "token-generation", subject: { control: "any", token: true, type: "creature", subtype: "goblin" } },
  emits: [
    { verb: "create-token", subject: { control: "you", token: true, type: "creature", subtype: "goblin" } },
    { verb: "enters", subject: { control: "you", token: true, type: "creature", subtype: "goblin" } },
  ],
}] as unknown as CardTags["abilities"], ["goblin"]);

const impactTremors = base("Impact Tremors", [{
  kind: "triggered",
  trigger: { verbs: ["enters"], subject: { type: "creature", control: "you", token: null } },
  effect: { kind: "deal-damage" },
}] as unknown as CardTags["abilities"]);

/** A card that DEMANDS NOTHING KRENKO SUPPLIES. It shares no event key, so it never reaches the
 *  verification phase at all. */
const millstone = base("Millstone", [{
  kind: "triggered",
  trigger: { verbs: ["upkeep"], subject: { control: "you", token: null } },
  effect: { kind: "mill" },
}] as unknown as CardTags["abilities"]);

const FREQ = { "enters|creature|goblin|-": 41, "enters|creature|-|-": 1909, "create-token|creature|goblin|-": 63 };
const SLUGS = resolveSlugs(["Impact Tremors", "Millstone", "Krenko, Mob Boss"]);

test("a verified partner carries the engine's own reason sentence", () => {
  const { rows } = partnersFor(krenko, [impactTremors], [], FREQ, SLUGS, H);
  expect(rows).toHaveLength(1);
  expect(rows[0]!.name).toBe("Impact Tremors");
  expect(rows[0]!.slug).toBe("impact-tremors");
  // NOT a sentence this module composed: `directedReasons` wrote it, and it names both cards.
  expect(rows[0]!.reason).toContain("Impact Tremors");
  expect(rows[0]!.reason).toContain("Krenko");
});

/** THE RANKING SELECTS, THE ENGINE DECIDES. A card sharing no event key never even reaches
 *  verification, so it cannot appear at any score. */
test("a card that demands nothing the subject supplies is absent, not ranked low", () => {
  expect(partnersFor(krenko, [millstone], [], FREQ, SLUGS, H).rows).toEqual([]);
});

/** THE POINT OF VERIFYING. A key match is necessary and NOT sufficient -- if `directedReasons`
 *  finds no reason the row is dropped, so this artifact can never claim an edge the deck report
 *  would not also draw. */
test("a key match with no engine reason is dropped", () => {
  const noReason = base("Shape Sharer", [{
    kind: "triggered",
    // Same verb and type as Krenko's emit, but it wants a creature an OPPONENT controls.
    trigger: { verbs: ["enters"], subject: { type: "creature", control: "opp", token: null } },
    effect: { kind: "draw-card" },
  }] as unknown as CardTags["abilities"]);
  const slugs = resolveSlugs(["Shape Sharer"]);
  expect(partnersFor(krenko, [noReason], [], FREQ, slugs, H).rows).toEqual([]);
});

/** THE CAP THAT ACTUALLY BINDS on a crowd of identical demands. All 34 payoffs here share
 *  `enters|creature|-` and score identically, so PER_EVENT_CAP cuts before KEEP ever does -- and
 *  `pool` reports the full crowd so the page can say what it withheld. */
test("one event may occupy only PER_EVENT_CAP rows, and pool counts the rest", () => {
  const many = Array.from({ length: KEEP + 10 }, (_, i) => base(`Payoff ${i}`, [{
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { type: "creature", control: "you", token: null } },
    effect: { kind: "draw-card" },
  }] as unknown as CardTags["abilities"]));
  const slugs = resolveSlugs(many.map((m) => m.card.name));
  const { rows, pool } = partnersFor(krenko, many, [], FREQ, slugs, H);
  expect(rows.length).toBe(PER_EVENT_CAP);
  expect(pool["enters|creature|-|-"]).toBe(KEEP + 10);
});

/** A CARD IS NEVER ITS OWN PARTNER. `directedReasons(x, x)` can return reasons -- self-reference is
 *  the biggest defect family this engine has had -- so the exclusion is explicit. */
test("the subject is not its own partner", () => {
  expect(partnersFor(krenko, [krenko], [], FREQ, SLUGS, H).rows).toEqual([]);
});

/** THE BUG THE FIXTURES FOUND, PINNED. Krenko emits `enters|creature|goblin`; Impact Tremors demands
 *  `enters|creature|-`. A goblin token entering IS a creature entering, so the pair this whole design
 *  was argued from formed no edge until the supply side generalised. A string comparison cannot see
 *  what the type hierarchy does. */
test("an emit is found by a demand for its coarser form", () => {
  expect(supplyForms("enters|creature|goblin|-")).toContain("enters|creature|-|-");
  expect(demandForms("enters|creature|-|-")).toEqual(["enters|creature|-|-"]);
});

/** THE SCORE STAYS ON THE DEMAND'S EXACT KEY. Generalising the score too would price every event as
 *  its widest form and flatten the ranking this module exists for: a goblin-specific payoff and a
 *  generic creature payoff would tie. */
test("a subtype-specific payoff outranks a generic one for the same emit", () => {
  const goblinPayoff = base("Goblin Bushwhacker", [{
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { type: "creature", subtype: "goblin", control: "you", token: null } },
    effect: { kind: "draw-card" },
  }] as unknown as CardTags["abilities"]);
  const slugs = resolveSlugs(["Goblin Bushwhacker", "Impact Tremors"]);
  const { rows } = partnersFor(krenko, [impactTremors, goblinPayoff], [], FREQ, slugs, H);
  expect(rows.map((r) => r.name)).toEqual(["Goblin Bushwhacker", "Impact Tremors"]);
  expect(rows[0]!.event).toBe("enters|creature|goblin|-");
  expect(rows[1]!.event).toBe("enters|creature|-|-");
});

// ---------------------------------------------------------------------------------------------
// The artifact.
// ---------------------------------------------------------------------------------------------

test("a partner shard name is stable and inside the count", () => {
  const a = partnerShardOf("krenko-mob-boss");
  expect(a).toBe(partnerShardOf("krenko-mob-boss"));
  expect(parseInt(a, 16)).toBeLessThan(PARTNER_SHARD_COUNT);
  expect(a).toMatch(/^[0-9a-f]{3}$/);
});

/** SUBSTANTIVE IS ONE PREDICATE DECIDING THREE THINGS: who gets a record, who gets an indexable
 *  page, and what the sitemap promises. A card with abilities but neither an emit nor a trigger is
 *  NOT substantive -- it forms no edge -- and an earlier draft of the spec enumerated the excluded
 *  groups instead of defining them and silently left that one out. */
test("substantive means at least one emit or one trigger, nothing else", () => {
  expect(isSubstantive(krenko)).toBe(true);
  expect(isSubstantive(impactTremors)).toBe(true);
  const vanilla = base("Grizzly Bears", [] as unknown as CardTags["abilities"]);
  expect(isSubstantive(vanilla)).toBe(false);
  const staticOnly = base("Static Only", [{
    kind: "static", effect: { kind: "pump" },
  }] as unknown as CardTags["abilities"]);
  expect(isSubstantive(staticOnly)).toBe(false);
});

test("the artifact shards every substantive card and skips the rest", () => {
  const vanilla = base("Grizzly Bears", [] as unknown as CardTags["abilities"]);
  const { shards, index } = buildPartnerArtifact([krenko, impactTremors, vanilla], H);
  const all = [...shards.values()].flatMap((s) => Object.keys(s));
  expect(all.sort()).toEqual(["impact-tremors", "krenko-mob-boss"]);
  expect(index.map((e) => e.slug).sort()).toEqual(["impact-tremors", "krenko-mob-boss"]);
});

/** NO CARD RULES TEXT ON THE RECORD (spec D2, reversed 2026-09-04). The evidence a reader checks a
 *  claim against is the engine's reason sentence, not the card's printed text -- so `oracleText`
 *  must not be able to creep back in through a future field. */
test("a page record carries metadata and derivation, never card rules text", () => {
  const { shards } = buildPartnerArtifact([krenko, impactTremors], H);
  const rec = [...shards.values()].flatMap((s) => Object.entries(s))
    .find(([slug]) => slug === "krenko-mob-boss")![1];
  expect(Object.keys(rec).sort()).toEqual(
    ["abilities", "artCrop", "commander", "demands", "emits", "identity", "manaCost", "name",
      "partners", "pool", "rarity", "typeLine"],
  );
  expect(JSON.stringify(rec)).not.toContain("Create X 1/1 red Goblin");
});

test("the artifact wires the partner list through the engine", () => {
  const { shards } = buildPartnerArtifact([krenko, impactTremors], H);
  const rec = [...shards.values()].flatMap((s) => Object.values(s))
    .find((r) => r.name === "Krenko, Mob Boss")!;
  expect(rec.partners.map((p) => p.name)).toEqual(["Impact Tremors"]);
  expect(rec.partners[0]!.reason).toContain("Krenko");
});

/** `pickReason` PREFERS A REPEATABLE SENTENCE, proven here because the corpus cannot prove it: on
 *  the Krenko/Quest pair the engine returns exactly ONE reason, so there is nothing to choose
 *  between and the preference is invisible. It still has to be correct for the pairs where the
 *  engine returns several -- a function nobody has tested is decoration.
 *
 *  Driven through `partnersFor` rather than by exporting the helper: the behaviour under test is
 *  which sentence reaches the artifact, not the shape of a private function. */
test("a repeatable reason is preferred over a one-shot", async () => {
  const edges = await import("../edges.js");
  const spy = vi.spyOn(edges, "directedReasons").mockReturnValue([
    { tag: "enters:creature", text: "ONE SHOT", repeatability: "oneshot" },
    { tag: "enters:creature", text: "REPEATABLE", repeatability: "triggered" },
  ] as never);
  try {
    const { rows } = partnersFor(krenko, [impactTremors], [], FREQ, SLUGS, H);
    expect(rows[0]!.reason).toBe("REPEATABLE");
  } finally { spy.mockRestore(); }
});

test("with only a one-shot on offer, that is what is stored", async () => {
  const edges = await import("../edges.js");
  const spy = vi.spyOn(edges, "directedReasons").mockReturnValue([
    { tag: "enters:creature", text: "ONLY ONE SHOT", repeatability: "oneshot" },
  ] as never);
  try {
    const { rows } = partnersFor(krenko, [impactTremors], [], FREQ, SLUGS, H);
    expect(rows[0]!.reason).toBe("ONLY ONE SHOT");
  } finally { spy.mockRestore(); }
});

/** THE ROW'S OWN EVENT OUTRANKS REPEATABILITY. Measured 2026-09-04: 11,928 of 88,768 rows printed
 *  an event key beside a sentence about some other channel, because `pickReason` only ever asked
 *  which sentence repeated. The row is scored on ONE event and the reader checks it against ONE
 *  sentence; they have to be the same event. */
test("the sentence for the row's own event wins over a repeatable one for another", async () => {
  const edges = await import("../edges.js");
  const spy = vi.spyOn(edges, "directedReasons").mockReturnValue([
    { tag: "cast:creature", text: "OFF EVENT, REPEATABLE", repeatability: "triggered" },
    { tag: "enters:creature", text: "ON EVENT", repeatability: "oneshot" },
  ] as never);
  try {
    // Impact Tremors demands `enters|creature|-`, so that is the row's event.
    const { rows } = partnersFor(krenko, [impactTremors], [], FREQ, SLUGS, H);
    expect(rows[0]!.reason).toBe("ON EVENT");
  } finally { spy.mockRestore(); }
});

/** WITHIN THE ROW'S EVENT, REPEATABILITY STILL DECIDES -- the two rules compose rather than one
 *  replacing the other. */
test("among sentences for the row's event, the repeatable one is still preferred", async () => {
  const edges = await import("../edges.js");
  const spy = vi.spyOn(edges, "directedReasons").mockReturnValue([
    { tag: "enters:creature", text: "ON EVENT, ONE SHOT", repeatability: "oneshot" },
    { tag: "cast:creature", text: "OFF EVENT, REPEATABLE", repeatability: "triggered" },
    { tag: "enters:creature", text: "ON EVENT, REPEATABLE", repeatability: "triggered" },
  ] as never);
  try {
    const { rows } = partnersFor(krenko, [impactTremors], [], FREQ, SLUGS, H);
    expect(rows[0]!.reason).toBe("ON EVENT, REPEATABLE");
  } finally { spy.mockRestore(); }
});

/** A PAIR THAT CONNECTS THROUGH SOME OTHER CHANNEL IS NOT A ROW FOR THIS EVENT. The engine really
 *  does relate these two -- `graveyard-recursion` is a real tag -- but nothing it returned is about
 *  the `enters` demand that ranked and priced the candidate, so the row would print a number earned
 *  by a relation the engine refused. Dropped, in the direction this repo always fails. */
test("a candidate whose reasons are all about other events is dropped", async () => {
  const edges = await import("../edges.js");
  const spy = vi.spyOn(edges, "directedReasons").mockReturnValue([
    { tag: "graveyard-recursion:creature", text: "OTHER CHANNEL", repeatability: "triggered" },
  ] as never);
  try {
    expect(partnersFor(krenko, [impactTremors], [], FREQ, SLUGS, H).rows).toEqual([]);
  } finally { spy.mockRestore(); }
});

/** THE ROW IS PRICED ON THE EVENT THAT VERIFIED, NOT THE ONE THAT RANKED. This payoff demands both
 *  `enters|creature|goblin` (rare, and what puts it at the top of the candidate list) and
 *  `enters|creature|-` (common). The engine confirms only the common one, so the row has to carry
 *  the common one's key and its lower score. */
test("a row carries the confirmed event, not the best-scoring one", async () => {
  const twoDemands = base("Two Demands", [{
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { type: "creature", subtype: "goblin", control: "you", token: null } },
    effect: { kind: "draw-card" },
  }, {
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { type: "creature", control: "you", token: null } },
    effect: { kind: "draw-card" },
  }] as unknown as CardTags["abilities"]);
  const slugs = resolveSlugs(["Two Demands"]);
  const edges = await import("../edges.js");
  // Only the untyped `enters` relation is confirmed; nothing here is about goblins.
  const spy = vi.spyOn(edges, "directedReasons").mockReturnValue([
    { tag: "enters:creature", text: "CREATURES ENTER", repeatability: "triggered" },
  ] as never);
  try {
    const { rows } = partnersFor(krenko, [twoDemands], [], FREQ, slugs, H);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.event).toBe("enters|creature|-|-");
    expect(rows[0]!.score).toBeCloseTo(specificity("enters|creature|-|-", FREQ));
  } finally { spy.mockRestore(); }
});

/** ONE EVENT, TWO SPELLINGS. `eventKey` reads the RAW verb, `zoneEventKey` renames the canonical
 *  one, so a "leave your graveyard" demand keys as `leaves|creature|-` and tags as
 *  `leaves-graveyard:creature`. Matching the two strings against each other would drop the whole
 *  family without a test noticing; both are built here by the functions that build them for real.
 *  (Until 2026-09-05 the witness was a sacrifice outlet's `leaves` tagging `dies:`; a death and a
 *  leave are two verbs now and neither is renamed, so the rename that remains is the graveyard one.) */
test("a zone-renamed tag matches the demand key that kept the raw verb", async () => {
  const leaver = base("Graveyard Leaver", [{
    kind: "activated", cost: "{T}",
    effect: { kind: "graveyard-recursion" },
    emits: [{ verb: "leaves", subject: { zone: "graveyard", control: "you", token: null, type: "creature" } }],
  }] as unknown as CardTags["abilities"]);
  const tombPayoff = base("Graveyard-Leave Payoff", [{
    kind: "triggered",
    trigger: { verbs: ["leaves"], subject: { zone: "graveyard", type: "creature", control: "you", token: null } },
    effect: { kind: "draw-card" },
  }] as unknown as CardTags["abilities"]);
  const slugs = resolveSlugs(["Graveyard-Leave Payoff"]);
  const edges = await import("../edges.js");
  const spy = vi.spyOn(edges, "directedReasons").mockReturnValue([
    { tag: "cast:creature", text: "OFF EVENT, REPEATABLE", repeatability: "triggered" },
    { tag: "leaves-graveyard:creature", text: "ON EVENT", repeatability: "oneshot" },
  ] as never);
  try {
    const { rows } = partnersFor(leaver, [tombPayoff], [], FREQ, slugs, H);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.event).toBe("leaves|creature|-|-");
    expect(rows[0]!.reason).toBe("ON EVENT");
  } finally { spy.mockRestore(); }
});

/** THE AUTHORED SUPPLY IS THE ONE THE READER CAME FOR. Krenko is a Goblin AND he taps to make
 *  Goblins, so he satisfies `enters:goblin` twice and both sentences carry the CONSUMER'S
 *  repeatability -- the older rule cannot separate them, and emission order decided it. */
test("an authored sentence outranks the synthesised baseline one", async () => {
  const edges = await import("../edges.js");
  const spy = vi.spyOn(edges, "directedReasons").mockReturnValue([
    { tag: "enters:creature", text: "BODY", repeatability: "triggered", impliedProducer: true },
    { tag: "enters:creature", text: "AUTHORED", repeatability: "triggered" },
  ] as never);
  try {
    const { rows } = partnersFor(krenko, [impactTremors], [], FREQ, SLUGS, H);
    expect(rows[0]!.reason).toBe("AUTHORED");
  } finally { spy.mockRestore(); }
});

/** AND IT OUTRANKS REPEATABILITY, not just ties with it. A one-shot sentence about the card's real
 *  engine beats a repeatable one about it merely existing; the baseline is what the matcher
 *  synthesises for ANY card, so it can never be the more informative half. */
test("an authored one-shot still outranks a repeatable baseline", async () => {
  const edges = await import("../edges.js");
  const spy = vi.spyOn(edges, "directedReasons").mockReturnValue([
    { tag: "enters:creature", text: "BODY", repeatability: "triggered", impliedProducer: true },
    { tag: "enters:creature", text: "AUTHORED", repeatability: "oneshot" },
  ] as never);
  try {
    const { rows } = partnersFor(krenko, [impactTremors], [], FREQ, SLUGS, H);
    expect(rows[0]!.reason).toBe("AUTHORED");
  } finally { spy.mockRestore(); }
});

/** A CARD PAGE BUILDS NO TOKEN NODES, so it must ask the engine not to suppress a maker's own token
 *  supply in favour of a second hop nothing will build. Asserted on the CALL rather than on the
 *  output, because the option's effect is the engine's to test and this file's job is only to pass
 *  it. */
test("the engine is asked with token mediation off", async () => {
  const edges = await import("../edges.js");
  const spy = vi.spyOn(edges, "directedReasons");
  try {
    partnersFor(krenko, [impactTremors], [], FREQ, SLUGS, H);
    expect(spy).toHaveBeenCalledWith(krenko, impactTremors, H, { tokensMediate: false });
  } finally { spy.mockRestore(); }
});

/** THE ARCHETYPE LABELS, FROM ONE CARD'S OWN EVENTS. `detectArchetypes` cannot answer this: it is
 *  deck-level and density-based (`ARCHETYPE_FLOOR` is 0.08 of the nonlands), so a single card has no
 *  density to measure. */
test("a card's own events map onto the existing archetype labels", () => {
  expect(themesOf(["create-token|creature|-|-"], [])).toEqual(["Tokens"]);
  expect(themesOf(["counter-added|-|-|-"], [])).toEqual(["+1/+1 Counters"]);
  expect(themesOf(["enters|land|-|-"], [])).toEqual(["Landfall"]);
});

/** ARISTOCRATS IS DEMAND-DEFINED, and that is a measured owner ruling, not a preference: an
 *  aristocrats deck is its PAYOFFS -- Zulaport Cutthroat, Blood Artist -- not the removal spell that
 *  happens to emit `sacrifice:creature`. Over the 71 decks, 815 of 974 matches were supply-only, and
 *  Aristocrats topped four decks the owner calls Control. `ARCHETYPE_SIGNATURE` carries the flag;
 *  this honours it rather than re-deciding it. */
test("a card that only makes things die is not an aristocrats card; one that watches them is", () => {
  expect(themesOf(["dies|creature|-|-"], [])).toEqual([]);
  expect(themesOf([], ["dies|creature|-|-"])).toEqual(["Aristocrats"]);
});

/** NO SIGNATURE MEANS NO LABEL. The naming layers are the only code in this repo that cannot say
 *  "I don't know"; this one can, and does. */
test("no signature means no label, never a guessed one", () => {
  expect(themesOf(["draw|-|-|-"], [])).toEqual([]);
  expect(themesOf([], [])).toEqual([]);
});

/** A CARD THAT FITS TWO ARCHETYPES GETS BOTH, and this is a deliberate deviation from the plan's
 *  `string | null`. Picking one would need a priority order nothing in this repo has measured, and
 *  inventing one is exactly the guess the layer above refuses to make. Two true labels beat one
 *  arbitrary label. */
test("a card with two signatures is labelled with both, in signature order", () => {
  expect(themesOf(["create-token|creature|-|-", "counter-added|-|-|-"], []))
    .toEqual(["Tokens", "+1/+1 Counters"]);
});

/** WHAT THE DECK HAS TO BRING. A commander that wants creatures dying and makes none die on its own
 *  is stating a requirement; one that does both is self-sufficient on that event and the page should
 *  not list it as a gap. Same supply/demand predicate `partnersFor` ranks with, so the two cannot
 *  disagree about what satisfies what. */
test("an unmet demand is one the card does not supply itself", () => {
  expect(unmetDemands(["create-token|creature|goblin|-"], ["dies|creature|-|-"])).toEqual(["dies|creature|-|-"]);
  // A goblin token entering IS a creature entering, so this demand is self-supplied.
  expect(unmetDemands(["enters|creature|goblin|-"], ["enters|creature|-|-"])).toEqual([]);
  expect(unmetDemands([], ["dies|creature|-|-"])).toEqual(["dies|creature|-|-"]);
});

/** A COMMANDER'S DECK CANNOT CONTAIN AN OFF-IDENTITY CARD, so a partner list that ignores identity
 *  is a list of cards this deck may never play. The commander rows are RANKED OVER THE LEGAL POOL
 *  rather than filtered after ranking: filtering afterwards leaves a mono-red commander showing
 *  eight of its twenty-four rows with nothing to fill the rest, and the whole point of the second
 *  URL (spec D5) is that it differs in substance from the card page rather than being a thinner
 *  view of it. */
/** BOTH CLONE. The fixtures above are module-level objects shared by every test in this file, and
 *  the first cut of these two mutated `krenko` in place -- which made the NEXT test see a commander
 *  and fail, in a file where nothing else has order-dependent state. */
const asCommander = (d: ReturnType<typeof base>, identity: string[]) => ({
  ...d,
  card: {
    ...d.card, typeLine: "Legendary Creature — Goblin Warrior",
    colorIdentity: identity, legalities: { commander: "legal" },
  } as unknown as DeckCard["card"],
});
const withIdentity = (d: ReturnType<typeof base>, identity: string[]) => ({
  ...d,
  card: { ...d.card, colorIdentity: identity } as unknown as DeckCard["card"],
});

test("a commander's own partner list holds only cards its deck could legally contain", () => {
  const payoff = (name: string) => base(name, [{
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { type: "creature", control: "you", token: null } },
    effect: { kind: "draw-card" },
  }] as unknown as CardTags["abilities"]);
  const mono = withIdentity(payoff("Red Payoff"), ["R"]);
  const simic = withIdentity(payoff("Simic Payoff"), ["G", "U"]);
  const colourless = withIdentity(payoff("Colourless Payoff"), []);
  const boss = asCommander(krenko, ["R"]);

  const { shards } = buildPartnerArtifact([boss, mono, simic, colourless], H);
  const rec = [...shards.values()].flatMap((s) => Object.values(s)).find((r) => r.name === "Krenko, Mob Boss")!;

  expect(rec.partners.map((p) => p.name).sort())
    .toEqual(["Colourless Payoff", "Red Payoff", "Simic Payoff"]);
  // A colourless card is legal in every deck: `every` over an empty identity is true, and that is
  // the correct reading rather than an accident of the predicate.
  expect(rec.commanderPartners!.map((p) => p.name).sort())
    .toEqual(["Colourless Payoff", "Red Payoff"]);
  expect(rec.commanderPool!["enters|creature|-|-"]).toBe(2);
});

/** A NON-COMMANDER CARRIES NEITHER FIELD. Every record pays for the bytes of every field it has,
 *  and 12,927 of the 15,350 cards can never lead a deck. */
test("only a commander's record carries the commander partner list", () => {
  const { shards } = buildPartnerArtifact([krenko, impactTremors], H);
  const rec = [...shards.values()].flatMap((s) => Object.values(s)).find((r) => r.name === "Krenko, Mob Boss")!;
  expect(rec).not.toHaveProperty("commanderPartners");
  expect(rec).not.toHaveProperty("commanderPool");
});

/** THE TOKEN LATTICE, WHICH IS THE WHOLE POINT OF THE FOURTH FIELD.
 *
 *  MEASURED 2026-09-04: 59 corpus cards trigger specifically on a TOKEN entering and 206 triggers
 *  demand a NONTOKEN one. Keyed on three fields both keyed as `enters|creature|-`, so a token
 *  maker's page priced "whenever a token enters" -- the payoff built for exactly that card -- level
 *  with "whenever a creature enters", and carried every nontoken payoff it can never satisfy in its
 *  candidate list until the engine refused them one at a time. */
test("a token supply satisfies a token demand and an unstated one, never a nontoken demand", () => {
  const supply = new Set(supplyForms("enters|creature|goblin|t"));
  expect(demandForms("enters|creature|-|t").some((f) => supply.has(f))).toBe(true);
  expect(demandForms("enters|creature|-|-").some((f) => supply.has(f))).toBe(true);
  expect(demandForms("enters|creature|-|n").some((f) => supply.has(f))).toBe(false);
});

/** "NOT STATED" IS READ AS NOT A TOKEN, and the measurement is why: of 27,653 authored emits 6,810
 *  say token and 84 say nontoken, and on `enters` it is 3,309 token against 1,803 unstated. Token
 *  making is derived EXPLICITLY, so an unstated `enters` is overwhelmingly a real card arriving --
 *  a reanimation, a blink -- and the wildcard reading would feed every token payoff from every
 *  reanimator. */
test("an unstated supply answers a nontoken demand, never a token one", () => {
  const supply = new Set(supplyForms("enters|creature|-|-"));
  expect(demandForms("enters|creature|-|n").some((f) => supply.has(f))).toBe(true);
  expect(demandForms("enters|creature|-|-").some((f) => supply.has(f))).toBe(true);
  expect(demandForms("enters|creature|-|t").some((f) => supply.has(f))).toBe(false);
});

/** AND THE RANKING MOVES BECAUSE OF IT. A token demand is satisfiable only by the cards that
 *  actually make tokens, so it counts fewer suppliers than the untyped demand and scores above it --
 *  which is the sentence "a token payoff is a better match for a token maker" as arithmetic. */
test("a token demand is rarer than an untyped one, so it outranks it", () => {
  const freq = supplyCounts([
    { emits: ["enters|creature|goblin|t"], demands: [] },
    { emits: ["enters|creature|-|-"], demands: [] },
    { emits: ["enters|creature|-|-"], demands: [] },
    { emits: [], demands: ["enters|creature|-|t", "enters|creature|-|-"] },
  ]);
  expect(freq["enters|creature|-|t"]).toBe(1);
  expect(freq["enters|creature|-|-"]).toBe(3);
  expect(specificity("enters|creature|-|t", freq))
    .toBeGreaterThan(specificity("enters|creature|-|-", freq));
});

/** THE ROWS THAT RUN THE OTHER WAY. Every other row is "this card supplies, that card consumes"; a
 *  board count is the reverse, so the pair is verified `feeder -> subject`. Without this the engine
 *  drew the edge (`edges.ts`) and the page never asked about it -- the ranking proposes candidates
 *  by event key, and a board count has an event on neither side. Krenko's page showed no Goblins. */
const goblinBody = () => base("Goblin Assassin", [], ["goblin"]);
const krenkoCounting = () => {
  const d = base("Krenko, Mob Boss", [{
    kind: "activated", cost: "{T}",
    effect: {
      kind: "token-generation", scaling: "per-permanent",
      scalingSubject: { subtype: "goblin", zone: "battlefield", control: "you", token: null },
      subject: { control: "you", token: true, type: "creature", subtype: "goblin" },
    },
    emits: [{ verb: "create-token", subject: { control: "you", token: true, type: "creature", subtype: "goblin" } }],
  }] as unknown as CardTags["abilities"], ["goblin"]);
  return d;
};

test("a card the subject counts appears on its page, verified in the feeder direction", () => {
  const slugs = resolveSlugs(["Goblin Assassin", "Krenko, Mob Boss"]);
  const { rows, pool } = partnersFor(krenkoCounting(), [], [goblinBody()],
    { "counts|-|goblin|-": 388 }, slugs, H);
  expect(rows).toHaveLength(1);
  expect(rows[0]!.name).toBe("Goblin Assassin");
  expect(rows[0]!.event).toBe("counts|-|goblin|-");
  expect(rows[0]!.reason)
    .toBe("While you control Goblin Assassin, Krenko, Mob Boss counts it and makes more tokens");
  expect(pool["counts|-|goblin|-"]).toBe(1);
});

/** A CARD THAT IS NOT ONE OF THEM IS NOT A ROW, and the engine is what says so -- this phase
 *  verifies exactly as the forward one does rather than trusting the index. */
test("a feeder the engine refuses is dropped", () => {
  const slugs = resolveSlugs(["Llanowar Elves"]);
  const { rows } = partnersFor(krenkoCounting(), [], [base("Llanowar Elves", [], ["elf"])],
    { "counts|-|goblin|-": 388 }, slugs, H);
  expect(rows).toEqual([]);
});

/** WHAT A CARD COUNTS IS A DEMAND, and Krenko's record carried none until it was one: his X is the
 *  number of Goblins you control, which is the whole question his deck asks. */
test("a board count is a demand key, and a basic land type is not", () => {
  expect(boardCountKeysOf(krenkoCounting())).toEqual(["counts|-|goblin|-"]);
  const coffers = base("Cabal Coffers", [{
    kind: "activated", cost: "{2}, {T}",
    effect: {
      kind: "add-mana", scaling: "per-permanent",
      scalingSubject: { subtype: "swamp", zone: "battlefield", control: "you", token: null },
    },
  }] as unknown as CardTags["abilities"]);
  expect(boardCountKeysOf(coffers)).toEqual([]);
});

/** A CARD SUPPLIES WHAT IT IS, and that supply is kept OUT of the record's `emits`: "what it
 *  produces" must not fill with a restatement of the card's own type line on all 15,350 records. */
test("printed subtypes are a supply key but never a printed emit", () => {
  expect(supplyKeysOf(goblinBody())).toContain("counts|-|goblin|-");
  expect(emitKeysOf(goblinBody())).toEqual([]);
  const { shards } = buildPartnerArtifact([goblinBody(), krenkoCounting()], H);
  const rec = [...shards.values()].flatMap((s) => Object.values(s)).find((r) => r.name === "Goblin Assassin");
  // A card that only IS something, with no emit and no trigger, is still not substantive.
  expect(rec).toBeUndefined();
});

/** HOW THE ENGINE READ THE CARD, one row per ability -- the page's real argument, and the half that
 *  was missing while a record carried only the UNION of a card's events. Krenko's tap ability and
 *  his Goblin body are two different facts, and a reader checking a claim needs to see which one
 *  produced it. */
test("an ability row carries what fires it, what it does, and what it emits", () => {
  const rows = abilityRowsOf(krenko);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    kind: "activated",
    cost: "{T}",
    when: [],
    effect: "token-generation",
    emits: ["create-token|creature|goblin|t", "enters|creature|goblin|t"],
  });
});

/** A TRIGGER'S EVENTS COME THROUGH AS EVENT KEYS, so the page renders them with the same sentence
 *  function every other event on the site uses rather than inventing a second vocabulary. */
test("a triggered ability names what sets it off", () => {
  const rows = abilityRowsOf(impactTremors);
  expect(rows[0]!.kind).toBe("triggered");
  expect(rows[0]!.when).toEqual(["enters|creature|-|-"]);
  expect(rows[0]!.emits).toEqual([]);
});

/** A MAGNITUDE THAT COUNTS SOMETHING SAYS WHAT IT COUNTS. Without it "per-permanent" is a word with
 *  no object, and the count is the whole reason a Goblin deck runs this card. */
test("a scaling ability carries its basis and what it counts", () => {
  const counter = base("Krenko, Mob Boss", [{
    kind: "activated", cost: "{T}",
    effect: {
      kind: "token-generation", scaling: "per-permanent",
      scalingSubject: { subtype: "goblin", zone: "battlefield", control: "you", token: null },
    },
  }] as unknown as CardTags["abilities"], ["goblin"]);
  expect(abilityRowsOf(counter)[0]).toMatchObject({ scaling: "per-permanent", counts: "goblin" });
});

/** A STATIC IS A THIRD KIND OF RELATION, and until this existed the page could not ask about it.
 *  The forward phase ranks on what a card EMITS, the feeder phase on what it COUNTS; a static
 *  emits nothing and counts nothing, it APPLIES to a class of cards. Samut, the Driving Force
 *  prints two statics and nothing else, so on 2026-09-05 she had no page and no `/commanders` row
 *  while the deck report drew eleven edges from her. */
const samut = () => {
  const d = base("Samut, the Driving Force", [
    { kind: "static", effect: { kind: "pump", subject: { control: "you", token: null, type: "creature", scope: "all" } }, amount: "+X/+0" },
    { kind: "static", effect: { kind: "cost-reduction", subject: {
      control: "any", token: null, scope: "all",
      type: ["artifact", "enchantment", "planeswalker", "instant", "sorcery", "battle"], notType: ["creature"],
    } }, amount: "-X" },
  ] as unknown as CardTags["abilities"], ["human"]);
  d.card = { ...d.card, oracleText: "Noncreature spells you cast cost {X} less to cast, where X is your speed." } as DeckCard["card"];
  return d;
};
const withTypes = (d: ReturnType<typeof base>, types: string[], manaCost = "{1}{R}") => ({
  ...d,
  card: { ...d.card, manaCost } as unknown as DeckCard["card"],
  tags: { ...d.tags, characteristics: { ...d.tags.characteristics, types } } as CardTags,
});
const dragonFodder = () => withTypes(base("Dragon Fodder", [{
  kind: "on-cast",
  effect: { kind: "token-generation", subject: { control: "you", token: true, type: "creature", subtype: "goblin" } },
  emits: [{ verb: "create-token", subject: { control: "you", token: true, type: "creature", subtype: "goblin" } }],
}] as unknown as CardTags["abilities"]), ["sorcery"]);
const plainSorcery = (name: string) => withTypes(base(name, [{
  kind: "on-cast", effect: { kind: "removal", subject: { control: "any", token: null, type: "permanent" } },
  emits: [{ verb: "leaves", subject: { control: "any", token: null, type: "permanent" } }],
}] as unknown as CardTags["abilities"]), ["sorcery"]);
const forest = () => withTypes(base("Forest", []), ["land"], "");

test("a static's reach is a demand key, and a role or a self-reference is not", () => {
  expect(staticKeysOf(samut())).toEqual([
    "applies:pump|creature|-|-",
    "applies:cost-reduction|artifact,enchantment,planeswalker,instant,sorcery,battle|-|-",
  ]);
  const propaganda = base("Propaganda", [
    { kind: "static", effect: { kind: "tax", subject: { control: "opp", token: null, type: "creature" } } },
    { kind: "static", effect: { kind: "type-grant", subject: { control: "you", token: null, type: "land", self: true } } },
  ] as unknown as CardTags["abilities"]);
  expect(staticKeysOf(propaganda)).toEqual([]);
  expect(isSubstantive(samut())).toBe(true);
  expect(isSubstantive(propaganda)).toBe(false);
});

test("a static reaches the cards it applies to, each verified by the engine's own sentence", () => {
  const slugs = resolveSlugs(["Samut, the Driving Force", "Dragon Fodder", "Goblin Assassin", "Forest"]);
  const bauble = withTypes(base("Blue Bauble", []), ["artifact"], "{U}");
  const { rows, pool } = partnersFor(samut(), [forest(), bauble, dragonFodder(), goblinBody()], [], {}, slugs, H);
  expect(rows.map((r) => r.name).sort()).toEqual(["Dragon Fodder", "Goblin Assassin"]);
  const fodder = rows.find((r) => r.name === "Dragon Fodder")!;
  expect(fodder.event).toBe("applies:cost-reduction|artifact,enchantment,planeswalker,instant,sorcery,battle|-|-");
  expect(fodder.reason).toBe("Samut, the Driving Force reduces what Dragon Fodder costs");
  const body = rows.find((r) => r.name === "Goblin Assassin")!;
  expect(body.event).toBe("applies:pump|creature|-|-");
  expect(body.reason).toBe("Samut, the Driving Force gives Goblin Assassin bigger stats");
  // A `{U}` spell cannot cost less (CR 118.7): the engine refuses it, and the pool counted it before
  // the cut. The land was never a candidate -- the key names no land type.
  expect(pool[fodder.event]).toBe(2);
});

/** THE CARD THAT HITS BOTH STATICS LEADS. A noncreature spell that makes creature bodies is what a
 *  Samut deck is built from -- the discount and the anthem both land on it -- and with a cap of three
 *  per group it has to outrank a plain sorcery that only the discount reaches, whatever order the
 *  candidates arrive in. Ranked on the candidate's own types AND the types of the tokens it makes;
 *  the anthem row itself is not claimed on the maker, because no token node exists on a page. */
test("a noncreature spell that makes creatures leads the cost-reduction group", () => {
  const plain = ["Beast Within", "Rampant Growth", "Cultivate", "Chaos Warp"].map(plainSorcery);
  const slugs = resolveSlugs([...plain.map((p) => p.card.name), "Dragon Fodder", "Samut, the Driving Force"]);
  const { rows } = partnersFor(samut(), [...plain, dragonFodder()], [], {}, slugs, H);
  expect(rows).toHaveLength(PER_EVENT_CAP);
  expect(rows[0]!.name).toBe("Dragon Fodder");
});

test("a commander with only statics gets a page, an index row and legal partners", () => {
  const cmdr = asCommander(samut(), ["G", "R", "W"]);
  const blue = withIdentity(plainSorcery("Counterspell"), ["U"]);
  const { shards, index } = buildPartnerArtifact([cmdr, dragonFodder(), blue, forest()], H);
  const entry = index.find((e) => e.name === "Samut, the Driving Force");
  expect(entry?.commander).toBe(true);
  const rec = [...shards.values()].flatMap((s) => Object.values(s)).find((r) => r.name === "Samut, the Driving Force")!;
  expect(rec.partners.map((r) => r.name).sort()).toEqual(["Counterspell", "Dragon Fodder"]);
  expect(rec.commanderPartners!.map((r) => r.name)).toEqual(["Dragon Fodder"]);
});

/** CR 903.3 IS ALREADY READ IN `legality.ts`, and this file had rewritten it narrower: a legendary
 *  Vehicle with power, a Spacecraft with power, and a card that prints "can be your commander" all
 *  lead decks and none had a `/commanders` row (measured 2026-09-05: 40 + 5 + 21 corpus cards). */
const legendary = (name: string, typeLine: string, extra: Partial<DeckCard["card"]> = {}) => {
  const d = base(name, [{
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { type: "creature", control: "you", token: null } },
    effect: { kind: "draw-card" },
  }] as unknown as CardTags["abilities"]);
  return { ...d, card: { ...d.card, typeLine, legalities: { commander: "legal" }, ...extra } as unknown as DeckCard["card"] };
};

test("a Vehicle or Spacecraft with power, and a card that says so, are commanders", () => {
  const vehicle = legendary("Parhelion II", "Legendary Artifact — Vehicle", { power: "5", toughness: "5" });
  const lift = legendary("The Eternity Elevator", "Legendary Artifact — Spacecraft");
  const walker = legendary("Will Kenrith", "Legendary Planeswalker — Will",
    { oracleText: "Partner with Rowan Kenrith\nWill Kenrith can be your commander." });
  const { index } = buildPartnerArtifact([vehicle, lift, walker], H);
  const commander = (n: string) => index.find((e) => e.name === n)?.commander;
  expect(commander("Parhelion II")).toBe(true);
  expect(commander("The Eternity Elevator")).toBe(false);
  expect(commander("Will Kenrith")).toBe(true);
});

/** A BACKGROUND NEVER LEADS ALONE. It is a commander only opposite a card that chooses one, so it
 *  gets a row and a page, marked, rather than being filtered out with the non-commanders. */
test("a Background is a commander record marked pairing-only", () => {
  const bg = legendary("Haunted One", "Legendary Enchantment — Background");
  const { shards, index } = buildPartnerArtifact([bg], H);
  expect(index.find((e) => e.name === "Haunted One")?.commander).toBe(true);
  const rec = [...shards.values()].flatMap((s) => Object.values(s)).find((r) => r.name === "Haunted One")!;
  expect(rec.pairingOnly).toBe(true);
});


/** MELD IS A CARD-NAME RELATION. It emits nothing and counts nothing, so neither ranking phase could
 *  propose it; the engine drew the edge in the deck report and the page never asked. */
const meldHalf = (name: string, partner: string) => {
  const d = base(name, [{
    kind: "triggered",
    trigger: { verbs: ["attacks"], subject: { control: "you", token: null } },
    effect: { kind: "player-life-loss" },
    emits: [{ verb: "lose-life", subject: { control: "opp", token: null } }],
  }] as unknown as CardTags["abilities"]);
  return { ...d, card: { ...d.card, meldPartner: partner } as unknown as DeckCard["card"] };
};

test("a meld card's page lists its other half, verified on the engine's meld tag", () => {
  const mishra = meldHalf("Mishra, Claimed by Gix", "Phyrexian Dragon Engine");
  const engine = meldHalf("Phyrexian Dragon Engine", "Mishra, Claimed by Gix");
  expect(meldKeysOf(mishra)).toEqual(["meld|-|-|-"]);
  expect(meldKeysOf(goblinBody())).toEqual([]);
  const { shards } = buildPartnerArtifact([mishra, engine, goblinBody()], H);
  const rec = [...shards.values()].flatMap((s) => Object.values(s)).find((r) => r.name === "Mishra, Claimed by Gix")!;
  expect(rec.demands).toContain("meld|-|-|-");
  const row = rec.partners.find((r) => r.event === "meld|-|-|-")!;
  expect(row.name).toBe("Phyrexian Dragon Engine");
  expect(row.reason).toMatch(/meld/i);
  expect(rec.pool["meld|-|-|-"]).toBe(1);
});

/** WHO A COMMANDER MAY LEAD WITH, from the same `pairingLicense` the legality report uses. */
test("a commander record lists the cards it can legally pair with, by licence", () => {
  const lead = legendary("Wilson, Refined Grizzly", "Legendary Creature — Bear Warrior",
    { oracleText: "Choose a Background (You can have a Background as a second commander.)", colorIdentity: ["G"] });
  const bg = legendary("Haunted One", "Legendary Enchantment — Background", { colorIdentity: ["B"] });
  const bear = legendary("Grizzly Bears", "Legendary Creature — Bear", { colorIdentity: ["G"] });
  const clara = legendary("Clara Oswald", "Legendary Creature — Human Advisor", {
    oracleText: "Impossible Girl — If Clara Oswald is your commander, choose a color before the game begins. Clara Oswald is the chosen color.\nDoctor's companion (You can have two commanders if the other is the Doctor.)",
  });
  const { shards } = buildPartnerArtifact([lead, bg, bear, clara], H);
  const rec = (n: string) => [...shards.values()].flatMap((s) => Object.values(s)).find((r) => r.name === n)!;
  expect(rec("Wilson, Refined Grizzly").pairsWith).toEqual([
    { slug: "haunted-one", name: "Haunted One", identity: ["B"], licence: "choose a background" },
  ]);
  expect(rec("Haunted One").pairsWith?.map((p) => p.name)).toEqual(["Wilson, Refined Grizzly"]);
  expect(rec("Grizzly Bears").pairsWith).toBeUndefined();
  expect(rec("Clara Oswald").choosesColour).toBe(true);
  expect(rec("Grizzly Bears").choosesColour).toBeUndefined();
});

/** A PICKED PARTNER CHANGES THE DECK'S IDENTITY, and the partner list is ranked over the legal pool,
 *  so the list has to be re-ranked per identity the pair can reach. Keyed by colour set, not partner
 *  card: two mono-black Backgrounds give one list. The own identity is never a key -- that list is
 *  `commanderPartners`. */
test("a commander carries a partner list per distinct combined identity it can reach", () => {
  const lead = legendary("Wilson, Refined Grizzly", "Legendary Creature — Bear Warrior",
    { oracleText: "Choose a Background (You can have a Background as a second commander.)", colorIdentity: ["G"] });
  // A supply the ranking can propose a candidate from: `legendary()` gives a trigger and no emit.
  (lead.tags!.abilities[0] as { emits?: unknown[] }).emits = [
    { verb: "enters", subject: { control: "you", token: false, type: "creature" } },
  ];
  const black = legendary("Haunted One", "Legendary Enchantment — Background", { colorIdentity: ["B"] });
  const black2 = legendary("Cultist of the Absolute", "Legendary Enchantment — Background", { colorIdentity: ["B"] });
  const green = legendary("Druid Class Background", "Legendary Enchantment — Background", { colorIdentity: ["G"] });
  // The Backgrounds watch something the lead never supplies, so the BG list is the payoff alone
  // and not three Backgrounds filling `PER_EVENT_CAP` ahead of it.
  for (const b of [black, black2, green]) (b.tags!.abilities[0] as { trigger: { verbs: string[] } }).trigger.verbs = ["upkeep"];
  const payoffB = withIdentity(legendary("Black Payoff", "Creature — Rat"), ["B"]);
  const { shards } = buildPartnerArtifact([lead, black, black2, green, payoffB], H);
  const rec = [...shards.values()].flatMap((s) => Object.values(s)).find((r) => r.name === "Wilson, Refined Grizzly")!;
  expect(Object.keys(rec.commanderPartnersBy ?? {})).toEqual(["BG"]);
  expect(rec.commanderPartnersBy!.BG!.partners.map((r) => r.name)).toContain("Black Payoff");
  expect(rec.commanderPartners!.map((r) => r.name)).not.toContain("Black Payoff");
  // The Background's own record carries the same key, so the page can merge both halves.
  const bg = [...shards.values()].flatMap((s) => Object.values(s)).find((r) => r.name === "Haunted One")!;
  expect(Object.keys(bg.commanderPartnersBy ?? {})).toEqual(["BG"]);
});

test("a colour chooser carries one list per colour", () => {
  const clara = legendary("Clara Oswald", "Legendary Creature — Human Advisor", {
    oracleText: "Impossible Girl — If Clara Oswald is your commander, choose a color before the game begins. Clara Oswald is the chosen color.",
  });
  const { shards } = buildPartnerArtifact([clara], H);
  const rec = [...shards.values()].flatMap((s) => Object.values(s)).find((r) => r.name === "Clara Oswald")!;
  expect(Object.keys(rec.commanderPartnersBy ?? {}).sort()).toEqual(["B", "G", "R", "U", "W"]);
  expect(identityKeyOf([])).toBe("C");
  expect(identityKeyOf(["U", "R"])).toBe("UR");
});

/** EVERY LEGAL COMMANDER HAS A PAGE, abilities or not. Clara Oswald derives one trigger-doubler
 *  with no subject, so no key ever made her substantive and the Ninth Doctor's page could offer a
 *  companion with nowhere to link (real build, 2026-09-05). And a commander the engine read
 *  NOTHING on needs a page more than most: an empty ability table is the one place the owner can
 *  see a wrong "no ability" (roadmap W10). */
test("a legal commander with no derived ability still gets a record and an index row", () => {
  const vanilla = legendary("Isamaru, Hound of Konda", "Legendary Creature — Dog");
  vanilla.tags!.abilities = [];
  const unread = { ...legendary("Faceless One", "Legendary Creature — Shapeshifter"), tags: null };
  const { shards, index } = buildPartnerArtifact([vanilla, unread], H);
  expect(index.map((e) => e.name).sort()).toEqual(["Faceless One", "Isamaru, Hound of Konda"]);
  const rec = [...shards.values()].flatMap((s) => Object.values(s)).find((r) => r.name === "Faceless One")!;
  expect(rec.commander).toBe(true);
  expect(rec.abilities).toEqual([]);
  expect(rec.partners).toEqual([]);
});

/** THE ENGINE READ THE MELD. `meldReason` carries no effect kind by design (melding is not a payoff
 *  kind), and the row reused the "no effect kind = unread" rule, so every meld row on 21 pages
 *  printed a refusal under a perfect sentence (branch review, 2026-09-05). */
test("a meld row is never marked unread", () => {
  const mishra = meldHalf("Mishra, Claimed by Gix", "Phyrexian Dragon Engine");
  const engine = meldHalf("Phyrexian Dragon Engine", "Mishra, Claimed by Gix");
  const { shards } = buildPartnerArtifact([mishra, engine], H);
  const rec = [...shards.values()].flatMap((s) => Object.values(s)).find((r) => r.name === "Mishra, Claimed by Gix")!;
  expect(rec.partners.find((r) => r.event === "meld|-|-|-")?.unread).toBeUndefined();
});

/** THE PARTNER MAY BE THE ONE WHO CHOOSES. The Ninth Doctor does not pick a colour; Clara Oswald
 *  beside him does, and the pair is three colours. The Doctor's record has to carry the keys the
 *  pair can reach through HER choice, and say that she chooses. */
test("a commander whose partner chooses a colour reaches the colour keys through that partner", () => {
  const doctor = legendary("The Ninth Doctor", "Legendary Creature — Time Lord Doctor", { colorIdentity: ["U", "R"] });
  const clara = legendary("Clara Oswald", "Legendary Creature — Human Advisor", {
    oracleText: "Impossible Girl — If Clara Oswald is your commander, choose a color before the game begins. Clara Oswald is the chosen color.\nDoctor's companion (You can have two commanders if the other is the Doctor.)",
  });
  const { shards } = buildPartnerArtifact([doctor, clara], H);
  const rec = [...shards.values()].flatMap((s) => Object.values(s)).find((r) => r.name === "The Ninth Doctor")!;
  expect(rec.pairsWith).toEqual([{ slug: "clara-oswald", name: "Clara Oswald", identity: [], licence: "doctor's companion", choosesColour: true }]);
  expect(Object.keys(rec.commanderPartnersBy ?? {}).sort()).toEqual(["UBR", "URG", "WUR"]);
});

/** A CARD'S OWN ATTACK IS NOT A DEMAND ON THE OTHER 99. Burakos, Party Leader triggers when HE
 *  attacks (`self: true`, which the engine derives correctly); the page keyed it as
 *  `attacks|-|-|-`, printed "anything attacking", filed it as a gap the deck must cover and ranked
 *  attackers as his partners (owner, 2026-09-05). The row says it is the card itself. */
test("a self trigger is a row that says so, and never a demand", () => {
  const burakos = base("Burakos, Party Leader", [{
    kind: "triggered",
    trigger: { verbs: ["attacks"], subject: { control: "you", token: null, self: true } },
    effect: { kind: "token-generation", subject: { control: "any", token: true, subtype: "treasure" } },
    emits: [{ verb: "create-token", subject: { control: "you", token: true, subtype: "treasure", type: "artifact" } }],
  }] as unknown as CardTags["abilities"], ["orc"]);
  expect(demandKeysOf(burakos)).toEqual([]);
  expect(abilityRowsOf(burakos)[0]).toMatchObject({ when: ["attacks|-|-|-"], self: true });
  const other = base("Coastal Piracy", [{
    kind: "triggered",
    trigger: { verbs: ["attacks"], subject: { control: "you", token: null, type: "creature" } },
    effect: { kind: "draw-card" },
  }] as unknown as CardTags["abilities"]);
  expect(demandKeysOf(other)).toEqual(["attacks|creature|-|-"]);
  expect(abilityRowsOf(other)[0]!.self).toBeUndefined();
});

/** A PARTY COUNT DEMANDS FOUR TYPES, and each is a key of its own so a Rogue body and a Cleric body
 *  both feed it. Keyed on the first subtype alone, Burakos's page would have asked only for
 *  Clerics (owner, 2026-09-05; CR 700.7). */
test("a board count over a list of subtypes is one demand key per subtype, each verified", () => {
  const burakos = base("Burakos, Party Leader", [{
    kind: "triggered",
    trigger: { verbs: ["attacks"], subject: { control: "you", token: null, self: true } },
    effect: {
      kind: "token-generation", scaling: "per-creature",
      scalingSubject: { type: "creature", subtype: ["cleric", "rogue", "warrior", "wizard"], zone: "battlefield", control: "you", token: null },
      subject: { control: "any", token: true, subtype: "treasure" },
    },
    emits: [{ verb: "create-token", subject: { control: "you", token: true, subtype: "treasure", type: "artifact" } }],
  }] as unknown as CardTags["abilities"], ["orc"]);
  expect(boardCountKeysOf(burakos)).toEqual(["counts|-|cleric|-", "counts|-|rogue|-", "counts|-|warrior|-", "counts|-|wizard|-"]);
  // The row names everything it counts, not the first of them.
  expect(abilityRowsOf(burakos)[0]!.counts).toBe("cleric, rogue, warrior, wizard");
  // Substantive, so the build indexes it as a body: a page needs a page to link to.
  const rogue = base("Thieving Skydiver", [{
    kind: "triggered", trigger: { verbs: ["upkeep"], subject: { control: "you", token: null } }, effect: { kind: "mill" },
  }] as unknown as CardTags["abilities"], ["merfolk", "rogue"]);
  const { shards } = buildPartnerArtifact([burakos, rogue], H);
  const rec = [...shards.values()].flatMap((s) => Object.values(s)).find((r) => r.name === "Burakos, Party Leader")!;
  const row = rec.partners.find((r) => r.name === "Thieving Skydiver")!;
  expect(row.event).toBe("counts|-|rogue|-");
  expect(row.reason).toMatch(/counts it/);
});

/** A PRINTED KEYWORD IS ON THE PAGE. `keywordAbilities` gives Start your engines! its trigger for
 *  edge formation; the page read `tags.abilities` alone, so Samut, the Driving Force showed two
 *  statics and no reason for a drain card to be near her (roadmap W9, owner 2026-09-05). */
test("a keyword trigger is a row, a demand and a partner channel on the page", () => {
  const samut = base("Samut, the Driving Force", [{
    kind: "static", effect: { kind: "pump", subject: { control: "you", token: null, type: "creature", scope: "all" } },
  }] as unknown as CardTags["abilities"], ["human"]);
  samut.tags!.characteristics.keywords = ["start your engines!"];
  expect(demandKeysOf(samut)).toEqual(["lose-life|-|-|-"]);
  expect(abilityRowsOf(samut).map((r) => [r.kind, r.effect])).toEqual([["static", "pump"], ["triggered", "speed"]]);
  const drain = base("Vampire Nighthawk", [{
    kind: "triggered", trigger: { verbs: ["attacks"], subject: { control: "you", token: null, self: true } },
    effect: { kind: "drain" },
    emits: [{ verb: "lose-life", subject: { control: "opp", token: null } }, { verb: "gain-life", subject: { control: "you", token: null } }],
  }] as unknown as CardTags["abilities"], ["vampire"]);
  const { shards } = buildPartnerArtifact([samut, drain], H);
  const rec = (n: string) => [...shards.values()].flatMap((s) => Object.values(s)).find((r) => r.name === n)!;
  // A page lists what CONSUMES the card's supply, and its own demands are the gap line -- so the
  // drain card's page is where Samut appears, priced on the life loss she watches for.
  expect(unmetDemands(rec("Samut, the Driving Force").emits, rec("Samut, the Driving Force").demands)).toContain("lose-life|-|-|-");
  const row = rec("Vampire Nighthawk").partners.find((r) => r.name === "Samut, the Driving Force")!;
  expect(row.event).toBe("lose-life|-|-|-");
  expect(row.reason).toMatch(/speed/);
});
