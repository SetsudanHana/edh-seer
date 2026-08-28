import { describe, expect, it } from "vitest";
import type { Reason } from "@edh-seer/engine";
import { meshReport, MESH_CAP } from "./mesh.js";

const r = (tag: string, producer: string, consumer: string): Reason =>
  ({ tag, text: `${producer} -> ${consumer}`, producer, consumer });

describe("meshReport", () => {
  it("counts a producer that reaches most of the deck on one tag as mesh", () => {
    // 10-card deck, one producer touching 8 of them through a single tag: Bolas's Citadel's
    // "copy spell applies to <every card>" shape.
    const reasons = Array.from({ length: 8 }, (_, i) => r("static:copy-spell", "Citadel", `c${i}`));
    const out = meshReport(reasons, 10);
    expect(out.meshed).toBe(8);
    expect(out.clean).toBe(0);
    expect(out.groups[0]).toMatchObject({ producer: "Citadel", tag: "static:copy-spell", fanOut: 8 });
  });

  it("leaves a narrow producer alone", () => {
    const reasons = [r("dies:creature", "Blood Artist", "c1"), r("dies:creature", "Blood Artist", "c2")];
    expect(meshReport(reasons, 10)).toMatchObject({ meshed: 0, clean: 2 });
  });

  it("judges each (producer, tag) group separately", () => {
    const reasons = [
      ...Array.from({ length: 8 }, (_, i) => r("static:pump", "Anthem", `c${i}`)),
      r("dies:creature", "Blood Artist", "c1"),
    ];
    expect(meshReport(reasons, 10)).toMatchObject({ meshed: 8, clean: 1 });
  });

  it("counts distinct consumers, not reasons, so a repeated pair is not a mesh", () => {
    const reasons = Array.from({ length: 8 }, () => r("static:pump", "Anthem", "c1"));
    expect(meshReport(reasons, 10)).toMatchObject({ meshed: 0, clean: 8 });
  });

  it("sets aside reasons with no producer/consumer rather than scoring them", () => {
    const reasons: Reason[] = [{ tag: "combo", text: "A + B" }];
    expect(meshReport(reasons, 10)).toMatchObject({ meshed: 0, clean: 0, unattributed: 1 });
  });

  it("scales with deck size, not with an absolute count", () => {
    const reasons = Array.from({ length: 8 }, (_, i) => r("static:pump", "Anthem", `c${i}`));
    expect(meshReport(reasons, 100).meshed).toBe(0);
    expect(meshReport(reasons, 10).meshed).toBe(8);
  });

  it("exposes the cap it used so a caller can vary it", () => {
    const reasons = Array.from({ length: 4 }, (_, i) => r("static:pump", "Anthem", `c${i}`));
    expect(meshReport(reasons, 10, 0.3).meshed).toBe(4);
    expect(meshReport(reasons, 10, MESH_CAP).meshed).toBe(0);
  });

  // A DELIBERATELY WIDE FAMILY MUST NOT BLIND THE INSTRUMENT. `static:cost-reduction` reaches every
  // card it reduces on purpose (owner's ruling, 2026-08-18), and leaving it in the census took
  // MESHED 288 -> 3,420 across the 71 decks -- at which point an ACCIDENTAL mesh, the only thing
  // this report exists to show, is invisible inside the total.
  it("does not count a wide cost-reduction fan as mesh, and still counts it in the population", () => {
    const reasons = Array.from({ length: 8 }, (_, i) => r("static:cost-reduction", "Jet Medallion", `c${i}`));
    const out = meshReport(reasons, 10);
    expect(out.meshed).toBe(0);
    expect(out.clean).toBe(8);
    expect(out.groups).toEqual([]);
  });

  it("still catches an accidental mesh sitting beside an exempt one", () => {
    const reasons = [
      ...Array.from({ length: 8 }, (_, i) => r("static:cost-reduction", "Jet Medallion", `c${i}`)),
      ...Array.from({ length: 8 }, (_, i) => r("static:pump", "Runaway Anthem", `c${i}`)),
    ];
    const out = meshReport(reasons, 10);
    expect(out.meshed).toBe(8);
    expect(out.clean).toBe(8);
    expect(out.groups.map((g) => g.tag)).toEqual(["static:pump"]);
  });
});
