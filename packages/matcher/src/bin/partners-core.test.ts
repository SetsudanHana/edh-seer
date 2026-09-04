import { expect, test, vi } from "vitest";
import type { CardTags } from "@edh-seer/tagger";
import type { DeckCard, Hierarchy } from "../types.js";
import {
  KEEP, PARTNER_SHARD_COUNT, PER_EVENT_CAP, buildPartnerArtifact, demandForms, eventKey, isSubstantive,
  partnerShardOf, partnersFor, resolveSlugs, slugOf, specificity, supplyCounts,
  supplyForms,
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
    .toBe("enters|creature|goblin");
  expect(eventKey({ verb: "draw", subject: { control: "you", token: null } } as never))
    .toBe("draw|-|-");
});

/** `type` AND `subtype` ARE `string | string[]` IN THE SCHEMA. An array is sorted before joining so
 *  ["instant","sorcery"] and ["sorcery","instant"] count as one event and not two. */
test("an array-valued type is order-independent", () => {
  const a = eventKey({ verb: "cast", subject: { control: "you", token: null, type: ["instant", "sorcery"] } } as never);
  const b = eventKey({ verb: "cast", subject: { control: "you", token: null, type: ["sorcery", "instant"] } } as never);
  expect(a).toBe(b);
  expect(a).toBe("cast|instant,sorcery|-");
});

/** SPECIFICITY IS THE WHOLE RANKING. A rare event is a precise interaction; a universal one is
 *  noise. The numbers here are the measured corpus frequencies, so this test would notice a scoring
 *  change that reordered the two cases the design was argued from. */
test("a rarer event scores higher than a common one", () => {
  const freq = { "enters|creature|-": 1909, "enters|creature|goblin": 41 };
  expect(specificity("enters|creature|goblin", freq))
    .toBeGreaterThan(specificity("enters|creature|-", freq));
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
    { emits: ["enters|creature|goblin"], demands: [] },
    { emits: ["enters|land|-"], demands: [] },
    { emits: ["enters|enchantment|-"], demands: [] },
    { emits: [], demands: ["enters|creature,land,enchantment|-", "enters|creature|goblin"] },
  ];
  const freq = supplyCounts(rows);
  expect(freq["enters|creature,land,enchantment|-"]).toBe(3);
  expect(freq["enters|creature|goblin"]).toBe(1);
  expect(specificity("enters|creature|goblin", freq))
    .toBeGreaterThan(specificity("enters|creature,land,enchantment|-", freq));
});

/** A DEMAND IS NEVER WIDENED. `enters|-|goblin` means a goblin entering; counting every permanent as
 *  satisfying it would rebuild the bug this replaced. */
test("a subtype demand is satisfied only by that subtype", () => {
  const freq = supplyCounts([
    { emits: ["enters|creature|goblin"], demands: [] },
    { emits: ["enters|creature|elf"], demands: [] },
    { emits: ["enters|artifact|-"], demands: [] },
    { emits: [], demands: ["enters|-|goblin", "enters|-|-"] },
  ]);
  expect(freq["enters|-|goblin"]).toBe(1);
  // The bare form IS satisfied by everything that enters, and must score accordingly.
  expect(freq["enters|-|-"]).toBe(3);
});

