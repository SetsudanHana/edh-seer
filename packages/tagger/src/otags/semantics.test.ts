import { expect, test } from "vitest";
import { EFFECT_KINDS } from "../schema.js";
import { loadDescriptorOtags } from "./functional.js";
import { OTAG_EVENTS, OTAG_EVENT_TO_VERB, loadOtagSemantics, unclassifiedSlugs } from "./semantics.js";

test("every otag event maps to a Verb or an explicit null", () => {
  for (const e of OTAG_EVENTS) {
    expect(Object.prototype.hasOwnProperty.call(OTAG_EVENT_TO_VERB, e), `${e} unmapped`).toBe(true);
  }
});

test("loaded semantics use only legal vocabulary", () => {
  const sem = loadOtagSemantics();
  expect(sem.size).toBeGreaterThan(0);
  for (const [slug, s] of sem) {
    for (const ev of s.events) {
      expect(OTAG_EVENTS, `${slug} event`).toContain(ev.event);
      expect(["producer", "consumer"], `${slug} role`).toContain(ev.role);
    }
    if (s.effectKind !== null) {
      expect(EFFECT_KINDS as readonly string[], `${slug} effectKind`).toContain(s.effectKind);
    }
    // uses may legitimately be empty -- see the "universal staples" test below
    for (const u of s.uses) expect(["edge", "classifier", "weight"]).toContain(u);
  }
});

test("edge use requires an event that maps to a real Verb", () => {
  for (const [slug, s] of loadOtagSemantics()) {
    if (!s.uses.includes("edge")) continue;
    const pairable = s.events.some((e) => OTAG_EVENT_TO_VERB[e.event] !== null);
    expect(pairable, `${slug} claims edge but no event maps to a Verb`).toBe(true);
  }
});

test("needsEffectKind names a kind that does not already exist", () => {
  for (const [slug, s] of loadOtagSemantics()) {
    if (s.needsEffectKind === undefined) continue;
    expect(EFFECT_KINDS as readonly string[], `${slug}`).not.toContain(s.needsEffectKind);
    expect(s.effectKind, `${slug} must not set both`).toBeNull();
  }
});

test("descriptor slugs are synthesised as weight without a JSON entry", () => {
  const sem = loadOtagSemantics();
  for (const d of loadDescriptorOtags()) {
    expect(sem.get(d), `${d} missing`).toEqual({ events: [], effectKind: null, uses: ["weight"] });
  }
});

test("every signal slug is classified", () => {
  expect(unclassifiedSlugs()).toEqual([]);
});

// The classifier/weight rules are semantic, so these pin representative slugs at each end
// rather than trying to assert the rule itself. They exist because the first classification
// pass drifted: classifier reached 82% of slugs, which made it useless to its consumer.
test("classifier marks distinctive archetype evidence, not universal staples", () => {
  const sem = loadOtagSemantics();
  // Would eight copies tell you the deck's strategy? No -- every EDH deck plays these.
  for (const slug of [
    "removal-creature", "spot-removal", "ramp", "pure-draw", "mana-dork",
    "tutor-to-hand", "protects-creature", "gives-haste", "combat-trick",
  ]) {
    expect(sem.get(slug)?.uses, `${slug} is a universal staple`).not.toContain("classifier");
  }
  // Yes -- these name a strategy the deck is executing.
  for (const slug of [
    "sacrifice-outlet-creature", "typal-elf", "repeatable-token-generator",
    "reanimate-creature", "synergy-equipment", "hate-graveyard", "landfall",
  ]) {
    expect(sem.get(slug)?.uses, `${slug} is archetype evidence`).toContain("classifier");
  }
});

test("weight marks archetype-conditional value", () => {
  const sem = loadOtagSemantics();
  // Would you score this differently in aristocrats than voltron? Yes.
  for (const slug of [
    "evasion", "gives-haste", "protects-creature", "scales-with-power",
    "creature-count-matters", "cost-reducer", "per-player",
  ]) {
    expect(sem.get(slug)?.uses, `${slug} is archetype-conditional`).toContain("weight");
  }
  // No -- good in every deck, so weight would be noise.
  for (const slug of ["ramp", "removal-creature", "tutor-to-hand"]) {
    expect(sem.get(slug)?.uses, `${slug} is good everywhere`).not.toContain("weight");
  }
});

test("universal staples carry no consumer at all", () => {
  const sem = loadOtagSemantics();
  // Not edge (no event), not classifier (universal), not weight (good everywhere).
  // Empty uses is the honest encoding, so the loader must accept it.
  for (const slug of ["removal-creature", "ramp", "tutor-to-hand", "utility-land"]) {
    expect(sem.get(slug)?.uses, `${slug} should have no consumer`).toEqual([]);
  }
});
