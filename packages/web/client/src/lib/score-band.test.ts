import { expect, test } from "vitest";
import { scoreBand } from "./score-band.js";

test("scoreBand maps the 0-5 scale to labeled bands", () => {
  expect(scoreBand(0.5)).toEqual({ label: "Unfocused", tone: "low" });
  expect(scoreBand(1.5)).toEqual({ label: "Developing", tone: "mid" });
  expect(scoreBand(2.9)).toEqual({ label: "Developing", tone: "mid" });
  expect(scoreBand(3)).toEqual({ label: "Focused", tone: "good" });
  expect(scoreBand(4)).toEqual({ label: "Tuned", tone: "high" });
  expect(scoreBand(5)).toEqual({ label: "Tuned", tone: "high" });
});
