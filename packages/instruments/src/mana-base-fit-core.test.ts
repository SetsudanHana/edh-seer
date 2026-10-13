import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MANA_BASE_COST } from "@edh-seer/matcher";
import { colourCost, colourFit, fit, round3, type FitRow } from "./mana-base-fit-core.js";

const FIXTURE = new URL("../data/mana-base-fit-rows.json", import.meta.url);
const rows = JSON.parse(readFileSync(FIXTURE, "utf8")) as FitRow[];

describe("fit", () => {
  it("recovers a slope through the origin and scores it", () => {
    const f = fit([1, 2, 3], [2, 4, 6]);
    expect(f.slope).toBeCloseTo(2, 12);
    expect(f.r2Uncentred).toBeCloseTo(1, 12);
    expect(fit([1, 2], [1, 3], 1.5).slope).toBe(1.5);
  });
  it("counts a turn lost every way it is lost, and prices colour as base over allCol", () => {
    const r: FitRow = { name: "x", kind: "precon", colourMiss: 1, base: { screw: 0.1, colour: 0.4, flood: 0.2 }, allCol: { screw: 0.1, colour: 0, flood: 0.25 } };
    expect(colourCost(r)).toBeCloseTo(0.35, 12);
  });
});

describe("MANA_BASE_COST.colourMiss is the committed fit", () => {
  it("is the raw slope of the fixture rows, to three places", () => {
    expect(round3(colourFit(rows).slope)).toBe(MANA_BASE_COST.colourMiss);
  });
  it("fails when the rows change and the constant does not: deck count, mean x and mean y are pinned", () => {
    const f = colourFit(rows);
    expect(f.n).toBe(268);
    expect(rows.filter((r) => r.kind === "precon").length).toBe(197);
    expect(f.meanX).toBeCloseTo(4.223, 3);
    expect(f.meanY).toBeCloseTo(PINNED_MEAN_Y, 3);
    expect(f.r2Centred).toBeCloseTo(0.55, 2);
    expect(createHash("sha256").update(readFileSync(FIXTURE)).digest("hex")).toBe(PINNED_HASH);
  });
});

const PINNED_MEAN_Y = 0.614;
const PINNED_HASH = "ca30860c863d83c7ae8a92fba239930d25eeb7581992abdf4819a6f7a240a7ab";
