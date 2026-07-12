import type { AnalyzeResponse } from "./types.js";

export const SAMPLE: AnalyzeResponse = {
  report: {
    edges: [
      {
        a: "Krenko, Mob Boss",
        b: "Impact Tremors",
        score: 2,
        reasons: [{ tag: "token", text: "Krenko makes tokens; this pays off tokens." }],
      },
    ],
    combos: [{ cards: ["Phyrexian Altar", "Retribution of the Ancients"], result: "Infinite loop" }],
    themes: [
      { tag: "token", count: 4 },
      { tag: "sacrifice", count: 3 },
    ],
    roles: { ramp: 4, draw: 10, removal: 6 },
  },
  missing: ["Beholder's Death Ray"],
  resolvedCount: 99,
  totalCount: 100,
};
