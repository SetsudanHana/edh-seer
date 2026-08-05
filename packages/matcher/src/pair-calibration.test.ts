/** The gate for human pair verdicts. Spec:
 *  `docs/superpowers/specs/2026-08-06-pair-calibration-tool-design.md`.
 *
 *  Runs OFFLINE, like `derive-compass.test.ts` and unlike the compass bin: the calibration tool
 *  snapshots each judged card's clauses into a fixture, so tags are derived in-process and no
 *  database is needed. A gate that needed Mongo could not run in CI, and would quietly stop being a
 *  gate at all. */
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { deriveCardTags } from "@mtg/tagger";
import { loadHierarchy, pairReasons } from "./index.js";
import type { DeckCard } from "./types.js";
import type { ClauseFixture, PairRecord } from "./bin/pair-calibrate-core.js";

const read = <T>(path: string, fallback: T): T => {
  try {
    return JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8")) as T;
  } catch {
    return fallback; // not judged yet — an empty suite is green, not broken
  }
};

const PAIRS = read<PairRecord[]>("./calibration-pairs.json", []);
const FIXTURE = read<ClauseFixture[]>("./fixtures/calibration-clauses.json", []);
const byName = new Map(FIXTURE.map((f) => [f.name, f]));
const hierarchy = loadHierarchy();

function deckCard(name: string): DeckCard {
  const f = byName.get(name);
  if (!f) throw new Error(`fixture missing card: ${name}`);
  return {
    card: {
      name: f.name,
      typeLine: [...f.characteristics.types, ...f.characteristics.subtypes].join(" "),
      oracleText: "",
      keywords: f.characteristics.keywords,
      colors: f.characteristics.colors,
      manaValue: f.characteristics.cmc,
      colorIdentity: f.characteristics.identity,
      power: f.characteristics.power,
      toughness: f.characteristics.toughness,
    },
    tags: deriveCardTags({
      oracleId: f.oracleId, name: f.name, clauses: f.clauses, characteristics: f.characteristics,
    }),
  };
}

const links = (p: PairRecord): boolean =>
  pairReasons(deckCard(p.a), deckCard(p.b), hierarchy).length > 0;

test("every judged card is in the fixture, so the gate can run without a database", () => {
  const needed = [...new Set(PAIRS.flatMap((p) => [p.a, p.b]))];
  expect(needed.filter((n) => !byName.has(n))).toEqual([]);
});

test("a pair judged SYNERGY produces at least one reason", () => {
  const failures = PAIRS
    .filter((p) => p.verdict === "synergy" && !p.knownDefect)
    .filter((p) => !links(p))
    .map((p) => `${p.a} / ${p.b}`);
  expect(failures).toEqual([]);
});

test("a pair judged NEUTRAL or ANTI-SYNERGY produces no reason at all", () => {
  // anti-synergy asserts the same as neutral for now: the engine has no signed verdict yet. The
  // verdicts are stored distinctly so they become ground truth when the −5..+5 work lands, instead
  // of needing to be re-judged then.
  const failures = PAIRS
    .filter((p) => p.verdict !== "synergy" && !p.knownDefect)
    .filter((p) => links(p))
    .map((p) => `${p.a} / ${p.b} (${p.verdict})`);
  expect(failures).toEqual([]);
});

test("the known-defect quarantine never grows, and cannot rot", () => {
  // The same ratchet as the compass's KNOWN_BASELINE_DEFECTS. Two directions:
  //  - the COUNT is capped, so a new disagreement cannot be waved through by marking it known;
  //  - a quarantined pair that now AGREES fails, so banked improvements must be un-marked.
  const known = PAIRS.filter((p) => p.knownDefect);
  expect(known.length).toBeLessThanOrEqual(KNOWN_DEFECT_CAP);

  const fixed = known
    .filter((p) => (p.verdict === "synergy") === links(p))
    .map((p) => `${p.a} / ${p.b}`);
  expect(fixed, "these now agree with the engine — drop knownDefect to bank it").toEqual([]);
});

/** Raise ONLY with a reason, and lower it whenever a defect is fixed. Starts at 0: nothing has been
 *  judged yet, so any quarantine at all is a deliberate act. */
const KNOWN_DEFECT_CAP = 0;
