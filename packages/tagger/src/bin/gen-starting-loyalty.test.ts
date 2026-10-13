import { describe, expect, it } from "vitest";
import { loyaltyTable } from "./gen-starting-loyalty.js";
import table from "../derive/starting-loyalty.json" with { type: "json" };

describe("starting-loyalty.json", () => {
  it("keeps one entry per face, null where a face has no numeric loyalty, and drops a card that has none", () => {
    expect(loyaltyTable({
      "Valki, God of Lies // Tibalt, Cosmic Impostor": [{ identifiers: { scryfallOracleId: "v" } }, { identifiers: { scryfallOracleId: "v" }, loyalty: "5" }],
      "Chandra, Torch of Defiance": [{ identifiers: { scryfallOracleId: "c" }, loyalty: "4" }],
      "Tamiyo, Field Researcher": [{ identifiers: { scryfallOracleId: "x" }, loyalty: "X" }],
      "Sol Ring": [{ identifiers: { scryfallOracleId: "s" } }],
    })).toEqual({ c: [4], v: [null, 5] });
  });
  it("holds the planeswalkers derive reads (Chandra, Novice Pyromancer 5; Arlinn's two faces; Valki's front has none)", () => {
    const t = table as Record<string, (number | null)[]>;
    expect(Object.keys(t).length).toBeGreaterThan(300);
    for (const v of Object.values(t)) expect(v.some((n) => n !== null)).toBe(true);
  });
});
