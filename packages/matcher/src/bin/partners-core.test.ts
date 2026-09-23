import { MIN_INDEXABLE_PARTNERS } from "../partner-shard.js";
import { expect, test, vi } from "vitest";
import type { CardTags } from "@edh-seer/tagger";
import type { DeckCard, Hierarchy } from "../types.js";
import {
  KEEP, PARTNER_SHARD_COUNT, PER_EVENT_CAP, buildPartnerArtifact, printingIdOf, demandForms, eventKey, isSubstantive,
  partnerShardOf, partnersFor, resolveSlugs, slugOf, specificity, supplyBuckets, totalOf, browseLetterOf, browseSlices,
  supplyForms, supplyKeysOf, themesOf, inIdentityOf, identityMask, splitKey, fillDemandsOf, unmetDemands, boardCountKeysOf, feederKeysOf, emitKeysOf, abilityRowsOf, staticKeysOf, meldKeysOf, identityKeyOf, demandKeysOf, effectOrder,
} from "./partners-core.js";

/** THE CORPUS COUNT ALONE. `supplyBuckets` splits every key by colour identity (AJ5); the rules
 *  these tests pin -- what satisfies what -- are about the total, so the split is summed away. */
const counts = (rows: { emits: string[]; demands: string[] }[]): Record<string, number> =>
  Object.fromEntries([...supplyBuckets(rows.map((r) => ({ ...r, identity: [] }))).buckets]
    .map(([k, b]) => [k, totalOf(b)]));

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
  const freq = counts(rows);
  expect(freq["enters|creature,land,enchantment|-|-"]).toBe(3);
  expect(freq["enters|creature|goblin|-"]).toBe(1);
  expect(specificity("enters|creature|goblin|-", freq))
    .toBeGreaterThan(specificity("enters|creature,land,enchantment|-|-", freq));
});

/** A DEMAND IS NEVER WIDENED. `enters|-|goblin` means a goblin entering; counting every permanent as
 *  satisfying it would rebuild the bug this replaced. */
