import { expect, test } from "vitest";
import type { CardTags } from "@edh-seer/tagger";
import type { DeckCard, Hierarchy } from "../types.js";
import { KEEP, countEvents, eventKey, keyVariants, partnersFor, resolveSlugs, slugOf, specificity } from "./partners-core.js";

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

test("counting is over distinct cards, both sides of the edge", () => {
  const freq = countEvents([
    { emits: ["enters|creature|-"], demands: [] },
    { emits: ["enters|creature|-"], demands: ["dies|creature|-"] },
  ]);
  expect(freq["enters|creature|-"]).toBe(2);
  expect(freq["dies|creature|-"]).toBe(1);
});

/** ONE CARD COUNTS ONCE PER KEY however many of its abilities touch that event. Krenko emits
 *  `enters` from a single ability; a card with three token-making abilities is still one card that
 *  supplies the event, and counting it three times would make the event look commoner than it is. */
test("a card touching one key from several abilities counts once", () => {
  const freq = countEvents([
    { emits: ["enters|creature|-", "enters|creature|-"], demands: ["enters|creature|-"] },
  ]);
  expect(freq["enters|creature|-"]).toBe(1);
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
  const rows = partnersFor(krenko, [impactTremors], FREQ, SLUGS, H);
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
  expect(partnersFor(krenko, [millstone], FREQ, SLUGS, H)).toEqual([]);
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
  expect(partnersFor(krenko, [noReason], FREQ, slugs, H)).toEqual([]);
});

test("the list is cut at KEEP", () => {
  const many = Array.from({ length: KEEP + 10 }, (_, i) => base(`Payoff ${i}`, [{
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { type: "creature", control: "you", token: null } },
    effect: { kind: "draw-card" },
  }] as unknown as CardTags["abilities"]));
  const slugs = resolveSlugs(many.map((m) => m.card.name));
  expect(partnersFor(krenko, many, FREQ, slugs, H).length).toBe(KEEP);
});

/** A CARD IS NEVER ITS OWN PARTNER. `directedReasons(x, x)` can return reasons -- self-reference is
 *  the biggest defect family this engine has had -- so the exclusion is explicit. */
test("the subject is not its own partner", () => {
  expect(partnersFor(krenko, [krenko], FREQ, SLUGS, H)).toEqual([]);
});

/** THE BUG THIS FILE FOUND, PINNED. Krenko emits `enters|creature|goblin`; Impact Tremors demands
 *  `enters|creature|-`. A goblin token entering IS a creature entering, so the pair the whole design
 *  was argued from formed no edge until the index generalised. A string comparison cannot see what
 *  the type hierarchy does. */
test("a key stands for its own coarser forms", () => {
  expect(keyVariants("enters|creature|goblin"))
    .toEqual(["enters|creature|goblin", "enters|creature|-", "enters|-|-"]);
  expect(keyVariants("enters|creature|-")).toEqual(["enters|creature|-", "enters|-|-"]);
  expect(keyVariants("draw|-|-")).toEqual(["draw|-|-"]);
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
  const rows = partnersFor(krenko, [impactTremors, goblinPayoff], FREQ, slugs, H);
  expect(rows.map((r) => r.name)).toEqual(["Goblin Bushwhacker", "Impact Tremors"]);
  expect(rows[0]!.event).toBe("enters|creature|goblin");
  expect(rows[1]!.event).toBe("enters|creature|-");
});
