/** HAND-AUTHORED CLAUSES, for the cards the pipeline structurally cannot answer.
 *
 *  The normalizer is used ONCE, offline, and everything downstream is deterministic — so a card the
 *  persist gate refuses forever contributes nothing at all. A handful genuinely deserve that (a
 *  four-condition trigger head has nowhere to go in a schema holding two), and this is where their
 *  answer is written by hand instead.
 *
 *  IT IS A COMMITTED FIXTURE AND NOT A ROW SOMEONE INSERTS INTO MONGO, and that is the whole design:
 *  a hand-written answer is reviewable as a diff, survives a fresh clone, and CANNOT SILENTLY
 *  OUTLIVE ITS REASON. `segmentHash` covers the card's printed text and never the segmenter's
 *  behaviour, so a doc written straight into the database is invisible to every later fix — the
 *  freeze this project hit for real on 2026-08-29, when four segmenter changes landed without a
 *  NORMALIZE_VERSION bump and 35 persisted docs became unreachable.
 *
 *  THREE RULES, and the second is the one that makes this safe rather than a back door:
 *
 *  1. AN ENTRY IS PERSISTED THROUGH THE SAME WRITER AS A BOUGHT ANSWER, stamped `model: "manual"`,
 *     so every coverage figure can separate authored from measured. "21,315 clause docs" means
 *     MEASURED today and must keep meaning that.
 *
 *  2. AN ENTRY RUNS THROUGH THE PERSIST GATE. It may declare specific violation kinds it is allowed
 *     to carry, each with a written reason; everything else still refuses it. A typo in a verb name
 *     is caught exactly as it would be in a model's answer, because the gate compares against the
 *     segmenter's own clause list and the closed vocabularies — facts that hold whoever wrote the
 *     answer.
 *
 *  3. A WAIVER THAT NO LONGER FIRES IS AN ERROR. When the harness learns to handle the shape, the
 *     waived violation stops appearing and `manual-clauses.test.ts` FAILS, forcing the entry to be
 *     deleted and the improvement banked. Shrink-only, the same ratchet shape as `REFUSED_CAP`,
 *     `MTGJSON_LAG` and the browser-bundle list.
 *
 *  A WAIVER IS FOR A SHAPE THE HARNESS CANNOT EXPRESS, NEVER FOR A MISSING WORD. Avatar Aang was the
 *  intended first entry and is deliberately absent: its trigger head names waterbend, earthbend,
 *  firebend and airbend, and three are keyword ACTIONS in `TRIGGERS` while `firebend` is not — a
 *  vocabulary gap, which belongs in the vocabulary. Waiving `unknown-trigger-event` would make the
 *  card work and erase the signal, which is the Karmic Justice ruling one layer over. So the fixture
 *  is EMPTY: no card currently qualifies, and that is the goal state rather than a gap. */
import { readFileSync } from "node:fs";
import type { Clause } from "./segment.js";
import type { ClauseRecord } from "./canonicalize.js";
import { rejections, validateClauses, type ClauseViolation, type ViolationKind } from "./validate-clauses.js";

export interface ManualEntry {
  /** Scryfall oracle id — the key, because a name can move between cards (the 2026-08-25 collision). */
  oracleId: string;
  /** For a reader. Never used for lookup. */
  name: string;
  /** Why the pipeline cannot answer this card. Required, and asserted non-empty by the ratchet. */
  reason: string;
  /** Violation kinds this entry may carry. Each must ACTUALLY fire, or the ratchet fails. */
  waivers: ViolationKind[];
  /** The card's printed inputs, stored HERE so the ratchet is free and needs no database — the same
   *  trick `repeats-refused.json` uses. `bin/manual-clauses-check.ts` compares them against the
   *  live corpus, so an errata reopens the card instead of keeping a stale hand-written answer. */
  oracleText: string;
  typeLine: string;
  keywords: string[];
  /** The hand-authored answer, in exactly the shape the model would have returned. */
  clauses: ClauseRecord[];
}

const FIXTURE = new URL("manual-clauses.json", import.meta.url);

export function loadManualEntries(): ManualEntry[] {
  return JSON.parse(readFileSync(FIXTURE, "utf8")) as ManualEntry[];
}

/** The violations an entry carries that it did NOT declare. Empty means the entry may be persisted.
 *
 *  Only REJECT-severity violations are considered: a warn is recorded on a bought answer and
 *  persists, so a hand-written one should not be held to a stricter bar than the model. */
export function unwaivedViolations(entry: ManualEntry, segmented: Clause[]): ClauseViolation[] {
  const waived = new Set<ViolationKind>(entry.waivers);
  return rejections(validateClauses(segmented, entry.clauses)).filter((v) => !waived.has(v.kind));
}

/** Which of an entry's declared waivers are NOT actually needed against today's harness.
 *
 *  THE RATCHET READS THIS AND FAILS ON A NON-EMPTY ANSWER. A waiver stops firing exactly when the
 *  segmenter, the gate or the vocabulary learns to handle the shape — which is the moment the entry
 *  should be deleted and the card returned to the normal pipeline. Left unchecked, a hand-written
 *  answer would quietly outlive the defect that justified it. */
export function staleWaivers(entry: ManualEntry, segmented: Clause[]): ViolationKind[] {
  const fired = new Set(rejections(validateClauses(segmented, entry.clauses)).map((v) => v.kind));
  return entry.waivers.filter((w) => !fired.has(w));
}
