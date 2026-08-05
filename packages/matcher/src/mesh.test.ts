import { describe, expect, it } from "vitest";
import type { Reason } from "@mtg/engine";
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
});
