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

/** The zones a verb ALREADY implies, so restating them is noise rather than a disagreement. Kept
 *  deliberately small and exact — only verbs whose movement is fixed by the rules every time.
 *  `reveal` is absent on purpose: a card can be revealed from hand, library or exile, so a stated
 *  zone there is real information the gate has no business assuming. */
const REDUNDANT_ZONE: Record<string, { fromZone?: string; toZone?: string }> = {
  draw: { fromZone: "library", toZone: "hand" },
  mill: { fromZone: "library", toZone: "graveyard" },
  discard: { fromZone: "hand", toZone: "graveyard" },
};

const VERB_SET = new Set<string>(VERBS);
const ZONE_SET = new Set<string>(ZONES);
const TRIGGER_SET = new Set<string>(TRIGGERS);

/** Verbs allowed to carry zones. `ZONED_VERBS` is the set the PROMPT names; two more are added
 *  because the gate must accept what derivation can consume, or it rejects a card forever over a
 *  disagreement between two of our own tables:
 *    - `play`, because `effect-kind.ts:24` consumes `{ verb: "play", from: "graveyard" }` as
 *      graveyard-recursion, which is the whole of Muldrotha;
 *    - `shuffle`, because "shuffle your graveyard into your library" (Perpetual Timepiece) moves
 *      cards between two named zones and both of them are the card. */
const ZONED = new Set<string>([...ZONED_VERBS, "play", "shuffle"]);

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

const violation = (
  clauseId: number, kind: ViolationKind, detail: string, severity?: ClauseViolation["severity"],
): ClauseViolation => ({
  clauseId, kind, severity: severity ?? (WARN_ONLY.has(kind) ? "warn" : "reject"), detail,
});

/** How well does a record answer a given clause? Used only to choose, among the records claiming one
 *  id, which one the clause actually meant — the rest are overflow.
 *
 *  Positional choice is not good enough: on the 2026-08-06 re-run the model emitted Brinelin's
 *  overflow BEFORE the "Partner" record, both numbered 2, so first-wins handed the slot to the
 *  triggered record and left the keyword record to be validated against a triggered clause. Both
 *  orders occur, so the tie has to be broken on CONTENT. */
function fitScore(clause: Clause, rec: ClauseRecord): number {
  let score = 0;
  if ((clause.abilityType ?? "none") === (rec.abilityType ?? "none")) score += 2;
  if ((clause.abilityType === "triggered") === Boolean(rec.trigger?.event)) score += 1;
  return score;
}

export function validateClauses(segmented: Clause[], got: ClauseRecord[]): ClauseViolation[] {
  const out: ClauseViolation[] = [];
  const expected = new Map(segmented.map((c) => [c.id, c]));
  const seen = new Set<number>();
  // A clause stating two trigger conditions is legitimately answered with one record per condition:
  // the schema holds a single `trigger`, so the second event has nowhere else to go, and the model
  // numbers the overflow itself. Each such clause buys exactly ONE extra record and no more —
  // beyond that there is no clause left for the record to belong to and it is a hallucination
  // again. The overflow is validated against its parent clause, so it is checked for what it says.
  //
  // WHICH id the overflow carries is bookkeeping the harness does itself. The prompt has asked for
  // "an id larger than every id in the list" for two versions, naming Brinelin and Titans' Vanguard
  // in the text, and Brinelin, Wand of Orcus, Lumbering Worldwagon and Titans' Vanguard all still
  // put it on the next sequential id — which on every one of them is a printed keyword clause, so
  // the gate saw a trigger on a non-triggered clause and refused the card. Asking a third time is
  // not a fix.
  const overflowParents = segmented.filter((c) => c.multiTrigger);

  // Grouped by id first, because a group of records claiming one id has to be resolved as a group:
  // the best-fitting record answers the clause and the others overflow. See `fitScore`.
  const byId = new Map<number, ClauseRecord[]>();
  for (const rec of got) {
    if (!byId.has(rec.id)) byId.set(rec.id, []);
    byId.get(rec.id)!.push(rec);
  }

  const overflow = (rec: ClauseRecord): void => {
    const parent = overflowParents.shift();
    if (parent) out.push(...validateOne(parent, rec));
    else if (expected.has(rec.id)) {
      out.push(violation(rec.id, "duplicate-id", `clause ${rec.id} answered more than once`));
    } else out.push(violation(rec.id, "invented-id", `no clause ${rec.id} was sent`));
  };

  for (const [id, group] of byId) {
    const clause = expected.get(id);
    if (!clause) { for (const rec of group) overflow(rec); continue; }
    let best = 0;
    for (let i = 1; i < group.length; i++) {
      if (fitScore(clause, group[i]) > fitScore(clause, group[best])) best = i;
    }
    seen.add(id);
    out.push(...validateOne(clause, group[best]));
    for (let i = 0; i < group.length; i++) if (i !== best) overflow(group[i]);
  }

  for (const c of segmented) {
    if (!seen.has(c.id)) out.push(violation(c.id, "missing-id", `clause ${c.id} unanswered`));
  }
  return out;
}

