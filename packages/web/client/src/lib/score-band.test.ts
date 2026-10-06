import { expect, test } from "vitest";
import { scoreBand } from "./score-band.js";

test("scoreBand maps the 0-5 scale to labeled bands", () => {
  expect(scoreBand(0.5)).toEqual({ label: "Loose", tone: "low" });
  expect(scoreBand(1.5)).toEqual({ label: "Developing", tone: "mid" });
  expect(scoreBand(2.9)).toEqual({ label: "Developing", tone: "mid" });
  expect(scoreBand(3)).toEqual({ label: "Connected", tone: "good" });
  expect(scoreBand(4)).toEqual({ label: "Tight", tone: "high" });
  expect(scoreBand(5)).toEqual({ label: "Tight", tone: "high" });
  // NO BAND WORD NAMES A SUB-SCORE (#980): "SYNERGY 3.0 focused" over "Focus 1.2 unfocused" read
  // as the tool contradicting itself, four seats running.
  for (const x of [0.5, 2, 3.5, 4.5]) expect(scoreBand(x).label.toLowerCase()).not.toMatch(/focus|key card/);
  // Build's words, same edges: "tuned" is power-level talk and read as contradicting the bracket.
  expect(scoreBand(4.7, "build")).toEqual({ label: "On target", tone: "high" });
  expect(scoreBand(1.4, "build")).toEqual({ label: "Far off", tone: "low" });
});
