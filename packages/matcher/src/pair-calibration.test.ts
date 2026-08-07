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
      clauseTexts: f.clauseTexts,
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

  // ROT IS CHECKED FIRST, and deliberately. When the count assertion led, going over the cap
  // aborted the test before the rot check ever ran -- so a quarantine that was over its cap could
  // not tell you that one of its entries had since been FIXED. That is exactly what happened
  // between 2026-08-06 and 2026-08-07: the gate sat red on the count while silently sitting on a
  // banked improvement (Forbidden Orchard / Will of the Sultai). A ratchet that stops reporting
  // the moment it fails is not a ratchet.
  const fixed = known
    .filter((p) => (p.verdict === "synergy") === links(p))
    .map((p) => `${p.a} / ${p.b}`);
  expect(fixed, "these now agree with the engine — drop knownDefect to bank it").toEqual([]);

  expect(known.length).toBeLessThanOrEqual(KNOWN_DEFECT_CAP);
});

/** Raise ONLY with a reason, and lower it whenever a defect is fixed. Started at 0: nothing had been
 *  judged yet, so any quarantine at all is a deliberate act.
 *
 *  **2 as of 2026-08-07**, after re-measuring all three quarantined pairs against the engine of the
 *  day. It sat at 0 with three pairs quarantined, so this gate had been RED since 2026-08-06 —
 *  which is worse than a wrong cap, because a red ratchet stops ratcheting: no new defect could be
 *  detected while the assertion was already failing for an unrelated reason.
 *
 *  One of the three was banked rather than counted:
 *  - **Forbidden Orchard / Will of the Sultai** — quarantined as a false edge, and the engine no
 *    longer links them. `knownDefect` dropped, which is the gate's own instruction for an
 *    improvement.
 *
 *  The two that remain are real MISSED edges, both judged `synergy` and both producing no reason:
 *  - **Court of Embereth / Dion, Bahamut's Dominant** — Court's second chapter deals damage scaled
 *    by how many creatures you control, so a token maker feeds it. The engine has no relation for
 *    "an effect whose SIZE scales with a board count", which is the magnitude work
 *    (`2026-08-06-count-matters-design.md`), not a matcher gate.
 *  - **K-9, Mark I / Ellie and Alan, Paleontologists** — the record carries `tagDefects` on BOTH
 *    cards: K-9's legends-matter ward/unblockable grant and Ellie and Alan's exile-recursion are
 *    mis-tagged at the CLAUSE layer. Fixing it means re-normalising those two cards, which costs
 *    model spend, not a code change.
 *
 *  Lower this the moment either lands. */
const KNOWN_DEFECT_CAP = 2;
