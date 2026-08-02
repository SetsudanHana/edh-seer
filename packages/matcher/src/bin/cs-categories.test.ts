import { expect, test } from "vitest";
import { CS_CATEGORIES, csCardCategories, csDeckArchetype, csSlug } from "./cs-categories.js";
import type { SaltPayload } from "./calibrate-core.js";

const payload: SaltPayload = {
  commanders: ["Inalla, Archmage Ritualist"],
  details: {
    synergy: { list: {} },
    archetypes: {
      dominantArchetype: "MIDRANGE",
      dominantSubArchetype: "KINDRED",
      percentages: {
        MIDRANGE: { percentage: 58.8, subArchetypes: { KINDRED: { percentage: 66.1 }, TOKENS: { percentage: 11.9 } } },
        COMBO: { percentage: 29.9, subArchetypes: { ARISTOCRATS: { percentage: 17.4 } } },
      },
    },
  },
  cards: {
    grim_haruspex: { categories: { stats: { cantrip: true, aristocrats: true } } },
    master_of_waves: { categories: { stats: { tokens: true, anthem: true } } },
    island: { categories: { stats: {} } },
    riptide_laboratory: {},
  },
};

test("csSlug matches CommanderSalt's key format", () => {
  expect(csSlug("Venser, Shaper Savant")).toBe("venser_shaper_savant");
});

// CS strips apostrophes rather than replacing them. Verified against a live payload:
// the real keys are "an_offer_you_cant_refuse" and "vivis_persistence". calibrate.ts's
// slug() gets this wrong, so this test is what stops the mistake being copied.
test("csSlug strips apostrophes instead of underscoring them", () => {
  expect(csSlug("An Offer You Can't Refuse")).toBe("an_offer_you_cant_refuse");
  expect(csSlug("Vivi's Persistence")).toBe("vivis_persistence");
  expect(csSlug("Urza’s Incubator")).toBe("urzas_incubator");
});

test("csCardCategories extracts the label set per card slug", () => {
  const m = csCardCategories(payload);
  expect(m.get("grim_haruspex")).toEqual(new Set(["cantrip", "aristocrats"]));
  expect(m.get("master_of_waves")).toEqual(new Set(["tokens", "anthem"]));
});

test("csCardCategories keeps cards with no categories as empty sets, not missing", () => {
  const m = csCardCategories(payload);
  expect(m.get("island")).toEqual(new Set());
  expect(m.get("riptide_laboratory")).toEqual(new Set());
});

test("csCardCategories ignores false-valued flags", () => {
  const m = csCardCategories({
    details: { synergy: { list: {} } },
    cards: { x: { categories: { stats: { tokens: true, burn: false } } } },
  });
  expect(m.get("x")).toEqual(new Set(["tokens"]));
});

test("csDeckArchetype reads the dominant labels and flattens sub-percentages", () => {
  const a = csDeckArchetype(payload)!;
  expect(a.major).toBe("MIDRANGE");
  expect(a.minor).toBe("KINDRED");
  expect(a.subPercentages.get("KINDRED")).toBe(66.1);
  expect(a.subPercentages.get("ARISTOCRATS")).toBe(17.4);
});

test("csDeckArchetype returns null when the payload carries no archetype block", () => {
  expect(csDeckArchetype({ details: { synergy: { list: {} } } })).toBeNull();
});

test("CS_CATEGORIES lists all 30 known categories", () => {
  expect(CS_CATEGORIES).toHaveLength(30);
  for (const c of ["kindred", "aristocrats", "tokens", "blink", "counterspell"]) {
    expect(CS_CATEGORIES).toContain(c);
  }
});
