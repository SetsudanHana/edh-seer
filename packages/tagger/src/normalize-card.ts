/** Normalize ONE card: segment mechanically, ask the model about the clauses that state an action,
 *  answer the inert ones in code, and gate the answer before it is worth anything.
 *
 *  This is the third place the askable/inert split has been written (`bin/build-gold-fixture.ts`,
 *  `bin/normalize-experiment.ts`), which is why it is a function now. Those two are deliberately NOT
 *  migrated onto it: they are measurement harnesses whose stored runs are compared across commits,
 *  and quietly changing how they assemble a request would invalidate that comparison. */
import type { LlmProvider } from "./llm/provider.js";
import { canonicalize, type ClauseRecord } from "./canonicalize.js";
import { SYSTEM, listClauses } from "./normalize-prompt.js";
import { segment, type Clause } from "./segment.js";
import { validateClauses, rejections, type ClauseViolation } from "./validate-clauses.js";

/** Clause kinds that state no game action. Asking about them produced pure drift — a "Level 2"
 *  divider came back `add-counter` on one run and `level-up` on the next — so they are answered
 *  here and never sent. Their slots are still filled, so the completeness invariant holds. */
const INERT = new Set(["keyword", "reminder", "level", "modal"]);

export interface NormalizedCard {
  clauses: ClauseRecord[];
  canonical: ClauseRecord[];
  /** Everything the gate found. Empty when the card is clean. */
  violations: ClauseViolation[];
  /** The subset that refuses the card; empty means persist it. */
  rejected: ClauseViolation[];
}

/** The prompt exactly as it will be sent — exported so a dry run can price a card without calling
 *  anything, and so the cost estimate cannot drift from the request actually made. */
export function buildRequest(name: string, segmented: Clause[]): { system: string; user: string } {
  const askable = segmented.filter((c) => !INERT.has(c.kind));
  return { system: SYSTEM, user: `Card: ${name}\nClauses:\n${listClauses(askable)}` };
}

/** Inert clauses answered without the model, keeping their slot ids filled. */
function synthesize(segmented: Clause[]): ClauseRecord[] {
  return segmented
    .filter((c) => INERT.has(c.kind))
    .map((c) => ({ id: c.id, abilityType: "none", actions: [{ verb: "none", object: c.text }] }));
}

export async function normalizeCard(
  provider: LlmProvider,
  card: { name: string; oracleText?: string; keywords?: string[]; typeLine?: string },
): Promise<NormalizedCard> {
  const segmented = segment(card.oracleText ?? "", card.keywords ?? [], card.typeLine ?? "");

  // A card whose every clause is inert — a vanilla creature with only "Flying, trample" — has
  // nothing to ask about. Answering it in code is both cheaper and more correct than sending an
  // empty clause list and paying for whatever comes back. 19 such cards in the calibration scope,
  // and a far larger share of the full corpus, which is mostly vanillas and keyword-only cards.
  if (!segmented.some((c) => !INERT.has(c.kind))) {
    const clauses = synthesize(segmented);
    return { clauses, canonical: canonicalize(clauses), violations: [], rejected: [] };
  }

  const { system, user } = buildRequest(card.name, segmented);

  const raw = await provider.chat([
    { role: "system", content: system },
    { role: "user", content: user },
  ]);
  const got = JSON.parse(raw) as { clauses?: unknown[] };
  const clauses = [...(got.clauses ?? []), ...synthesize(segmented)]
    .sort((a, b) => (a as { id: number }).id - (b as { id: number }).id) as ClauseRecord[];

  // Gate the RAW answer: canonicalize collapses an empty action list to [{verb:"none"}] and nulls
  // implied origin zones, so validating after it would mask the defects worth rejecting for.
  const violations = validateClauses(segmented, clauses);
  return { clauses, canonical: canonicalize(clauses), violations, rejected: rejections(violations) };
}