function validateOne(clause: Clause, rec: ClauseRecord): ClauseViolation[] {
  const out: ClauseViolation[] = [];
  const at = (kind: ViolationKind, detail: string, severity?: ClauseViolation["severity"]): void => {
    out.push(violation(clause.id, kind, detail, severity));
  };

  // `abilityType` is copied, never re-decided (normalize-prompt.ts). Only checked where the
  // segmenter actually assigned one -- inert clauses are answered in code as "none".
  if (clause.abilityType && rec.abilityType !== clause.abilityType) {
    at("ability-type-mismatch", `expected "${clause.abilityType}", got "${rec.abilityType}"`);
  }

  // Two clause kinds are typed "triggered" but carry no trigger of their OWN, so demanding one
  // refuses the whole card. Both were measured on the calibration run, where `missing-trigger` was
  // the single largest refusal cause:
  //   - a MODE inherits its abilityType from the parent, and the parent holds the trigger
  //     (Pip-Boy 3000: "Whenever equipped creature attacks, choose one —" plus three modes);
  //   - a CHAPTER is fired by the Saga's lore counter, which is not an event in TRIGGERS.
  // Narrow on purpose: an ordinary triggered clause missing its event is still fatal, or a real
  // trigger could be silently dropped.
  const triggerLivesElsewhere = clause.kind === "mode" || clause.kind === "chapter";
  const triggered = clause.abilityType === "triggered";
  if (triggered && !triggerLivesElsewhere && !hasTrigger(rec)) {
    at("missing-trigger", "triggered clause carries no trigger event");
  }
  if (!triggered && hasTrigger(rec)) {
    // A stray trigger on a SPELL clause is usually a DELAYED trigger the vocabulary cannot express:
    // Eerie Interlude is an instant that returns the exiled creatures "at the beginning of the next
    // end step", and the model keeps recording that timing because it is real. `end-step` is a legal
    // verb, so nothing false is asserted -- the card genuinely acts then. Refusing it cost two paid
    // retries and blocked the fixture, so it warns.
    //
    // On a STATIC clause it stays a reject: that is the wildcard-mesh shape this layer keeps
    // finding, where an ability acquires an event it does not actually watch.
    // ...and the same is true inside an ACTIVATED ability: Chandra, the Firebrand's "+1: When you
    // next cast an instant or sorcery spell this turn, copy that spell" states a real delayed
    // trigger, as does Jace, Cunning Castaway. Both were refused on every run over a timing the
    // card genuinely has. STATIC stays fatal -- that is where the wildcard mesh lives.
    const delayed = clause.abilityType === "spell" || clause.abilityType === "activated";
    at(
      "unexpected-trigger",
      `trigger "${rec.trigger!.event}" on a ${clause.abilityType ?? "non-triggered"} clause`,
      delayed ? "warn" : "reject",
    );
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
      // DRIFT IS NOT A REASON TO REFUSE A CARD, though, and it was: 10 of the 15 zone violations in
      // the 2026-08-29 tranche were `fromZone`/`toZone` on `draw`, and drawing really does move a
      // card from library to hand. The model was stating the truth more explicitly than the schema
      // wants, `canonicalize` nulls implied zones one step later anyway, and the whole card was
      // being thrown away over it. Redundant-but-correct warns; anything else still rejects, so a
      // model claiming `draw` from a GRAVEYARD is refused exactly as before.
      else if (!ZONED.has(verb)) {
        const redundant = REDUNDANT_ZONE[verb]?.[field] === zone;
        at("zone-on-unzoned-verb", `${field} set on "${verb}"${redundant ? " (redundant, not wrong)" : ""}`,
          redundant ? "warn" : undefined);
      }
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
