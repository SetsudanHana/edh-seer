/** The persist gate for a normalizer response — run BEFORE canonicalize, and before spending is
 *  banked as a `cardClauses` document.
 *
 *  Order matters: `canonicalize.ts` collapses an empty action list to `[{verb:"none"}]` and nulls an
 *  implied origin zone, so validating after it would mask exactly the defects this hunts. Validate
 *  the raw response, then canonicalize.
 *
 *  Every check here compares the response against something the harness ALREADY KNOWS — the
 *  segmenter's own output, or a closed vocabulary. None of it is judgment, so none of it can be
 *  wrong in the way the model can be wrong. What it CANNOT see is a wrong-but-legal choice: the
 *  prompt itself names three verb pairs observed swapping (add-counter/other, animate/transform,
 *  trigger-again/create/copy), and both sides of each are legal members. That is a measurement
 *  surface, not a gate surface.
 *
 *  A card with any violation is not persisted, so it re-queues on the next run rather than banking
 *  a tag that reads as fact. */
import type { Clause } from "./segment.js";
import { ZONED_VERBS } from "./segment.js";
import type { ClauseRecord } from "./canonicalize.js";
import { VERBS, ZONES, TRIGGERS } from "./normalize-prompt.js";

export type ViolationKind =
  | "invented-id" | "missing-id" | "duplicate-id"
  | "unknown-verb" | "unknown-zone" | "unknown-trigger-event"
  | "ability-type-mismatch" | "missing-trigger" | "unexpected-trigger"
  | "zone-on-unzoned-verb" | "dropped-prefilled-action";

export interface ClauseViolation {
  /** The clause the defect belongs to; absent for whole-response defects. */
  clauseId?: number;
  kind: ViolationKind;
  /** `reject` refuses the card so it re-queues; `warn` is recorded but persists. */
  severity: "reject" | "warn";
  detail: string;
}

/** Kinds that are recorded but must NOT refuse a card.
 *
 *  `dropped-prefilled-action` was a hard reject until it was measured against the gold fixture:
 *  `bin/effect-precision.ts` puts the pre-fill table at ~96.7% precision, so ~3% of cards would be
 *  rejected on the TABLE's error and re-queue forever, paying on every run. Syr Konrad is the
 *  worked case — its trigger has three comma-separated limbs, so `effectBody`'s single-comma split
 *  leaves trigger text in the body and pre-fills `put` from a condition, not an effect. The model
 *  is right and the pre-fill is wrong. Still worth recording: a rising rate here is the signal that
 *  the model has started dropping actions for real. */
const WARN_ONLY: ReadonlySet<ViolationKind> = new Set<ViolationKind>(["dropped-prefilled-action"]);

const VERB_SET = new Set<string>(VERBS);
const ZONE_SET = new Set<string>(ZONES);
const TRIGGER_SET = new Set<string>(TRIGGERS);

/** Verbs allowed to carry zones. `ZONED_VERBS` is the set the PROMPT names; `play` is absent there
 *  but `effect-kind.ts:24` consumes `{ verb: "play", from: "graveyard" }` as graveyard-recursion,
 *  which is the whole of Muldrotha. The gate must accept what derivation can consume, or it rejects
 *  a card forever over a disagreement between two of our own tables. */
const ZONED = new Set<string>([...ZONED_VERBS, "play"]);

/** The subset that refuses the card. Everything else is recorded and persisted. */
export function rejections(violations: ClauseViolation[]): ClauseViolation[] {
  return violations.filter((v) => v.severity === "reject");
}

/** `effectActions` entries carry an amount as `verb=N`; the pre-fill contract is about the verb. */
const verbOf = (entry: string): string => entry.split("=")[0];

/** The vocabulary's way of saying "no trigger" — `canonicalTrigger` treats it as absent, so the
 *  gate must not read it as one either. */
function hasTrigger(r: ClauseRecord): boolean {
  return Boolean(r.trigger && r.trigger.event && r.trigger.event !== "none");
}

const violation = (clauseId: number, kind: ViolationKind, detail: string): ClauseViolation => ({
  clauseId, kind, severity: WARN_ONLY.has(kind) ? "warn" : "reject", detail,
});

export function validateClauses(segmented: Clause[], got: ClauseRecord[]): ClauseViolation[] {
  const out: ClauseViolation[] = [];
  const expected = new Map(segmented.map((c) => [c.id, c]));
  const seen = new Set<number>();

  for (const rec of got) {
    if (!expected.has(rec.id)) {
      out.push(violation(rec.id, "invented-id", `no clause ${rec.id} was sent`));
      continue;
    }
    if (seen.has(rec.id)) {
      out.push(violation(rec.id, "duplicate-id", `clause ${rec.id} answered more than once`));
      continue;
    }
    seen.add(rec.id);
    out.push(...validateOne(expected.get(rec.id)!, rec));
  }

  for (const c of segmented) {
    if (!seen.has(c.id)) out.push(violation(c.id, "missing-id", `clause ${c.id} unanswered`));
  }
  return out;
}

function validateOne(clause: Clause, rec: ClauseRecord): ClauseViolation[] {
  const out: ClauseViolation[] = [];
  const at = (kind: ViolationKind, detail: string): void => {
    out.push(violation(clause.id, kind, detail));
  };

  // `abilityType` is copied, never re-decided (normalize-prompt.ts). Only checked where the
  // segmenter actually assigned one -- inert clauses are answered in code as "none".
  if (clause.abilityType && rec.abilityType !== clause.abilityType) {
    at("ability-type-mismatch", `expected "${clause.abilityType}", got "${rec.abilityType}"`);
  }

  const triggered = clause.abilityType === "triggered";
  if (triggered && !hasTrigger(rec)) at("missing-trigger", "triggered clause carries no trigger event");
  if (!triggered && hasTrigger(rec)) {
    at("unexpected-trigger", `trigger "${rec.trigger!.event}" on a ${clause.abilityType ?? "non-triggered"} clause`);
  }
  if (rec.trigger?.event && !TRIGGER_SET.has(rec.trigger.event)) {
    at("unknown-trigger-event", `"${rec.trigger.event}" is not in TRIGGERS`);
  }

  const actions = rec.actions ?? [];
  for (const a of actions) {
    const verb = a.verb ?? "";
    if (!VERB_SET.has(verb)) at("unknown-verb", `"${verb}" is not in VERBS`);
    for (const [field, zone] of [["fromZone", a.fromZone], ["toZone", a.toZone]] as const) {
      if (zone === null || zone === undefined) continue;
      if (!ZONE_SET.has(zone)) at("unknown-zone", `${field} "${zone}" is not in ZONES`);
      // Every other verb already fixes its own zones; stating them twice is drift, not data.
      else if (!ZONED.has(verb)) at("zone-on-unzoned-verb", `${field} set on "${verb}"`);
    }
  }

  // Cost and effect actions were decided in code and handed over. Dropping one is the failure
  // `bin/effect-precision.ts` measured; it is pure set containment against ground truth.
  const returned = new Set(actions.map((a) => a.verb ?? ""));
  for (const entry of [...(clause.costActions ?? []), ...(clause.effectActions ?? [])]) {
    const verb = verbOf(entry);
    if (!returned.has(verb)) {
      at("dropped-prefilled-action", `pre-filled "${verb}" missing from the answer`);
    }
  }
  return out;
}
