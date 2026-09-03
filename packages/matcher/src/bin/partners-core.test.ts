import { expect, test } from "vitest";
import { countEvents, eventKey, resolveSlugs, slugOf, specificity } from "./partners-core.js";

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
