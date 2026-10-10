import { describe, expect, it } from "vitest";
import { subcategoryLabel } from "./presets.js";

describe("subcategoryLabel", () => {
  it("translates the categories whose engine key is jargon", () => {
    expect(subcategoryLabel("cardSelection")).toBe("digging");
    expect(subcategoryLabel("ramp")).toBe("extra mana");
  });

  it("leaves a category that is already plain English alone", () => {
    expect(subcategoryLabel("draw")).toBe("draw");
  });
});
