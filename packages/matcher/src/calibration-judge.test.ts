import { expect, test, vi } from "vitest";
import { calibrateEnabled, handleCalibrateRequest, type CalibrateDeps, type CalibratePair } from "./calibration-judge.js";

test("the calibration tool is OFF unless it is explicitly turned on", () => {
  // Default off is the whole point: a verdict writes the pairs file and the clause fixture that
  // back the panel's own ratchet.
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

const card = (name: string) => ({ name, typeLine: "Creature", oracleText: "", tags: [] });
const PAIR: CalibratePair = { a: card("A"), b: card("B"), stratum: "random", engineReasons: [] };
const fakeDeps = (pair: CalibratePair | null = PAIR) => ({
  samplePair: vi.fn(async () => pair),
  record: vi.fn(async () => ({ total: 3, knownDefects: 1 })),
}) satisfies CalibrateDeps;

test("GET /pair serves a sampled pair, and says so when there is none", async () => {
  await expect(handleCalibrateRequest(fakeDeps(), "GET", "/api/calibrate/pair", undefined))
    .resolves.toEqual({ status: 200, json: PAIR });
  const empty = await handleCalibrateRequest(fakeDeps(null), "GET", "/api/calibrate/pair", undefined);
  expect(empty.status).toBe(500);
});

test("a valid verdict is recorded and answers the running totals", async () => {
  const deps = fakeDeps();
  const body = { a: "A", b: "B", verdict: "synergy", stratum: "linked", note: "n" };
  await expect(handleCalibrateRequest(deps, "POST", "/api/calibrate/verdict", body))
    .resolves.toEqual({ status: 200, json: { total: 3, knownDefects: 1 } });
  expect(deps.record).toHaveBeenCalledWith(body);
});

/** Validated rather than trusted: a typo'd verdict would be written to a file the test suite reads,
 *  and a gate fed junk is worse than no gate. Nothing invalid may reach `record`. */
test("an invalid verdict is a 400 and writes nothing", async () => {
  const deps = fakeDeps();
  const bad = [
    null,
    { a: "A", b: "A", verdict: "synergy", stratum: "linked" },
    { a: "A", verdict: "synergy", stratum: "linked" },
    { a: "A", b: "B", verdict: "great", stratum: "linked" },
    { a: "A", b: "B", verdict: "synergy", stratum: "hand-picked" },
  ];
  for (const body of bad) {
    const out = await handleCalibrateRequest(deps, "POST", "/api/calibrate/verdict", body);
    expect(out.status, JSON.stringify(body)).toBe(400);
  }
  expect(deps.record).not.toHaveBeenCalled();
});

test("anything else under the prefix is a 404", async () => {
  const deps = fakeDeps();
  for (const [m, p] of [["POST", "/api/calibrate/pair"], ["GET", "/api/calibrate/verdict"], ["GET", "/api/calibrate/x"]]) {
    expect((await handleCalibrateRequest(deps, m!, p!, undefined)).status).toBe(404);
  }
});