test("a subtype demand is satisfied only by that subtype", () => {
  const freq = counts([
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
test("substantive means at least one emit, one trigger, or a stated rate, nothing else", () => {
  expect(isSubstantive(krenko)).toBe(true);
  expect(isSubstantive(impactTremors)).toBe(true);
  const vanilla = base("Grizzly Bears", [] as unknown as CardTags["abilities"]);
  expect(isSubstantive(vanilla)).toBe(false);
  const staticOnly = base("Static Only", [{
    kind: "static", effect: { kind: "pump" },
  }] as unknown as CardTags["abilities"]);
  expect(isSubstantive(staticOnly)).toBe(false);
  // A CARD THAT STATES A RATE IS SUBSTANTIVE (roadmap X2, 2026-09-17): Sol Ring emits nothing the
  // edge layer reads, and without this it had no page for "adds mana" to sort.
  const solRing = base("Sol Ring", [{
    kind: "activated", cost: "{T}", effect: { kind: "mana-generation", subject: { control: "you", token: null } }, amount: "2", repeats: "per-cycle",
  }] as unknown as CardTags["abilities"]);
  (solRing.card as { manaCost?: string }).manaCost = "{1}";
  expect(isSubstantive(solRing)).toBe(true);
});

/** A GENUINELY TWO-FACED CARD HAS NO CARD-LEVEL ART, so the record has to reach into the front
 *  face. Scryfall puts `image_uris` on each FACE for transform and modal_dfc and omits the top-level
 *  one: 491 corpus cards carry no `artCrop` and EVERY one of them has `faces[0].artCrop` (measured
 *  2026-09-08), of which 359 are substantive and had a page showing no card.
 *
 *  IT COSTS MORE HERE THAN A BLANK DISC COSTS THE GRAPH. The image is the only place a card page
 *  prints rules text -- spec D2a puts the artist credit and the oracle text on the card itself
 *  rather than reprinting either -- so a DFC page was a name, a type line and nothing to read. */
test("a two-faced card's page takes the front face's art when the card has none", () => {
  const dfc = base("Valki, God of Lies // Tibalt, Cosmic Impostor", krenko.tags.abilities);
  (dfc.card as unknown as { faces: { artCrop: string }[] }).faces = [
    { artCrop: "https://cards.scryfall.io/art_crop/front/e/a/ea7e.jpg" },
    { artCrop: "https://cards.scryfall.io/art_crop/back/e/a/ea7e.jpg" },
  ];
  const { shards } = buildPartnerArtifact([dfc, impactTremors], H);
  const rec = [...shards.values()].flatMap((sh) => Object.values(sh))
    .find((r) => r.name.startsWith("Valki"))!;
  // The FRONT face: it is the side the card is played from and the side a reader recognises.
  expect(rec.artCrop).toBe("https://cards.scryfall.io/art_crop/front/e/a/ea7e.jpg");
  // AND THE BACK, so the page can turn the card over. The image is the only copy of the rules text
  // a card page carries (spec D2a), so a front-only record hides half of a transforming card.
  expect(rec.backArtCrop).toBe("https://cards.scryfall.io/art_crop/back/e/a/ea7e.jpg");
});

/** `backArtCrop` IS A FIELD AND NOT A GUESS FROM THE NAME. Split, adventure and flip cards print
 *  two names on ONE physical face and have no back image; `name.includes(" // ")` would have
 *  offered every one of them a control that turns to nothing. Measured 2026-09-08: exactly 491
 *  corpus cards carry `faces[1].artCrop` and they are exactly the 491 with no card-level art. */
test("a card with two names on one face has no back to turn to", () => {
  const split = base("Fire // Ice", krenko.tags.abilities);
  (split.card as unknown as { artCrop: string; faces: { artCrop?: string }[] }).artCrop =
    "https://cards.scryfall.io/art_crop/front/a/b/c.jpg";
  (split.card as unknown as { faces: { artCrop?: string }[] }).faces = [{}, {}];
  const { shards } = buildPartnerArtifact([split, impactTremors], H);
  const rec = [...shards.values()].flatMap((sh) => Object.values(sh))
    .find((r) => r.name === "Fire // Ice")!;
  expect(rec.artCrop).toBe("https://cards.scryfall.io/art_crop/front/a/b/c.jpg");
  expect(rec.backArtCrop).toBeNull();
});

/** Card-level art still wins, so adventure/split/flip -- one physical face, one `image_uris` -- are
 *  untouched by the fallback above. */
test("a single-faced card keeps its own art", () => {
  const { shards } = buildPartnerArtifact([
    { ...krenko, card: { ...krenko.card, artCrop: "https://cards.scryfall.io/art_crop/front/a/b/c.jpg" } },
    impactTremors,
  ] as never, H);
  const rec = [...shards.values()].flatMap((sh) => Object.values(sh))
    .find((r) => r.name === "Krenko, Mob Boss")!;
  expect(rec.artCrop).toBe("https://cards.scryfall.io/art_crop/front/a/b/c.jpg");
});

test("the artifact shards every substantive card and skips the rest", () => {
  const vanilla = base("Grizzly Bears", [] as unknown as CardTags["abilities"]);
  const { shards, index } = buildPartnerArtifact([krenko, impactTremors, vanilla], H);
  const all = [...shards.values()].flatMap((s) => Object.keys(s));
  expect(all.sort()).toEqual(["impact-tremors", "krenko-mob-boss"]);
  expect(index.map((e) => e.slug).sort()).toEqual(["impact-tremors", "krenko-mob-boss"]);
});

/** THE INDEX CARRIES EACH CARD'S PARTNER COUNT AND IS SORTED BY IT (owner 2026-09-17). The header
 *  field, the search page and the facet path all read the index in its own order, so the most
 *  connected card is the first answer to a name without any of them ranking. The count is the
 *  candidate set before verification -- the same population the pages' "N cards can cause this"
 *  counts -- because the verified list is capped and the tie-break it breaks cannot depend on it. */
test("the index carries a partner count and lists the best-connected card first", () => {
  const vanilla = base("Grizzly Bears", [] as unknown as CardTags["abilities"]);
  const { index } = buildPartnerArtifact([vanilla, impactTremors, krenko], H);
  const bySlug = Object.fromEntries(index.map((e) => [e.slug, e.partners]));
  // SYMMETRIC (2026-09-17): the Krenko-Tremors pair counts once for each end, so a payoff whose
  // only relations are the cards that feed it counts them. Equal counts order by name.
  expect(bySlug["krenko-mob-boss"]).toBe(1);
  expect(bySlug["impact-tremors"]).toBe(1);
  expect(index.map((e) => e.slug)).toEqual(["impact-tremors", "krenko-mob-boss"]);
  const lonely = base("Lonely Card", [{ kind: "triggered", trigger: { verbs: ["enters"], subject: { type: "creature", control: "you", token: null } }, effect: { kind: "draw-card" } }] as unknown as CardTags["abilities"]);
  const { index: three } = buildPartnerArtifact([lonely, impactTremors, krenko], H);
  expect(three.map((e) => [e.slug, e.partners])).toEqual([["krenko-mob-boss", 2], ["impact-tremors", 1], ["lonely-card", 1]]);
});

/** THE RECORD CARRIES THE CLAUSES NOW (spec D2a option 2, taken 2026-09-18). This test read "never
 *  card rules text" until then, and it was RIGHT for option 1: the page showed our derivation and
 *  nothing a reader could check it against, which is unfalsifiable rather than honest.
 *
 *  IT PASSED ON AN EMPTY FIXTURE, WHICH IS WHY THE FIXTURE IS NO LONGER EMPTY. `base()` builds cards
 *  with `oracleText: ""`, so `segment()` returned nothing and the key simply never appeared -- the
 *  allowlist below would have gone on reporting "no rules text" while the corpus shipped it on every
 *  page. A guard that passes because its fixture cannot reach the code is not a guard.
 *
 *  THE ALLOWLIST IS STILL THE POINT. It is what stops a future field putting the RAW oracle text
 *  back: `clauses` is `segment()`'s output, reminder text stripped, which is the engine's reading
 *  and the thing D2a's "additional value" clause turns on. */
test("a page record carries metadata, derivation, and the clauses the engine read", () => {
  const spoken = base("Spoken Card", [{ kind: "triggered", trigger: { verbs: ["enters"], subject: { type: "creature", control: "you", token: null } }, effect: { kind: "draw-card" } }] as unknown as CardTags["abilities"]);
  spoken.card = { ...spoken.card, oracleText: "Whenever a creature you control enters, draw a card." } as DeckCard["card"];
  const { shards } = buildPartnerArtifact([spoken, krenko, impactTremors], H);
  const all = [...shards.values()].flatMap((s) => Object.entries(s));
  const rec = all.find(([slug]) => slug === "spoken-card")![1];
  expect(Object.keys(rec).sort()).toEqual(
    ["abilities", "artCrop", "backArtCrop", "clauses", "commander", "demands", "emits", "identity",
      "manaCost", "name", "partners", "pool", "rarity", "typeLine"],
  );
  // THE ID TRAVELS WITH THE TEXT since AJ4: every derived ability is stamped with the clause that
  // printed it, and the page joins the two by ID -- never by position, which this list's own
  // empty-segment filter would shift.
  expect(rec.clauses).toEqual([{ id: 1, text: "Whenever a creature you control enters, draw a card." }]);

  // A CARD WITH NO RULES TEXT GETS NO KEY, not an empty array: a heading over nothing is worse than
  // no heading, and the readers decide on the field's presence.
  const vanilla = all.find(([slug]) => slug === "krenko-mob-boss")![1];
  expect(Object.keys(vanilla)).not.toContain("clauses");
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

/** ONE EVENT, ONE SPELLING SINCE AK6. `zoneEventKey` has always renamed the canonical tag
 *  (`leaves-graveyard:creature`) while `eventKey` dropped the zone and kept `leaves|creature|-`,
 *  so the two layers spelled one event two ways. The pair still formed -- the engine verifies on
 *  the TAG, which is why Tormod's page was never polluted with blink cards -- but the KEY is what
 *  the event search lists and groups by, and under it 2,350 reanimation cards answered "a creature
 *  leaves the battlefield". Both layers now say `leaves-graveyard`, and this test still proves the
 *  join survives the rename: both sides are built by the functions that build them for real. */
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
    expect(rows[0]!.event).toBe("leaves-graveyard|creature|-|-");
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

/** AND THE COUNT BESIDE THOSE ROWS IS SCOPED TOO (roadmap AJ5, measured 2026-09-19).
 *
 *  `rankedFor` has always filtered the candidates and recomputed `pool` over the legal set, but
 *  `rarity` came straight off the one corpus-wide supply map, so `commanderRarity` was
 *  byte-identical to `rarity`. Samut, the Driving Force (R/G/W) showed ONE Cleric-granting partner
 *  above "588 other cards cause it too" -- a figure counted over cards its deck can never play.
 *  The card page keeps the corpus figure: there is no deck there, so there are no colours to
 *  filter by. THE SCORE DOES NOT MOVE -- `specificity` stays corpus-wide by design. */
test("a commander's rarity counts only the causes its deck could legally contain", () => {
  const maker = (name: string, identity: string[]) => withIdentity(base(name, [{
    kind: "activated", cost: "{T}",
    effect: { kind: "token-generation", subject: { control: "you", token: true, type: "creature", subtype: "goblin" } },
    emits: [
      { verb: "create-token", subject: { control: "you", token: true, type: "creature", subtype: "goblin" } },
      { verb: "enters", subject: { control: "you", token: true, type: "creature", subtype: "goblin" } },
    ],
  }] as unknown as CardTags["abilities"], ["goblin"]), identity);
  const asker = asCommander(base("Red Asker", [{
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { type: "creature", control: "you", token: null } },
    effect: { kind: "draw-card" },
  }] as unknown as CardTags["abilities"]), ["R"]);

  const { shards } = buildPartnerArtifact(
    [asker, maker("Red Maker", ["R"]), maker("Simic Maker", ["G", "U"]), maker("Colourless Maker", [])], H);
  const rec = [...shards.values()].flatMap((s) => Object.values(s)).find((r) => r.name === "Red Asker")!;

  // The rows themselves are already scoped: the Simic maker is in neither list.
  expect(rec.commanderPartners!.map((p) => p.name).sort())
    .toEqual(["Colourless Maker", "Red Maker"]);

  expect(rec.rarity["enters|creature|-|-"]).toBe(3);
  expect(rec.commanderRarity!["enters|creature|-|-"]).toBe(2);
  // The ranking basis is untouched: both rows are priced on the corpus figure, not the scoped one.
  expect(rec.commanderPartners![0]!.score).toBe(rec.partners.find((p) => p.name === "Red Maker")!.score);
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
  const freq = counts([
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

/** A ROW KNOWS ITS FACE (owner, 2026-09-08: the art flips, the rows did not). A back-face ability
 *  carries the face index the derivation stamped; a front-face or single-face row carries none. */
test("a back-face ability row carries its face, a front-face row does not", () => {
  const chandra = base("Chandra, Fire of Kaladesh // Chandra, Roaring Flame", [
    { kind: "triggered", trigger: { verbs: ["cast"], subject: { control: "you", token: null, type: "spell" } }, effect: { kind: "untap" } },
    { kind: "activated", cost: "−7", face: 1, effect: { kind: "emblem", subject: { control: "opp", token: null } } },
  ] as never);
  const rows = abilityRowsOf(chandra);
  expect(rows[0]!.face).toBeUndefined();
  expect(rows[1]!.face).toBe(1);
});

/** A SELF EMIT NAMES THE CARD. "Untap Chandra" puts Chandra untapping into the game, not anything
 *  untapping; the key drops the flag, so the row carries the self keys beside the emits. */
test("an ability row lists the emits whose subject is the card itself", () => {
  const chandra = base("Chandra, Fire of Kaladesh", [{
    kind: "triggered",
    trigger: { verbs: ["cast"], subject: { control: "you", token: null, type: "spell" } },
    effect: { kind: "untap", subject: { control: "any", token: null, self: true } },
    emits: [
      { verb: "untaps", subject: { control: "any", token: null, self: true } },
      { verb: "non-combat-damage", subject: { control: "any", token: null, type: "creature" } },
    ],
  }] as never);
  const rows = abilityRowsOf(chandra);
  expect(rows[0]!.emits).toEqual(["untaps|-|-|-", "non-combat-damage|creature|-|-"]);
  expect(rows[0]!.selfEmits).toEqual(["untaps|-|-|-"]);
  expect(abilityRowsOf(impactTremors)[0]!.selfEmits).toBeUndefined();
});

/** THE COLOUR AND THE SELF THE KEY CANNOT CARRY (owner, 2026-09-08). Chandra untaps on a red spell
 *  and untaps herself; the row says both beside the keys. */
test("an ability row carries the trigger's colours and whether the effect is on itself", () => {
  const chandra = base("Chandra, Fire of Kaladesh", [{
    kind: "triggered",
    trigger: { verbs: ["cast"], subject: { control: "you", token: null, type: "spell", colors: ["R"] } },
    effect: { kind: "untap", subject: { control: "any", token: null, self: true } },
    emits: [{ verb: "untaps", subject: { control: "any", token: null, self: true } }],
  }] as never);
  const row = abilityRowsOf(chandra)[0]!;
  expect(row.whenColors).toEqual(["R"]);
  expect(row.effectSelf).toBe(true);
  const tremors = abilityRowsOf(impactTremors)[0]!;
  expect(tremors.whenColors).toBeUndefined();
  expect(tremors.effectSelf).toBeUndefined();
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
    // ONE TYPE PER KEY since AK5: the discount reaches six types, so it is six demands, in the
    // order the key listed them.
    "applies:cost-reduction|artifact|-|-",
    "applies:cost-reduction|enchantment|-|-",
    "applies:cost-reduction|planeswalker|-|-",
    "applies:cost-reduction|instant|-|-",
    "applies:cost-reduction|sorcery|-|-",
    "applies:cost-reduction|battle|-|-",
  ]);
  const propaganda = base("Propaganda", [
    { kind: "static", effect: { kind: "tax", subject: { control: "opp", token: null, type: "creature" } } },
    { kind: "static", effect: { kind: "type-grant", subject: { control: "you", token: null, type: "land", self: true } } },
  ] as unknown as CardTags["abilities"]);
  expect(staticKeysOf(propaganda)).toEqual([]);
  // A ZONE-SCOPED static reaches no printed card: `staticClaim` fails it in `subjectMatches`, so
  // Lurrus's graveyard recursion (DERIVE 166 kept the subject) must not become five whole-board keys.
  const lurrus = base("Lurrus of the Dream-Den", [
    { kind: "static", effect: { kind: "graveyard-recursion", subject: {
      control: "you", token: null, type: ["creature", "artifact", "enchantment", "planeswalker", "battle"],
      umbrella: "permanent", stats: [{ metric: "mana-value", op: "lte", value: 2 }], zone: "graveyard" } } },
  ] as unknown as CardTags["abilities"]);
  expect(staticKeysOf(lurrus)).toEqual([]);
  expect(isSubstantive(samut())).toBe(true);
  expect(isSubstantive(propaganda)).toBe(false);
});

test("a static reaches the cards it applies to, each verified by the engine's own sentence", () => {
  const slugs = resolveSlugs(["Samut, the Driving Force", "Dragon Fodder", "Goblin Assassin", "Forest"]);
  const bauble = withTypes(base("Blue Bauble", []), ["artifact"], "{U}");
  const { rows, pool } = partnersFor(samut(), [forest(), bauble, dragonFodder(), goblinBody()], [], {}, slugs, H);
  expect(rows.map((r) => r.name).sort()).toEqual(["Dragon Fodder", "Goblin Assassin"]);
  const fodder = rows.find((r) => r.name === "Dragon Fodder")!;
  // AK5 attributes the row to the type the card actually IS -- Dragon Fodder is a sorcery -- where
  // the combined key named six types the reader had to sift.
  expect(fodder.event).toBe("applies:cost-reduction|sorcery|-|-");
  expect(fodder.reason).toBe("Samut, the Driving Force reduces what Dragon Fodder costs");
  const body = rows.find((r) => r.name === "Goblin Assassin")!;
  expect(body.event).toBe("applies:pump|creature|-|-");
  expect(body.reason).toBe("Samut, the Driving Force gives Goblin Assassin bigger stats");
  // A `{U}` spell cannot cost less (CR 118.7): the engine refuses it, and the pool counted it
  // before the cut. Since AK5 the pool is counted PER TYPE, so the artifact Bauble sits under
  // `applies:cost-reduction|artifact|-|-` and the sorcery key counts the sorcery alone -- which is
  // the honest denominator for "a sorcery it makes cheaper to cast". The land was never a
  // candidate: the key names no land type.
  expect(pool[fodder.event]).toBe(1);
  expect(pool["applies:cost-reduction|artifact|-|-"]).toBe(1);
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
  expect(rows).toHaveLength(Math.min(PER_EVENT_CAP, 5));
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

/** THE INDEX CARRIES THE INDEXABILITY, because the SITEMAP is built from the index and the
 *  `noindex` decision is made at the edge from the SHARD. Nothing reconciled the two until
 *  2026-09-08, and 2,823 of the sitemap's 20,161 URLs were submitted to Google and then served
 *  `<meta name="robots" content="noindex">` -- a Search Console error apiece.
 *
 *  A card below the floor is a real page and stays reachable; it is only not PROMISED.
 *
 *  THE FLOOR IS `MIN_INDEXABLE_PARTNERS`, NOT ZERO (2026-09-08): a page whose body is one or two
 *  sentences is thin content. This fixture ranks Samut two partners on the card surface and one on
 *  the commander surface, so with a floor of three she is flagged on both -- which is the
 *  assertion, because a flag that only fired on emptiness would let those pages through. */
test("the index flags a page below the partner floor, per surface", () => {
  expect(MIN_INDEXABLE_PARTNERS).toBe(3);
  const cmdr = asCommander(samut(), ["G", "R", "W"]);
  const offColour = asCommander(withIdentity(plainSorcery("Counterspell"), ["U"]), ["U"]);
  const { index, shards } = buildPartnerArtifact([cmdr, offColour, dragonFodder(), forest()], H);
  const at = (name: string) => index.find((e) => e.name === name)!;
  const rec = [...shards.values()].flatMap((s) => Object.values(s)).find((r) => r.name === "Samut, the Driving Force")!;
  expect(rec.partners.length).toBeLessThan(MIN_INDEXABLE_PARTNERS);
  expect(rec.partners.length).toBeGreaterThan(0);
  expect(at("Samut, the Driving Force").thin).toBe(true);
  expect(at("Samut, the Driving Force").thinCommander).toBe(true);
  // Nothing to rank on either surface: both URLs are withheld from the sitemap and both are still
  // served, because a page with nothing to say is reachable and merely not promised.
  expect(at("Counterspell").commander).toBe(true);
  expect(at("Counterspell").thin).toBe(true);
  expect(at("Counterspell").thinCommander).toBe(true);
  // A card that cannot lead a deck never carries the commander flag -- there is no such URL to
  // withhold, and the sitemap already filters it on `commander`.
  expect(at("Dragon Fodder").commander).toBe(false);
  expect(at("Dragon Fodder").thinCommander).toBeUndefined();
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
 *  Clerics (owner, 2026-09-05; CR 700.8). */
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

/** THE PAGE PROPOSES BY KEY BEFORE THE ENGINE VERIFIES, so a verb the engine bridges has to be
 *  bridged here too or the pair is never asked about. Lightning Bolt's page (2026-09-05) listed
 *  three damage payoffs and no life-loss one, while the deck report drew Bolt -> Samut through
 *  CR 120.3. Same for a death satisfying a leave (CR 700.4). */
test("a supply form carries the verbs the engine lets it satisfy", () => {
  expect(supplyForms("non-combat-damage|-|-|-")).toContain("lose-life|-|-|-");
  expect(supplyForms("non-combat-damage|creature|-|-")).not.toContain("lose-life|creature|-|-");
  expect(supplyForms("non-combat-damage|creature|-|-")).not.toContain("lose-life|-|-|-");
  expect(supplyForms("dies|creature|goblin|t")).toContain("leaves|creature|goblin|t");
});

test("a burn spell's page lists a life-loss payoff, verified by the engine", () => {
  const bolt = base("Lightning Bolt", [{
    kind: "on-cast", effect: { kind: "damage" },
    emits: [{ verb: "non-combat-damage", subject: { control: "any", scope: "target", token: null }, dealer: { control: "you", token: null } }],
  }] as unknown as CardTags["abilities"]);
  const ascension = base("Bloodchief Ascension", [{
    kind: "triggered", trigger: { verbs: ["lose-life"], subject: { control: "opp", token: null } }, effect: { kind: "drain" },
  }] as unknown as CardTags["abilities"]);
  const { shards } = buildPartnerArtifact([bolt, ascension], H);
  const rec = [...shards.values()].flatMap((s) => Object.values(s)).find((r) => r.name === "Lightning Bolt")!;
  const row = rec.partners.find((r) => r.name === "Bloodchief Ascension")!;
  expect(row.event).toBe("lose-life|-|-|-");
});

test("an ability-loss static reaches no partner on the page", () => {
  const humility = base("Humility", [
    { kind: "static", effect: { kind: "ability-loss", subject: { control: "any", token: null, type: "creature", scope: "all" } } },
  ] as unknown as CardTags["abilities"]);
  expect(staticKeysOf(humility)).toEqual([]);
});

/** A "MAX SPEED" ROW SAYS WHAT IT NEEDS. The requirement rides from derive to the page, so a
 *  reader sees the condition the deck report only honours under a state (roadmap W18). */
test("an ability row carries its game-state requirement", () => {
  const surveyor = base("Goblin Surveyor", [{
    kind: "activated", cost: "{3}, Exile this card from your graveyard", requires: { marker: "speed", min: 4 },
    effect: { kind: "draw-card" }, emits: [{ verb: "draw", subject: { control: "you", token: null } }],
  }] as unknown as CardTags["abilities"]);
  expect(abilityRowsOf(surveyor)[0]!.requires).toEqual({ marker: "speed", min: 4 });
});

/** THE BROWSE SLICES: one file per letter, so a browse page costs one small fetch at the edge
 *  rather than parsing the 1.6 MB name index on every request. */
test("the index slices by first letter, sorted by name", () => {
  const slices = browseSlices([
    { slug: "krenko-mob-boss", name: "Krenko, Mob Boss", identity: ["R"], commander: true },
    { slug: "kodamas-reach", name: "Kodama's Reach", identity: ["G"], commander: false },
    { slug: "impact-tremors", name: "Impact Tremors", identity: ["R"], commander: false },
  ]);
  // Every letter has a slice, empty ones included: the alphabet the page prints and the files
  // behind it must not be able to disagree.
  expect(slices.size).toBe(27);
  expect(slices.get("Q")).toEqual([]);
  expect(slices.get("K")!.map((r) => r.name)).toEqual(["Kodama's Reach", "Krenko, Mob Boss"]);
  // The row is the least that makes a link -- the slices exist to be SMALL, so a field no listing
  // renders would give back the size they were cut for.
  expect(Object.keys(slices.get("I")![0]!).sort()).toEqual(["commander", "name", "slug"]);
});

/** DIACRITICS FOLD, exactly as they do in `slugOf`. `Jötun Grunt` belongs on J -- not on a page of
 *  its own, and not missing from the walk entirely. */
test("a diacritic lands on the letter a reader would look under", () => {
  expect(browseLetterOf("Jötun Grunt")).toBe("J");
  // `Æ` is a ligature and NFD does not decompose it; a first pass at this filed `Ætherling` under
  // `#`. Reading the letter off `slugOf` fixes it AND guarantees the page a card is filed under
  // matches the first character of the URL it is filed at.
  expect(browseLetterOf("Ætherling")).toBe("A");
  expect(slugOf("Ætherling")[0]).toBe("a");
  expect(browseLetterOf("Lim-Dûl's Vault")).toBe("L");
});

/** `#` COLLECTS WHAT DOES NOT START WITH A LETTER. One card in the corpus today, and the page
 *  exists so that walking the alphabet reaches every card rather than almost every card. */
test("a name that starts with no letter still has a page to be found on", () => {
  // No corpus card lands here today -- `_____` slugs to `card` and files under C -- which is
  // exactly why the slice is written anyway: the nav prints the letter regardless.
  expect(browseSlices([]).get("#")).toEqual([]);
  expect(browseLetterOf("!!!")).toBe("#");
  expect(browseLetterOf("+2 Mace")).toBe("#");
  expect(browseLetterOf("")).toBe("#");
});

// OWNER'S RULING 2026-09-09: a bare non-creature type count is a row, and the two gates agree.
test("an artifact count keys on the type; a creature count keys on nothing; an artifact supplies the type", () => {
  const artist = { card: { name: "Storm-Kiln Artist" }, tags: { characteristics: { types: ["creature"], subtypes: ["dwarf"] }, abilities: [{
    kind: "static", effect: { kind: "pump", scaling: "per-permanent", scalingSubject: { control: "you", token: null, type: "artifact", zone: "battlefield" } },
  }] } } as unknown as DeckCard;
  expect(boardCountKeysOf(artist)).toEqual(["counts|-|artifact|-"]);
  const anthem = { card: { name: "Anthem" }, tags: { characteristics: { types: ["enchantment"], subtypes: [] }, abilities: [{
    kind: "static", effect: { kind: "pump", scaling: "per-permanent", scalingSubject: { control: "you", token: null, type: "creature", zone: "battlefield" } },
  }] } } as unknown as DeckCard;
  expect(boardCountKeysOf(anthem)).toEqual([]);
  const rock = { card: { name: "Sol Ring" }, tags: { characteristics: { types: ["artifact"], subtypes: [] }, abilities: [] } } as unknown as DeckCard;
  expect(supplyKeysOf(rock)).toContain("counts|-|artifact|-");
  expect(supplyKeysOf(goblinBody())).not.toContain("counts|-|creature|-");
});

// THE TWO NEW FEEDER SHAPES (2026-09-09): a copier's and an outlet's page can name their feeders.
test("a copier demands ability kinds and a card with a triggered ability supplies one", () => {
  const strionic = { card: { name: "Strionic Resonator" }, tags: { characteristics: { types: ["artifact"], subtypes: [] }, abilities: [{
    kind: "activated", cost: "{2}, {T}", effect: { kind: "copy-ability", subject: { control: "you", token: null, abilityKind: ["triggered"] } },
  }] } } as unknown as DeckCard;
  expect(feederKeysOf(strionic)).toEqual(["copies|-|triggered|-"]);
  const solemn = { card: { name: "Solemn Simulacrum" }, tags: { characteristics: { types: ["artifact", "creature"], subtypes: ["golem"] }, abilities: [{
    kind: "triggered", trigger: { verbs: ["enters"], subject: { control: "you", token: null, self: true } }, effect: { kind: "ramp" },
  }] } } as unknown as DeckCard;
  expect(supplyKeysOf(solemn)).toContain("copies|-|triggered|-");
  expect(supplyKeysOf(solemn)).not.toContain("copies|-|activated|-");
  const rock = { card: { name: "Sol Ring" }, tags: { characteristics: { types: ["artifact"], subtypes: [] }, abilities: [{ kind: "activated", cost: "{T}", effect: { kind: "mana-generation" } }] } } as unknown as DeckCard;
  expect(supplyKeysOf(rock)).toContain("copies|-|mana|-");
  expect(supplyKeysOf(rock)).not.toContain("copies|-|activated|-");
  // AN OPPONENT'S ABILITY HAS NO FEEDER ON YOUR PAGE: Aboleth Spawn copies a trigger of a creature
  // entering under an OPPONENT'S control, so its page demands nothing of this deck. Same reading as
  // the engine's copy-ability pass, which is the contract this module is held to.
  const spawn = { card: { name: "Aboleth Spawn" }, tags: { characteristics: { types: ["creature"], subtypes: ["fish", "horror"] }, abilities: [{
    kind: "triggered", effect: { kind: "copy-ability", subject: { control: "opp", token: null, abilityKind: ["triggered"] } },
  }] } } as unknown as DeckCard;
  expect(feederKeysOf(spawn)).toEqual([]);
});

test("an outlet demands what it eats; a token maker and a narrow type supply it, a plain creature does not", () => {
  const engineer = { card: { name: "Goblin Engineer" }, tags: { characteristics: { types: ["creature"], subtypes: ["goblin", "artificer"] }, abilities: [{
    kind: "activated", cost: "{R}, {T}, Sacrifice an artifact", effect: { kind: "graveyard-recursion" },
    emits: [{ verb: "sacrifice", subject: { control: "you", token: null, type: "artifact" } }],
  }] } } as unknown as DeckCard;
  expect(feederKeysOf(engineer)).toEqual(["fodder|-|artifact|-"]);
  const seer = { card: { name: "Viscera Seer" }, tags: { characteristics: { types: ["creature"], subtypes: ["vampire", "wizard"] }, abilities: [{
    kind: "activated", cost: "Sacrifice a creature", effect: { kind: "scry" },
    emits: [{ verb: "sacrifice", subject: { control: "you", token: null, type: "creature" } }],
  }] } } as unknown as DeckCard;
  expect(feederKeysOf(seer)).toEqual(["fodder|-|creature|-"]);
  expect(supplyKeysOf(krenkoCounting())).toContain("fodder|-|creature|-");   // makes Goblin creature tokens
  expect(supplyKeysOf(goblinBody())).not.toContain("fodder|-|creature|-");   // a body is not free fodder
  expect(supplyKeysOf(goblinBody())).toContain("fodder|-|goblin|-");          // but it is a Goblin to eat
  const rock = { card: { name: "Sol Ring" }, tags: { characteristics: { types: ["artifact"], subtypes: [] }, abilities: [] } } as unknown as DeckCard;
  expect(supplyKeysOf(rock)).toContain("fodder|-|artifact|-");
  // An edict demands nothing.
  const edict = { card: { name: "Fleshbag" }, tags: { characteristics: { types: ["creature"], subtypes: [] }, abilities: [{
    kind: "triggered", effect: { kind: "forced-sacrifice" }, emits: [{ verb: "sacrifice", subject: { control: "any", token: null, type: "creature" } }],
  }] } } as unknown as DeckCard;
  expect(feederKeysOf(edict)).toEqual([]);
});

// THE `fills|` BRIDGE (2026-09-16): four engine passes read a graveyard and none is a trigger, so
// no page could ask about a mill. A fill emit supplies the key; a reanimator, a per-graveyard
// payoff, a graveyard count and a delve spell demand it; the engine verifies on its own tag.
test("supplyForms: a nontoken death fills the graveyard with its class, a mill fills it untyped, a token fills nothing", () => {
  expect(supplyForms("dies|creature|goblin|n")).toEqual(expect.arrayContaining(["fills|creature|goblin|-", "fills|creature|-|-", "fills|-|-|-"]));
  expect(supplyForms("mill|-|-|-")).toContain("fills|-|-|-");
  expect(supplyForms("mill|-|-|-")).not.toContain("fills|creature|-|-");
  expect(supplyForms("discard|-|-|-")).toContain("fills|-|-|-");
  expect(supplyForms("enters-graveyard|-|-|-")).toContain("fills|-|-|-");
  expect(supplyForms("dies|creature|-|t")).not.toContain("fills|-|-|-");
  expect(supplyForms("enters|creature|-|n")).not.toContain("fills|-|-|-");
});

test("fillDemandsOf: a recursion, a per-graveyard payoff, a graveyard count and delve each demand a fill, with the engine's tag", () => {
  const animate = { card: { name: "Animate Dead" }, tags: { characteristics: { types: ["enchantment"], subtypes: ["aura"], keywords: [] }, abilities: [{
    kind: "triggered", effect: { kind: "graveyard-recursion", subject: { control: "any", token: null, type: "creature", zone: "graveyard" } },
  }] } } as unknown as DeckCard;
  expect(feederKeysOf(animate)).toEqual(["fills|creature|-|-"]);
  expect(fillDemandsOf(animate)[0]!.tags).toEqual(["graveyard-recursion:creature"]);
  const beast = { card: { name: "Krosan Beast" }, tags: { characteristics: { types: ["creature"], subtypes: ["squirrel"], keywords: [] }, abilities: [{
    kind: "static", effect: { kind: "pump" }, threshold: { atLeast: 7 }, thresholdSubject: { control: "you", token: null, zone: "graveyard" },
  }] } } as unknown as DeckCard;
  expect(feederKeysOf(beast)).toEqual(["fills|-|-|-"]);
  expect(fillDemandsOf(beast)[0]!.tags).toEqual(["threshold:any"]);
  const glamdring = { card: { name: "Glamdring" }, tags: { characteristics: { types: ["artifact"], subtypes: ["equipment"], keywords: [] }, abilities: [{
    kind: "static", effect: { kind: "pump", scaling: "per-graveyard", scalingSubject: { control: "you", token: null, type: ["instant", "sorcery"], zone: "graveyard" } },
  }] } } as unknown as DeckCard;
  // AK5: an instant OR a sorcery in the yard is two demands, not one.
  expect(feederKeysOf(glamdring)).toEqual(["fills|instant|-|-", "fills|sorcery|-|-"]);
  // An untyped per-graveyard count is refused by the engine, so it is not proposed either.
  const monument = { card: { name: "Riverchurn Monument" }, tags: { characteristics: { types: ["artifact"], subtypes: [], keywords: [] }, abilities: [{
    kind: "activated", effect: { kind: "mill", scaling: "per-graveyard", scalingSubject: { control: "any", token: null, zone: "graveyard" } },
  }] } } as unknown as DeckCard;
  expect(feederKeysOf(monument)).toEqual([]);
  const dig = { card: { name: "Dig Through Time" }, tags: { characteristics: { types: ["instant"], subtypes: [], keywords: ["Delve"] }, abilities: [] } } as unknown as DeckCard;
  expect(feederKeysOf(dig)).toEqual(["fills|-|-|-"]);
  expect(fillDemandsOf(dig)[0]!.tags).toEqual(["mill:any", "discard:any", "dies:any", "enters-graveyard:any"]);
  // A battlefield count is not a fill.
  expect(fillDemandsOf(krenkoCounting())).toEqual([]);
});

// THE PARTNER COUNT BREAKS A TIE, AND ONLY A TIE (owner ruling 2026-09-17, replacing the
// 2026-09-16 play-rate tie-break: "edhrec rank changes daily, so I would not use that"). Two payoffs
// with the same demand score identically; the better-connected one -- more candidate partners in
// the corpus, the engine's own number -- is verified and printed first whatever order the corpus
// handed them over in. A rarer demand still outranks a well-connected card on a common one, and a
// card with no count sorts last.
test("equal specificity is ordered by partner count; a rarer demand still leads", () => {
  const payoff = (name: string, subtype?: string) => base(name, [{
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { type: "creature", control: "you", token: null, ...(subtype ? { subtype } : {}) } },
    effect: { kind: "draw-card" },
  }] as unknown as CardTags["abilities"]);
  const lonely = payoff("Lonely Payoff");
  const connected = payoff("Connected Payoff");
  const uncounted = payoff("Uncounted Payoff");
  const goblinOnly = payoff("Goblin Payoff", "goblin");
  const slugs = resolveSlugs(["Lonely Payoff", "Connected Payoff", "Uncounted Payoff", "Goblin Payoff"]);
  const freq = { "enters|creature|-|-": 2000, "enters|creature|goblin|-": 40 };
  const degree = new Map([["Lonely Payoff", 3], ["Connected Payoff", 900], ["Goblin Payoff", 1]]);
  const { rows } = partnersFor(krenko, [uncounted, lonely, goblinOnly, connected], [], freq, slugs, H, undefined, degree);
  expect(rows.map((r) => r.name)).toEqual(["Goblin Payoff", "Connected Payoff", "Lonely Payoff", "Uncounted Payoff"]);
});

// THE `fills|` BRIDGE END TO END: a graveyard count's page lists the mill that feeds it (feeder
// phase), the mill's page lists the count (forward phase), and delve is fed the same way -- every
// row verified on the engine's own tag.
test("a graveyard count is fed by a mill on both pages, and delve too", () => {
  const scour = base("Thought Scour", [{ kind: "on-cast", effect: { kind: "mill" }, emits: [{ verb: "mill", subject: { control: "you", token: null } }] }]);
  const beast = base("Krosan Beast", [{ kind: "static", effect: { kind: "pump" }, threshold: { atLeast: 7 },
    thresholdSubject: { control: "you", token: null, zone: "graveyard" } }] as unknown as CardTags["abilities"]);
  const dig = base("Dig Through Time", []);
  dig.tags.characteristics.keywords = ["Delve"];
  dig.tags.characteristics.types = ["instant"];
  const slugs = resolveSlugs(["Thought Scour", "Krosan Beast", "Dig Through Time"]);
  const freq = { "fills|-|-|-": 900 };
  const onBeast = partnersFor(beast, [], [scour], freq, slugs, H);
  expect(onBeast.rows.map((r) => [r.name, r.event])).toEqual([["Thought Scour", "fills|-|-|-"]]);
  expect(onBeast.rows[0]!.reason).toBe("Thought Scour fills your graveyard toward the 7 or more cards Krosan Beast needs");
  expect(onBeast.pool["fills|-|-|-"]).toBe(1);
  const onScour = partnersFor(scour, [beast, dig], [], freq, slugs, H);
  expect(onScour.rows.map((r) => r.name).sort()).toEqual(["Dig Through Time", "Krosan Beast"]);
  const onDig = partnersFor(dig, [], [scour], freq, slugs, H);
  expect(onDig.rows.map((r) => r.name)).toEqual(["Thought Scour"]);
  expect(onDig.rows[0]!.reason).toBe("Thought Scour fills the graveyard Dig Through Time delves from");
  // A FETCHLAND FILLS WITH ITSELF, ONCE, and sorts behind a mill engine however connected it is.
  const wilds = base("Evolving Wilds", [{ kind: "activated", cost: "{T}, Sacrifice this land", effect: { kind: "search" },
    emits: [{ verb: "sacrifice", subject: { control: "you", token: null, type: "land", self: true } }, { verb: "dies", subject: { control: "you", token: null, type: "land", self: true } }] }]);
  wilds.tags.characteristics.types = ["land"];
  const degree = new Map([["Evolving Wilds", 5000], ["Thought Scour", 40]]);
  const ordered = partnersFor(beast, [], [wilds, scour], freq, resolveSlugs(["Evolving Wilds", "Thought Scour", "Krosan Beast"]), H, undefined, degree);
  expect(ordered.rows.map((r) => r.name)).toEqual(["Thought Scour", "Evolving Wilds"]);
  // An opponent's mill fills nothing of yours: proposed by key, refused by the engine, counted.
  const funeral = base("Mind Funeral", [{ kind: "on-cast", effect: { kind: "mill" }, emits: [{ verb: "mill", subject: { control: "opp", token: null } }] }]);
  const refused = partnersFor(beast, [], [funeral], freq, resolveSlugs(["Mind Funeral", "Krosan Beast"]), H);
  expect(refused.rows).toEqual([]);
  expect(refused.pool["fills|-|-|-"]).toBe(1);
});

// AF7d: a damage emit proposes itself to the receiving side too; the engine verifies the victim.
test("supplyForms: a damage emit also stands for `damaged`", () => {
  expect(supplyForms("non-combat-damage|creature|-|n")).toContain("damaged|creature|-|n");
  expect(supplyForms("combat-damage|-|-|n")).toContain("damaged|-|-|n");
  expect(supplyForms("dies|creature|-|n")).not.toContain("damaged|creature|-|n");
});

/** A TILE NEEDS THE ROW'S ART AND COLOURS (2026-09-17). The partner list rendered as two text
 *  columns because a row carried nothing scannable. The row carries the 36-character printing id,
 *  not the URL, and no field at all when the card has no art. */
test("a partner row and an index entry carry the printing id and the identity", () => {
  const tremors = base("Impact Tremors", impactTremors.tags.abilities);
  (tremors.card as unknown as { artCrop: string; colorIdentity: string[] }).artCrop =
    "https://cards.scryfall.io/art_crop/front/5/7/57adbd6e-88ec-4472-a9c9-90b679fa881f.jpg?1783922746";
  (tremors.card as unknown as { colorIdentity: string[] }).colorIdentity = ["R"];
  const { shards, index } = buildPartnerArtifact([krenko, tremors], H);
  const rec = [...shards.values()].flatMap((sh) => Object.values(sh)).find((r) => r.name === "Krenko, Mob Boss")!;
  const row = rec.partners.find((p) => p.name === "Impact Tremors")!;
  expect(row.art).toBe("57adbd6e-88ec-4472-a9c9-90b679fa881f");
  expect(row.identity).toEqual(["R"]);
  expect(index.find((e) => e.name === "Impact Tremors")?.art).toBe("57adbd6e-88ec-4472-a9c9-90b679fa881f");
  expect(index.find((e) => e.name === "Krenko, Mob Boss")?.art).toBeUndefined();
  expect(printingIdOf(null)).toBeUndefined();
  expect(printingIdOf("https://example.com/x.jpg")).toBeUndefined();
  expect(printingIdOf("https://cards.scryfall.io/art_crop/back/e/a/ea7e0000-0000-4000-8000-000000000000.png")).toBe("ea7e0000-0000-4000-8000-000000000000");
});

/** PRODUCERS ON A PAYOFF'S PAGE (owner 2026-09-17: "lets start with 1"). Every pair the forward
 *  phase verifies is one edge seen from the producer's side; the same edge, mirrored, is the row
 *  the payoff's page never had. Krenko's page said Impact Tremors; Impact Tremors' page said
 *  nothing, and its count was the cards that ask for damage. Same sentence, same event, same
 *  score, `producer` set so the page can say which way it runs, and no payoff of its own -- the
 *  tail of that sentence is the PAYOFF's behaviour, not the producer's. The count is symmetric. */
test("a payoff's page mirrors every verified producer, and the count is symmetric", () => {
  const { shards, index } = buildPartnerArtifact([krenko, impactTremors], H);
  const rec = Object.fromEntries([...shards.values()].flatMap((s) => Object.entries(s)));
  const onKrenko = rec["krenko-mob-boss"]!.partners.find((r) => r.name === "Impact Tremors")!;
  const onTremors = rec["impact-tremors"]!.partners;
  expect(onTremors).toHaveLength(1);
  expect(onTremors[0]).toMatchObject({ name: "Krenko, Mob Boss", slug: "krenko-mob-boss", producer: true,
    event: onKrenko.event, reason: onKrenko.reason, score: onKrenko.score });
  expect(onTremors[0]!.payoff).toBeUndefined();
  expect(onTremors[0]!.unread).toBeUndefined();
  expect(rec["impact-tremors"]!.pool[onKrenko.event]).toBe(1);
  expect(rec["impact-tremors"]!.rarity[onKrenko.event]).toBe(rec["krenko-mob-boss"]!.rarity[onKrenko.event]);
  expect(Object.fromEntries(index.map((e) => [e.slug, e.partners]))).toEqual({ "impact-tremors": 1, "krenko-mob-boss": 1 });
});

/** THE MIRROR IS CAPPED LIKE EVERY OTHER GROUP, and counted before the cap: ten token makers all
 *  verified against one payoff put eight on its page and a pool of ten beside them. */
test("producer rows respect the per-event cap and the pool counts them all", () => {
  const makers = Array.from({ length: PER_EVENT_CAP + 2 }, (_, i) => base(`Maker ${i}`, krenko.tags.abilities, ["goblin"]));
  const { shards } = buildPartnerArtifact([...makers, impactTremors], H);
  const rec = Object.fromEntries([...shards.values()].flatMap((s) => Object.entries(s)));
  const rows = rec["impact-tremors"]!.partners;
  expect(rows).toHaveLength(PER_EVENT_CAP);
  expect(rows.every((r) => r.producer)).toBe(true);
  expect(rec["impact-tremors"]!.pool[rows[0]!.event]).toBe(PER_EVENT_CAP + 2);
});

/** THE RATE RIDES ON THE PAGE RECORD (owner 2026-09-17), and only when there is one to state. */
test("a page record carries the card's rates, and none when no ability states a number", () => {
  // An emit, so the card is substantive and gets a page at all (`isSubstantive`).
  const divination = base("Divination", [{ kind: "on-cast", effect: { kind: "draw-card", subject: { control: "you", token: null } }, amount: "2", repeats: "once",
    emits: [{ verb: "draw", subject: { control: "you", token: null } }] }] as unknown as CardTags["abilities"]);
  (divination.card as { manaCost?: string }).manaCost = "{2}{U}";
  const { shards } = buildPartnerArtifact([divination, krenko, impactTremors], H);
  const rec = Object.fromEntries([...shards.values()].flatMap((s) => Object.entries(s)));
  expect(rec["divination"]?.rates).toEqual([{ family: "cards", kind: "on-cast", amount: 2, mana: 3, repeats: "once", floor: 2, ceiling: 2 }]);
  expect(rec["krenko-mob-boss"]?.rates).toBeUndefined();
});

/** ONE PAGE PER NAME (roadmap X4): two documents named alike got one slug between them, and the
 *  index listed the slug twice. The first keeps the name; the build filters a card legal nowhere out
 *  before this, so the second is only ever a duplicate. */
test("two cards with one name make one index entry and one slug", () => {
  const twin = { ...krenko, card: { ...krenko.card } };
  const { index } = buildPartnerArtifact([krenko, twin, impactTremors] as never, { subtypes: {}, types: {} } as never);
  expect(index.filter((e) => e.name === "Krenko, Mob Boss")).toHaveLength(1);
  expect(new Set(index.map((e) => e.slug)).size).toBe(index.length);
});

// ---------------------------------------------------------------------------------------------
// THE MEMBERSHIP INDEX (roadmap AJ3): the cards behind every count, kept rather than dropped.
// ---------------------------------------------------------------------------------------------

/** THE UNION USED TO BE COUNTED AND THROWN AWAY. The search page needs the cards themselves, and
 *  taking them from the same pass is what makes the number it prints and the list it shows ONE
 *  computation -- the defect class AJ1 shipped, where the line named one direction and counted
 *  the other. */
test("supplyBuckets keeps one member list per key, and its length is the count", () => {
  const rows = [
    { emits: ["dies|creature|goblin|n"], demands: [], identity: ["R"] },
    { emits: ["dies|creature|-|n"], demands: [], identity: [] },
    { emits: [], demands: ["dies|creature|-|-"], identity: ["B"] },
  ];
  const { buckets, members } = supplyBuckets(rows);
  expect(members.get("dies|creature|-|-")).toEqual([0, 1]);
  expect(members.get("dies|creature|-|-")!.length).toBe(totalOf(buckets.get("dies|creature|-|-")!));
});

test("a member list is positions in the artifact index, and it carries both directions", () => {
  const { events, index, freq } = buildPartnerArtifact([krenko, impactTremors], H);
  const at = (name: string): number => index.findIndex((e) => e.name === name);
  const members = events.get("enters|creature|-|-")!;
  // Krenko's tokens enter; Impact Tremors asks for exactly that and supplies nothing.
  expect(members.p).toEqual([at("Krenko, Mob Boss")]);
  expect(members.c).toEqual([at("Impact Tremors")]);
  expect(members.p.length).toBe(freq["enters|creature|-|-"]);
});

test("the artifact counts the askers beside the causers", () => {
  const { consumers } = buildPartnerArtifact([krenko, impactTremors], H);
  expect(consumers["enters|creature|-|-"]).toBe(1);
  expect(consumers["create-token|creature|goblin|t"]).toBeUndefined();
});

/** EVERY KEY THE PAGE CAN BE ASKED, AND NOT ONE MORE. A key with a count must have a list of that
 *  length; a chip that says 389 linking to a page that lists 400 is the AJ1 defect wearing a URL.
 *
 *  `meld|-|-|-` IS A PRICE, NOT A CENSUS, and it is the one exception. Its `freq` is set to 1 by
 *  hand (`partners-core.ts:1449`) because a meld card's partner is the ONE card it names, not a
 *  class the corpus can be counted for. So it ships no cause list and the search must never offer
 *  it as a cause -- which is exactly what "offered only when `p` is non-empty" gives for free. */
test("every counted key ships a member list of exactly that length", () => {
  const { events, freq } = buildPartnerArtifact([krenko, impactTremors, millstone], H);
  for (const [key, count] of Object.entries(freq)) {
    if (key === "meld|-|-|-") continue;
    expect(events.get(key)?.p.length ?? 0, key).toBe(count);
  }
  expect(events.get("meld|-|-|-")?.p ?? []).toEqual([]);
});

/** THE PICKER PRINTS A COUNT BESIDE EVERY EVENT, and a corpus figure over an identity-filtered
 *  list is the defect AJ5 was opened for. The slots AJ5 already computes ship, so the count a
 *  reader sees narrows with the colour chips. */
test("the frequency ships split by colour identity, and the split sums to the corpus count", () => {
  const emitter = (name: string, identity: string[]) => withIdentity(base(name, [{
    kind: "activated", cost: "{T}",
    effect: { kind: "token-generation", subject: { control: "any", token: true, type: "creature" } },
    emits: [{ verb: "enters", subject: { control: "you", token: true, type: "creature" } }],
  }] as unknown as CardTags["abilities"]), identity);
  const asker = base("Impact Tremors", [{
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { type: "creature", control: "you", token: null } },
    effect: { kind: "deal-damage" },
  }] as unknown as CardTags["abilities"]);

  const { freq, freqByIdentity } = buildPartnerArtifact(
    [emitter("Red Maker", ["R"]), emitter("Blue Maker", ["U"]), emitter("Grey Maker", []), asker], H);
  const slots = freqByIdentity["enters|creature|-|-"]!;
  expect(slots.length).toBe(32);
  expect(slots.reduce((a, b) => a + b, 0)).toBe(freq["enters|creature|-|-"]);
  // A mono-red deck counts the red maker and the colourless one, never the blue.
  expect(inIdentityOf(slots, identityMask(["R"]))).toBe(2);
  expect(inIdentityOf(slots, identityMask(["R", "U"]))).toBe(3);
  expect(inIdentityOf(slots, identityMask([]))).toBe(1);
});

/** A MILL SUPPLIES THE GENERAL GRAVEYARD PUT TOO (roadmap AK1). DERIVE 163 moved 211 abilities
 *  from `enters-graveyard` onto `mill`; without this bridge that would have been a MOVE, and the
 *  payoffs that ask for a graveyard put by type would have lost their suppliers rather than gained
 *  a more precise word for them. Specific supplies general, never the other way round. */
test("a mill also supplies the graveyard put, and the general does not supply the mill", () => {
  const forms = supplyForms("mill|-|-|-");
  expect(forms).toContain("enters-graveyard|-|-|-");
  expect(forms).toContain("mill|-|-|-");
  // A graveyard fill, the way every FILL_VERB supplies one.
  expect(forms).toContain("fills|-|-|-");
  // The bridge is one-way: a direct put (Entomb) is not a mill and must not answer a mill payoff.
  expect(supplyForms("enters-graveyard|-|-|-")).not.toContain("mill|-|-|-");
});

/** A GRAVEYARD LEAVE AND A BATTLEFIELD LEAVE ARE DIFFERENT EVENTS (CR 400.1, roadmap AK6). The
 *  key reads the zone the clause already recorded, so the event search stops offering 2,350
 *  reanimation cards as "a creature leaves the battlefield". The two fields say different things:
 *  a trigger records where the subject LIVES, an emit where the move came FROM. */
test("a graveyard leave keys apart from a battlefield leave", () => {
  const trigger = { verb: "leaves", subject: { type: "creature", zone: "graveyard", control: "you", token: null } };
  expect(eventKey(trigger as never)).toBe("leaves-graveyard|creature|-|-");
  const emit = { verb: "leaves", subject: { type: "creature", fromZone: "graveyard", control: "you", token: null } };
  expect(eventKey(emit as never)).toBe("leaves-graveyard|creature|-|-");
  // A bounce leaves the BATTLEFIELD and keeps the plain verb.
  expect(eventKey({ verb: "leaves", subject: { type: "creature", control: "any", token: null } } as never))
    .toBe("leaves|creature|-|-");
  // A REANIMATION IS A BATTLEFIELD ARRIVAL, whatever it came from: `enters` reads only where the
  // subject lives, never the origin, or every reanimator would stop answering an ETB payoff.
  expect(eventKey({ verb: "enters", subject: { type: "creature", fromZone: "graveyard", control: "you", token: null } } as never))
    .toBe("enters|creature|-|-");
});

/** ONE TYPE AND ONE SUBTYPE PER EVENT (roadmap AK5, owner ruling 2026-09-19: "whenever you cast an
 *  instant or sorcery ... 2 separate events it cares about and triggers on any of those").
 *
 *  The key carried the disjunction as a comma list, which made one event out of two and produced
 *  names no reader could use -- Krenko's page showed "an artifact or creature enters the
 *  battlefield" above "an artifact, creature or enchantment enters the battlefield". */
test("a disjunctive trigger is several events, one per type", () => {
  expect(splitKey("cast|instant,sorcery|-|-")).toEqual(["cast|instant|-|-", "cast|sorcery|-|-"]);
  expect(splitKey("enters|artifact,creature|-|-")).toEqual(["enters|artifact|-|-", "enters|creature|-|-"]);
  // A key with nothing to split is returned as it is, and the order the key lists is kept.
  expect(splitKey("dies|creature|-|n")).toEqual(["dies|creature|-|n"]);
  // BOTH SLOTS SPLIT, as a cross product: a static reaching two subtypes across two types reaches
  // each of the four pairs.
  expect(splitKey("applies:pump|creature,artifact|goblin,elf|-")).toEqual([
    "applies:pump|creature|goblin|-", "applies:pump|creature|elf|-",
    "applies:pump|artifact|goblin|-", "applies:pump|artifact|elf|-",
  ]);
});

/** AND A CARD'S DEMANDS ARE THE SPLIT SET, which is what makes the name short: no key holds a
 *  list, so no sentence has one to render. */
test("a trigger naming two types demands both", () => {
  const payoff = base("Two Ways", [{
    kind: "triggered",
    trigger: { verbs: ["enters"], subject: { type: ["artifact", "creature"], control: "you", token: null } },
    effect: { kind: "draw-card" },
  }] as unknown as CardTags["abilities"]);
  expect(demandKeysOf(payoff)).toEqual(["enters|artifact|-|-", "enters|creature|-|-"]);
});

/** THE ROW SAYS WHICH CLAUSE PRINTED IT (roadmap AJ4, spec C2), so the page can read down the card
 *  instead of zipping two lists that do not line up. An IMPLIED row -- synthesised from the keyword
 *  list rather than from rules text -- carries none, and the page puts those at the end. */
test("an ability row carries its clause, and an implied row does not", () => {
  // DERIVE 164 stamps the clause; a fixture states it the way the derived corpus does.
  const stamped = base("Stamped", [{
    kind: "activated", cost: "{T}", clause: 2,
    effect: { kind: "draw-card" },
    emits: [{ verb: "draw", subject: { control: "you", token: null } }],
  }] as unknown as CardTags["abilities"]);
  const rows = abilityRowsOf(stamped);
  expect(rows).toHaveLength(1);
  expect(rows[0]!.clause).toBe(2);
  // An ability with no clause of its own -- an implied row -- says so by absence, and the page
  // puts those at the end with no quote above them.
  const implied = base("Implied", [{
    kind: "static", effect: { kind: "graveyard-recursion" },
  }] as unknown as CardTags["abilities"]);
  for (const r of abilityRowsOf(implied)) expect(r.clause).toBeUndefined();
});

/** HOW MUCH THE CARD DOES, the order an event's causers ship in (owner 2026-09-23, AN3/AK3): how
 *  often first, then what each time yields per mana, then what it costs besides mana. */
const doer = (name: string, manaCost: string, abilities: unknown[]): DeckCard => ({
  card: { name, manaCost, manaValue: (manaCost.match(/\{(\d+)\}/)?.[1] ? Number(manaCost.match(/\{(\d+)\}/)![1]) : 0) + (manaCost.match(/\{[WUBRG]\}/g) ?? []).length },
  tags: { characteristics: { types: ["artifact"], subtypes: [], keywords: [] }, abilities },
}) as unknown as DeckCard;
const sac = { verb: "sacrifice", subject: { control: "you", token: null, type: "creature" } };
const draws = (amount: string) => ({ effect: { kind: "draw-card", subject: { control: "you" } }, amount, emits: [{ verb: "draw", subject: { control: "you", token: null } }] });
const rank = (key: string, cards: DeckCard[]): string[] => [...cards].sort(effectOrder(key)).map((d) => d.card.name);

test("a free outlet you use at will outranks a once-a-round one (a loyalty ability before a paid tap), and all outrank a one-shot", () => {
  const ashnod = doer("Ashnod's Altar", "{3}", [{ kind: "activated", cost: "Sacrifice a creature", repeats: "repeatable", effect: { kind: "mana-generation" }, emits: [sac] }]);
  const post = doer("Trading Post", "{4}", [{ kind: "activated", cost: "{1}, {T}, Sacrifice a creature", repeats: "per-cycle", effect: { kind: "graveyard-recursion" }, emits: [sac] }]);
  const walker = doer("Grist", "{1}{B}{G}", [{ kind: "activated", cost: "\u22122", repeats: "per-cycle", effect: { kind: "" }, emits: [sac] }]);
  const victimize = doer("Victimize", "{2}{B}", [{ kind: "on-cast", repeats: "once", effect: { kind: "graveyard-recursion" }, emits: [sac] }]);
  // Sacrificing ITSELF is not an outlet, however often it happens (Boneshard Slasher, Pitchstone Wall).
  const self = doer("Pitchstone Wall", "{2}{R}", [{ kind: "triggered", repeats: "repeatable", effect: { kind: "" }, emits: [{ ...sac, subject: { ...sac.subject, self: true } }] }]);
  expect(rank("sacrifice|creature|-|-", [victimize, self, post, walker, ashnod]))
    .toEqual(["Ashnod's Altar", "Grist", "Trading Post", "Victimize", "Pitchstone Wall"]);
});

test("within one frequency, more for the same mana first: draw three before draw two", () => {
  const three = doer("Draw Three", "{2}{U}", [{ kind: "on-cast", repeats: "once", ...draws("3") }]);
  const two = doer("Draw Two", "{2}{U}", [{ kind: "on-cast", repeats: "once", ...draws("2") }]);
  const arena = doer("Arena", "{1}{B}{B}", [{ kind: "triggered", repeats: "per-cycle", trigger: { verbs: ["upkeep"], subject: { control: "you" } }, ...draws("1") }]);
  expect(rank("draw|-|-|-", [two, three, arena])).toEqual(["Arena", "Draw Three", "Draw Two"]);
});

test("a cost that is not the asked event is a price: pay mana before paying a creature for the draw", () => {
  const paid = doer("Paid", "{2}", [{ kind: "activated", cost: "{1}", repeats: "repeatable", ...draws("1") }]);
  const eats = doer("Greater Good", "{2}{G}{G}", [{ kind: "activated", cost: "Sacrifice a creature", repeats: "repeatable", ...draws("1") }]);
  expect(rank("draw|-|-|-", [eats, paid])).toEqual(["Paid", "Greater Good"]);
});

/** AT WILL MEANS FREE (owner 2026-09-23). A paid activation is capped by the mana you have, about
 *  one real use a turn cycle, so it ranks with the once-a-round abilities and NOT above them: Jade
 *  Mage's {2}{G} token sat above Krenko before this, and Mystic Archaeologist above Phyrexian Arena. */
test("a paid at-will activation ranks with the once-a-round ones, below a free at-will one", () => {
  const goblin = { verb: "create-token", subject: { control: "you", token: true, type: "creature" } };
  const tokens = (amount: string) => ({ effect: { kind: "token-generation", subject: { control: "you" } }, amount, emits: [goblin] });
  const free = doer("Free Maker", "{3}", [{ kind: "activated", cost: "Pay 1 life", repeats: "repeatable", ...tokens("1") }]);
  const jade = doer("Jade Mage", "{1}{G}", [{ kind: "activated", cost: "{2}{G}", repeats: "repeatable", ...tokens("1") }]);
  const tapper = doer("Tapper", "{2}{R}", [{ kind: "activated", cost: "{T}", repeats: "per-cycle", ...tokens("2") }]);
  const once = doer("Once", "{2}", [{ kind: "on-cast", repeats: "once", ...tokens("3") }]);
  // "Pay 1 life" is a price that is not the asked event, so Free Maker is NOT free: it drops too.
  expect(rank("create-token|creature|-|t", [once, jade, free, tapper])[3]).toBe("Once");
  const trulyFree = doer("Truly Free", "{3}", [{ kind: "activated", cost: "{Q}", repeats: "repeatable", ...tokens("1") }]);
  expect(rank("create-token|creature|-|t", [tapper, jade, trulyFree])[0]).toBe("Truly Free");
  expect(rank("create-token|creature|-|t", [jade, tapper])).toEqual(["Tapper", "Jade Mage"]);
});

test("an X activation is priced on its fixed pips, not sunk below every fixed cost", () => {
  const x = doer("X Maker", "{2}", [{ kind: "activated", cost: "{X}, {T}", repeats: "per-cycle", effect: { kind: "" }, emits: [sac] }]);
  const fixed = doer("Fixed", "{2}", [{ kind: "activated", cost: "{3}, {T}", repeats: "per-cycle", effect: { kind: "" }, emits: [sac] }]);
  expect(rank("sacrifice|creature|-|-", [fixed, x])).toEqual(["X Maker", "Fixed"]);
});
