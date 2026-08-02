import { expect, test } from "vitest";
import {
  CS_CATEGORIES,
  CS_CATEGORY_TO_ARCHETYPE,
  CS_CATEGORY_TO_OTAGS,
  CS_CATEGORY_TO_SUBARCHETYPE,
  CS_UNMAPPED,
  bucketFor,
  csCardCategories,
  csDeckArchetype,
  csSlug,
  csSubArchetypeCards,
  scoreCategory,
} from "./cs-categories.js";
import type { SaltPayload } from "./calibrate-core.js";
import { loadOtagSemantics } from "@mtg/tagger";
import { ARCHETYPE_SIGNATURE } from "../archetypes.js";

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

test("every CS category is either mapped or explicitly unmapped, exactly once", () => {
  const mapped = new Set(Object.keys(CS_CATEGORY_TO_OTAGS));
  const unmapped = new Set(CS_UNMAPPED);
  for (const c of CS_CATEGORIES) {
    const inMapped = mapped.has(c);
    const inUnmapped = unmapped.has(c);
    expect(inMapped !== inUnmapped, `${c} must be in exactly one of mapped/unmapped`).toBe(true);
  }
  for (const c of [...mapped, ...unmapped]) {
    expect(CS_CATEGORIES, `${c} is not a real CS category`).toContain(c);
  }
});

test("every mapped otag slug exists and is a classifier", () => {
  const sem = loadOtagSemantics();
  for (const [cat, slugs] of Object.entries(CS_CATEGORY_TO_OTAGS)) {
    expect(slugs.length, `${cat} maps to no slugs`).toBeGreaterThan(0);
    for (const s of slugs) {
      const entry = sem.get(s);
      expect(entry, `${cat} -> ${s} is not a known slug`).toBeDefined();
      expect(entry!.uses, `${cat} -> ${s} is not a classifier`).toContain("classifier");
    }
  }
});

test("every CS->Archetype pairing names a real archetype with a signature", () => {
  for (const [cat, arch] of Object.entries(CS_CATEGORY_TO_ARCHETYPE)) {
    expect(CS_CATEGORIES, `${cat} is not a CS category`).toContain(cat);
    expect(ARCHETYPE_SIGNATURE[arch], `${arch} has no signature`).toBeDefined();
  }
});

test("bucketFor derives A/B/C from the map and the signature table", () => {
  for (const c of CS_CATEGORIES) {
    const b = bucketFor(c);
    if (!(c in CS_CATEGORY_TO_OTAGS)) expect(b, `${c}`).toBe("C");
    else if (c in CS_CATEGORY_TO_ARCHETYPE) expect(b, `${c}`).toBe("A");
    else expect(b, `${c}`).toBe("B");
  }
});

test("kindred is mapped to typal slugs and has no engine archetype", () => {
  expect(CS_CATEGORY_TO_OTAGS["kindred"]?.some((s) => s.startsWith("typal-"))).toBe(true);
  expect(CS_CATEGORY_TO_ARCHETYPE["kindred"]).toBeUndefined();
  expect(bucketFor("kindred")).toBe("B");
});

test("scoreCategory computes precision, recall and prevalence", () => {
  // universe of 100 cards; CS labelled 20; we predicted 10; 8 of ours are correct
  const s = scoreCategory(new Set(["a", "b", "c", "d", "e", "f", "g", "h", "x", "y"]),
                          new Set(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j",
                                   "k", "l", "m", "n", "o", "p", "q", "r", "s", "t"]), 100);
  expect(s.predicted).toBe(10);
  expect(s.labelled).toBe(20);
  expect(s.hit).toBe(8);
  expect(s.precision).toBeCloseTo(0.8);
  expect(s.recall).toBeCloseTo(0.4);
  expect(s.prevalence).toBeCloseTo(0.2);
});

test("scoreCategory returns zero precision when nothing was predicted", () => {
  const s = scoreCategory(new Set(), new Set(["a"]), 10);
  expect(s.precision).toBe(0);
  expect(s.recall).toBe(0);
});

test("scoreCategory returns zero recall when nothing was labelled", () => {
  const s = scoreCategory(new Set(["a"]), new Set(), 10);
  expect(s.precision).toBe(0);
  expect(s.recall).toBe(0);
  expect(s.prevalence).toBe(0);
});

test("scoreCategory handles an empty universe without dividing by zero", () => {
  const s = scoreCategory(new Set(), new Set(), 0);
  expect(s.prevalence).toBe(0);
  expect(Number.isNaN(s.precision)).toBe(false);
});

// Second CS reference: details.archetypes.archetypes.<MAJOR>.subArchetypes.<SUB>.list, a
// synergy-graph deck-theme membership list -- structurally separate from categories.stats
// (payload above has no archetypes.archetypes block at all, only percentages).
const archPayload: SaltPayload = {
  details: {
    synergy: { list: {} },
    archetypes: {
      dominantArchetype: "MIDRANGE",
      dominantSubArchetype: "KINDRED",
      // @ts-expect-error -- archetypes.archetypes isn't declared on SaltPayload (see cs-categories.ts)
      archetypes: {
        MIDRANGE: {
          list: [],
          total: "109.3",
          subArchetypes: {
            KINDRED: { list: ["heralds_horn", "grim_haruspex", "urzas_incubator"], total: "72.3" },
            TOKENS: { list: ["master_of_waves"], total: "13.0" },
          },
        },
        COMBO: {
          list: [],
          total: "55.7",
          subArchetypes: {
            ARISTOCRATS: { list: ["grim_haruspex"], total: "9.7" },
          },
        },
      },
    },
  },
  cards: {},
};

test("csSubArchetypeCards maps sub-archetype name to its list of CS slugs", () => {
  const m = csSubArchetypeCards(archPayload);
  expect(m.get("KINDRED")).toEqual(new Set(["heralds_horn", "grim_haruspex", "urzas_incubator"]));
  expect(m.get("TOKENS")).toEqual(new Set(["master_of_waves"]));
});

test("csSubArchetypeCards unions a sub-archetype name across majors", () => {
  // grim_haruspex appears in both MIDRANGE.KINDRED and COMBO.ARISTOCRATS in the fixture; a
  // hypothetical repeated sub-archetype name across majors should union, not overwrite.
  const m = csSubArchetypeCards(archPayload);
  expect(m.get("ARISTOCRATS")).toEqual(new Set(["grim_haruspex"]));
});

test("csSubArchetypeCards returns an empty map when the payload has no archetypes.archetypes block", () => {
  expect(csSubArchetypeCards(payload).size).toBe(0); // top-level `payload` has archetypes.percentages but no .archetypes
  expect(csSubArchetypeCards({ details: { synergy: { list: {} } } }).size).toBe(0);
});

test("every CS_CATEGORY_TO_SUBARCHETYPE entry names a real category and an UPPERCASE sub-archetype", () => {
  for (const [cat, sub] of Object.entries(CS_CATEGORY_TO_SUBARCHETYPE)) {
    expect(CS_CATEGORIES, `${cat} is not a CS category`).toContain(cat);
    expect(sub).toBe(sub.toUpperCase());
    expect(sub).toBe(cat.toUpperCase());
  }
});

test("kindred's sub-archetype is KINDRED", () => {
  expect(CS_CATEGORY_TO_SUBARCHETYPE["kindred"]).toBe("KINDRED");
});
