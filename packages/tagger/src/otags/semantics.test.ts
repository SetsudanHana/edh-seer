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
    expect(s.uses.length, `${slug} uses`).toBeGreaterThan(0);
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
