import type { AnalyzeResponse } from "./types.js";

export const SAMPLE: AnalyzeResponse = {
  report: {
    commanders: ["Krenko, Mob Boss"],
    cards: [
      {
        name: "Krenko, Mob Boss",
        isCommander: true,
        score: 6,
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
    roles: { ramp: 4, draw: 10, removal: 6 },
  },
  missing: ["Beholder's Death Ray"],
  resolvedCount: 99,
  totalCount: 100,
};
