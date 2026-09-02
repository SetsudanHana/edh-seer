import type { AnalyzeResponse } from "./types.js";

export const SAMPLE: AnalyzeResponse = {
  report: {
    commanders: ["Krenko, Mob Boss"],
    cards: [
      {
        name: "Krenko, Mob Boss",
        isCommander: true,
        score: 6,
        synergyRating: 5,
        authority: 4.5,
        partnerCount: 2,
        topPartners: [
          { name: "Impact Tremors", score: 2, reasons: [{ tag: "token", text: "Krenko makes tokens; Impact Tremors pays off tokens." }] },
        ],
        bucketScores: { consistency: 0, efficiency: 0, "win-condition": 1.38 },
        bucketCount: 2,
      },
      {
        name: "Impact Tremors",
        isCommander: false,
        score: 2,
        synergyRating: 3.3,
        authority: 3.7,
        doubleDuty: true,
        doubleDutyRoles: ["draw"],
        partnerCount: 1,
        topPartners: [
          { name: "Krenko, Mob Boss", score: 2, reasons: [{ tag: "token", text: "Krenko makes tokens; Impact Tremors pays off tokens." }] },
        ],
        bucketScores: { consistency: 1.0, efficiency: 0, "win-condition": 0.23 },
        bucketCount: 3,
      },
    ],
    edges: [],
    combos: [{ cards: ["Phyrexian Altar", "Retribution of the Ancients"], result: "Infinite loop" }],
    themes: [{ tag: "token", count: 4 }],
    manaCurve: [
      { value: 0, count: 1 },
      { value: 1, count: 0 },
      { value: 2, count: 5 },
      { value: 3, count: 3 },
      { value: 4, count: 2 },
      { value: 5, count: 0 },
      { value: 6, count: 0 },
      { value: 7, count: 0 },
    ],
    landCount: 38,
    avgManaValue: 2.7,
    medianManaValue: 3,
    positiveCoherence: 4.2,
    synergyOverall: 4.0,
    anchoring: 4.0,
    buildScore: 3.7,
    // Task 7 (owner, 2026-08-21): a leaf's `target` is always 0 now — only `lands` (its own
    // two-sided band, outside every parent) keeps a real one. `buildParents` below is what actually
    // scores and flags.
    buildCategories: [
      { category: "ramp", count: 6, target: 0 },
      { category: "draw", count: 12, target: 0 },
      { category: "cardSelection", count: 2, target: 0 },
      { category: "tutor", count: 0, target: 0 },
      { category: "targetedRemoval", count: 5, target: 0 },
      { category: "stackInteraction", count: 2, target: 0 },
      { category: "graveyardHate", count: 1, target: 0 },
      { category: "protection", count: 0, target: 0 },
      { category: "boardWipe", count: 0, target: 0 },
      { category: "lands", count: 37, target: 36 },
    ],
    buildParents: [
      // Consistency is OVER its own target (union of draw 12 + cardSelection 2 + tutor 0, no
      // overlap in this fixture) -- Ramp is UNDER, same numbers the old leaf-scored fixture used.
      { name: "Consistency", count: 14, target: 10, leaves: ["draw", "cardSelection", "tutor"] },
      { name: "Ramp", count: 6, target: 10, leaves: ["ramp"] },
      { name: "Interaction", count: 8, target: 10, leaves: ["targetedRemoval", "stackInteraction", "graveyardHate", "protection"], coverageWeighted: true },
      { name: "Board wipes", count: 0, target: 3, leaves: ["boardWipe"] },
    ],
    // Real `buildSuggestions` output: parent-level (the 2026-08-21 ruling -- a LEAF can no longer be
    // short of anything, so "Removal 7/10" is not a sentence this engine produces) and carrying the
    // cost band (F14). A fixture that no longer resembles real output stops exercising the renderer
    // it exists for.
    suggestions: [
      "No board wipe (target 3), typically 3–5 mana",
      "Ramp 6/10 — add ~4, typically 2–3 mana",
      "Interaction 7/10 — add ~3, typically 2–4 mana",
    ],
    roles: { ramp: 4, draw: 10, removal: 6 },
    cohesion: {
      theme: "Tokens",
      name: "Tokens",
      tag: "token",
      secondary: "Goblins",
      secondaryName: "Goblins",
      secondaryTag: "tribe:goblin",
      score: 0.65,
      onThemeCount: 41,
      nonlandCount: 63,
    familyScore: 0.65,
      label: "highly concentrated", dominant: true,
    },
    strategies: [
      { name: "tokens", label: "Tokens", confidence: 0.42 },
      { name: "aristocrats", label: "Aristocrats", confidence: 0.18 },
    ],
    archetypes: [
      {
        category: "tokens-go-wide",
        label: "Tokens Go Wide",
        cards: ["Impact Tremors", "Krenko, Mob Boss"],
        pairs: [
          {
            a: "Krenko, Mob Boss",
            b: "Impact Tremors",
            reasons: [{ tag: "token", text: "Krenko makes tokens; Impact Tremors pays off tokens." }],
          },
        ],
      },
    ],
  },
  missing: ["Beholder's Death Ray"],
  resolvedCount: 99,
  totalCount: 100,
  commanderColorIdentity: ["R"],
  // One node per distinct card, one edge per pair carrying at least one synergy reason. A facet
  // (goblin, enters:creature) is a FIELD here, never a node -- that is the projection's whole
  // point, and `id` is the card's name.
  graph: {
    nodes: [
      {
        id: "Krenko, Mob Boss", label: "Krenko, Mob Boss", copies: 1,
        types: ["creature"], subtypes: ["goblin"], supertypes: ["legendary"],
        colors: ["R"], cmc: 4, roles: ["burn"],
      },
      {
        id: "Impact Tremors", label: "Impact Tremors", copies: 1,
        types: ["enchantment"], subtypes: [], supertypes: [],
        colors: ["R"], cmc: 2, roles: ["burn"],
      },
    ],
    edges: [
      {
        from: "Krenko, Mob Boss", to: "Impact Tremors", weight: 2.4, tags: ["token"],
        reasonTexts: ["Krenko makes tokens; Impact Tremors pays off tokens."],
      },
    ],
    undirectedReasons: 0,
    offDeckReasons: 0,
  },
};
