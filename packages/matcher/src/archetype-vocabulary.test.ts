import { expect, test } from "vitest";
import { EFFECT_KINDS, VERB_VOCAB } from "@edh-seer/tagger";
import {
  ARCHETYPE_LABELS, ARCHETYPE_SIGNATURE, ARCHETYPE_VOCABULARY, DETECTABLE, EXCLUDED_THEMES, KINDRED_TRIBES,
} from "./archetype-vocabulary.js";

// THE ROW COUNTS ARE THE RATCHET: EDHREC listed 401 themes on 2026-09-06 and every one landed in
// exactly one of the three tables. A regeneration that drops a theme, or a hand edit that deletes a
// row, changes a number here and has to say why.
test("every EDHREC theme is in exactly one of vocabulary, tribes, excluded", () => {
  const keyed = ARCHETYPE_VOCABULARY.flatMap((r) => ("edhrec" in r ? [r.edhrec.slug] : []));
  const tribes = KINDRED_TRIBES.map((t) => t.edhrec.slug);
  const excluded = Object.keys(EXCLUDED_THEMES);
  const all = [...keyed, ...tribes, ...excluded];
  expect(new Set(all).size).toBe(all.length);
  expect(all.length).toBe(401);
  expect(keyed.length).toBe(214);
  expect(tribes.length).toBe(135);
  expect(excluded.length).toBe(52);
});

test("our slugs are unique and the labels cover every member", () => {
  const slugs = ARCHETYPE_VOCABULARY.map((r) => r.slug);
  expect(new Set(slugs).size).toBe(slugs.length);
  for (const s of slugs) expect(ARCHETYPE_LABELS[s]).toBeTruthy();
  // The members every existing consumer reads by name keep their slug.
  for (const s of ["tokens", "counters", "superfriends", "goodstuff", "combo", "kindred"]) expect(slugs).toContain(s);
});

// A SIGNATURE ON A SIGNAL THE DERIVE LAYER NEVER EMITS MATCHES NOTHING, SILENTLY -- the failure this
// repo refuses. Every tag verb and effect kind is checked against the tagger's vocabulary; keywords
// are Scryfall's and are not checked here (the census of 2026-09-06 is cited beside each row).
const TAG_FAMILIES = new Set<string>([
  ...VERB_VOCAB,
  // trigger events and matcher-synthesised keys that reach `cardThemeTags`
  "enters", "dies", "leaves", "attacks", "cast", "upkeep", "end-step", "begin-combat", "combat-damage",
  "non-combat-damage", "counter-added", "dice-rolled", "unlock", "enters-graveyard", "leaves-graveyard",
  "land-play", "static", "etb-refire", "untaps", "taps",
]);
test("every signature keys on vocabulary the derive layer can emit", () => {
  for (const [name, sig] of Object.entries(ARCHETYPE_SIGNATURE)) {
    for (const tag of [...(sig.tags ?? []), ...(sig.allTags ?? [])]) {
      const family = tag === "etb-refire" ? tag : tag.slice(0, tag.indexOf(":"));
      expect(TAG_FAMILIES.has(family), `${name}: tag "${tag}" has no verb family`).toBe(true);
    }
    for (const k of sig.effectKinds ?? []) expect((EFFECT_KINDS as readonly string[]).includes(k), `${name}: effect kind "${k}"`).toBe(true);
    // A row must key on SOMETHING; an empty row would match nothing and read as declared.
    const fields = [sig.tags, sig.allTags, sig.effectKinds, sig.subtypes, sig.cardTypes, sig.keywords, sig.lineWords, sig.tokenKinds];
    expect(fields.some((f) => (f?.length ?? 0) > 0), `${name}: empty signature`).toBe(true);
    if (sig.requiresDemand) expect(sig.demandDefined, `${name}: requiresDemand without demandDefined`).toBe(true);
  }
});

test("DETECTABLE is the signature rows plus combo and kindred, and nothing declared", () => {
  const slugs = new Set(ARCHETYPE_VOCABULARY.map((r) => r.slug));
  for (const d of DETECTABLE) expect(slugs.has(d), `${d} is not a member`).toBe(true);
  for (const k of Object.keys(ARCHETYPE_SIGNATURE)) expect(DETECTABLE.has(k as never)).toBe(true);
  expect(DETECTABLE.has("combo")).toBe(true);
  expect(DETECTABLE.has("kindred")).toBe(true);
  // The owner's four from 2026-09-06: two detectable, two declared and waiting on a verb.
  expect(DETECTABLE.has("party")).toBe(false);
  expect(DETECTABLE.has("dungeon")).toBe(true);
  expect(DETECTABLE.has("theft")).toBe(false);
  expect(DETECTABLE.has("big-mana")).toBe(false);
  expect(DETECTABLE.has("control")).toBe(false);
});

test("kindred tribes name lowercase creature types and singular forms", () => {
  for (const t of KINDRED_TRIBES) {
    expect(t.types.length).toBeGreaterThan(0);
    for (const ty of t.types) expect(ty).toBe(ty.toLowerCase());
  }
  expect(KINDRED_TRIBES.find((t) => t.edhrec.slug === "elves")?.types).toEqual(["elf"]);
  expect(KINDRED_TRIBES.find((t) => t.edhrec.slug === "time-lords")?.types).toEqual(["time lord"]);
});