test("a supply form covers the coarser demands it satisfies, a demand form only splits", () => {
  expect(supplyForms("enters|creature|goblin").sort())
    .toEqual(["enters|-|-", "enters|-|goblin", "enters|creature|-", "enters|creature|goblin"]);
  expect(demandForms("enters|creature,land|-").sort())
    .toEqual(["enters|creature|-", "enters|land|-"]);
  expect(demandForms("enters|-|goblin")).toEqual(["enters|-|goblin"]);
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

const FREQ = { "enters|creature|goblin": 41, "enters|creature|-": 1909, "create-token|creature|goblin": 63 };
const SLUGS = resolveSlugs(["Impact Tremors", "Millstone", "Krenko, Mob Boss"]);

test("a verified partner carries the engine's own reason sentence", () => {
  const { rows } = partnersFor(krenko, [impactTremors], FREQ, SLUGS, H);
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
  expect(partnersFor(krenko, [millstone], FREQ, SLUGS, H).rows).toEqual([]);
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
  expect(partnersFor(krenko, [noReason], FREQ, slugs, H).rows).toEqual([]);
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
  const { rows, pool } = partnersFor(krenko, many, FREQ, slugs, H);
  expect(rows.length).toBe(PER_EVENT_CAP);
  expect(pool["enters|creature|-"]).toBe(KEEP + 10);
});

/** A CARD IS NEVER ITS OWN PARTNER. `directedReasons(x, x)` can return reasons -- self-reference is
 *  the biggest defect family this engine has had -- so the exclusion is explicit. */
test("the subject is not its own partner", () => {
  expect(partnersFor(krenko, [krenko], FREQ, SLUGS, H).rows).toEqual([]);
});

/** THE BUG THE FIXTURES FOUND, PINNED. Krenko emits `enters|creature|goblin`; Impact Tremors demands
 *  `enters|creature|-`. A goblin token entering IS a creature entering, so the pair this whole design
 *  was argued from formed no edge until the supply side generalised. A string comparison cannot see
 *  what the type hierarchy does. */
test("an emit is found by a demand for its coarser form", () => {
  expect(supplyForms("enters|creature|goblin")).toContain("enters|creature|-");
  expect(demandForms("enters|creature|-")).toEqual(["enters|creature|-"]);
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
  const { rows } = partnersFor(krenko, [impactTremors, goblinPayoff], FREQ, slugs, H);
  expect(rows.map((r) => r.name)).toEqual(["Goblin Bushwhacker", "Impact Tremors"]);
  expect(rows[0]!.event).toBe("enters|creature|goblin");
  expect(rows[1]!.event).toBe("enters|creature|-");
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
    ["commander", "demands", "emits", "identity", "manaCost", "name", "partners", "pool", "typeLine"],
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
    const { rows } = partnersFor(krenko, [impactTremors], FREQ, SLUGS, H);
    expect(rows[0]!.reason).toBe("REPEATABLE");
  } finally { spy.mockRestore(); }
});

test("with only a one-shot on offer, that is what is stored", async () => {
  const edges = await import("../edges.js");
  const spy = vi.spyOn(edges, "directedReasons").mockReturnValue([
    { tag: "enters:creature", text: "ONLY ONE SHOT", repeatability: "oneshot" },
  ] as never);
  try {
    const { rows } = partnersFor(krenko, [impactTremors], FREQ, SLUGS, H);
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
    const { rows } = partnersFor(krenko, [impactTremors], FREQ, SLUGS, H);
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
    const { rows } = partnersFor(krenko, [impactTremors], FREQ, SLUGS, H);
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
    expect(partnersFor(krenko, [impactTremors], FREQ, SLUGS, H).rows).toEqual([]);
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
    const { rows } = partnersFor(krenko, [twoDemands], FREQ, slugs, H);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.event).toBe("enters|creature|-");
    expect(rows[0]!.score).toBeCloseTo(specificity("enters|creature|-", FREQ));
  } finally { spy.mockRestore(); }
});

/** ONE EVENT, TWO SPELLINGS. `eventKey` reads the RAW verb, `zoneEventKey` renames the canonical
 *  one, so a sacrifice outlet's `leaves` demand keys as `leaves|creature|-` and tags as
 *  `dies:creature`. Matching the two strings against each other would drop the whole dies family
 *  without a test noticing; both are built here by the functions that build them for real. */
test("a zone-renamed tag matches the demand key that kept the raw verb", async () => {
  const outlet = base("Sac Outlet", [{
    kind: "activated", cost: "{T}",
    effect: { kind: "sacrifice" },
    emits: [{ verb: "leaves", subject: { zone: "battlefield", control: "you", token: null, type: "creature" } }],
  }] as unknown as CardTags["abilities"]);
  const deathPayoff = base("Death Payoff", [{
    kind: "triggered",
    trigger: { verbs: ["leaves"], subject: { zone: "battlefield", type: "creature", control: "you", token: null } },
    effect: { kind: "draw-card" },
  }] as unknown as CardTags["abilities"]);
  const slugs = resolveSlugs(["Death Payoff"]);
  const edges = await import("../edges.js");
  const spy = vi.spyOn(edges, "directedReasons").mockReturnValue([
    { tag: "cast:creature", text: "OFF EVENT, REPEATABLE", repeatability: "triggered" },
    { tag: "dies:creature", text: "ON EVENT", repeatability: "oneshot" },
  ] as never);
  try {
    const { rows } = partnersFor(outlet, [deathPayoff], FREQ, slugs, H);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.event).toBe("leaves|creature|-");
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
    const { rows } = partnersFor(krenko, [impactTremors], FREQ, SLUGS, H);
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
    const { rows } = partnersFor(krenko, [impactTremors], FREQ, SLUGS, H);
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
    partnersFor(krenko, [impactTremors], FREQ, SLUGS, H);
    expect(spy).toHaveBeenCalledWith(krenko, impactTremors, H, { tokensMediate: false });
  } finally { spy.mockRestore(); }
});
