import { expect, test } from "vitest";
import { calibrateEnabled } from "./enabled.js";

test("the calibration tool is OFF unless it is explicitly turned on", () => {
  // Default off is the whole point: `POST /api/calibrate/verdict` writes the pairs file and the
  // clause fixture that back the panel's own ratchet.
  expect(calibrateEnabled({})).toBe(false);
  expect(calibrateEnabled({ MTG_CALIBRATE: "1" })).toBe(true);
});

test("only the literal \"1\" opens it", () => {
  // A gate that accepts any non-empty string opens on MTG_CALIBRATE=false, which is the classic way
  // one of these fails open.
  for (const v of ["", "0", "false", "no", "true", "yes", "on", " 1"]) {
    expect(calibrateEnabled({ MTG_CALIBRATE: v })).toBe(false);
  }
});
