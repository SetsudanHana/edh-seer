/** THE DIFFERENTIAL HARNESS for the trigger grammar (#896, task 5): a candidate parser of PRINTED
 *  trigger preambles against the trigger the clause store holds, over the census
 *  (`packages/tagger/triggers.jsonl`). Pure; `trigger-diff.ts` is the CLI. Same contract as
 *  `phrase-diff-core.ts`:
 *
 *  - A candidate returns `null` for a preamble it cannot read COMPLETELY; that row keeps today's path,
 *    so it counts against coverage (S1) and never as a disagreement.
 *  - DISAGREEMENTS ARE GROUPED BY WHICH FIELDS DIFFER (H3): `event`, `control`, `condition`, `narrowing`, `timing`,
 *    and the subject's own fields as `subject.<field>`.
 *
 *  The BASELINE reading is what derive uses today: the stored event and control (`opponent` spelled
 *  `opp`), the stored subject read the way derive reads it (`subjectOf`, injected), and no condition
 *  -- an intervening if is dropped today, which is the S3 defect. */
import type { Control, SubjectFilter } from "@edh-seer/tagger/schema";
import { differingFields } from "./phrase-diff-core.js";

export interface TriggerRow { preamble: string; condition: string | null; event: string | null; subject: string; control: string | null; cards: number }

/** What a trigger reads as. `condition` and `timing` are opaque to the harness beyond equality. */
export interface TriggerReading {
  event: string;
  subject?: Partial<SubjectFilter>;
  control?: Control;
  condition?: unknown;
  narrowing?: unknown;
  timing?: unknown;
}
/** A compound preamble ("whenever ~ enters or attacks") is one reading per event; the store holds one
 *  clause per event, so a row is compared with the reading that names its event. */
export type TriggerParser = (preamble: string, condition: string | null) => TriggerReading | TriggerReading[] | null;

export interface Example { row: TriggerRow; baseline: TriggerReading; candidate: TriggerReading }
export interface Group { fields: string[]; distinct: number; cards: number; examples: Example[] }
export interface Tally { distinct: number; cards: number }
export interface TriggerDiff { total: Tally; parsed: Tally; agree: Tally; nondeterministic: string[]; groups: Group[] }

const EXAMPLES = 20;
const CLAUSE_CONTROL: Record<string, Control> = { you: "you", opponent: "opp", any: "any" };

/** The stored trigger as derive reads it: `subjectOf` is derive's subject reader, the clause's control
 *  overwrites the subject's (derive's `subject.control = control`), and a self phrase is `self`. The
 *  patches derive applies after that (the permanent-event control flip, the damage direction) are
 *  NOT replayed: they are what the grammar replaces, so they show as disagreements. */
export function storedReading(row: TriggerRow, subjectOf: (text: string) => Partial<SubjectFilter>, isSelf: (text: string) => boolean = () => false): TriggerReading {
  const control = CLAUSE_CONTROL[row.control ?? ""];
  const subject = { ...subjectOf(row.subject), ...(control ? { control } : {}), ...(isSelf(row.subject) ? { self: true as const } : {}) };
  return { event: row.event ?? "none", subject, ...(control ? { control } : {}) };
}

const json = (v: unknown) => (v === undefined ? "undefined" : JSON.stringify(v, Object.keys(v as object ?? {}).sort()));

/** The fields two readings differ on, sorted. The subject's own differences are `subject.<field>`. */
export function readingDiff(a: TriggerReading, b: TriggerReading): string[] {
  const out: string[] = [];
  if (a.event !== b.event) out.push("event");
  if ((a.control ?? "any") !== (b.control ?? "any")) out.push("control");
  if (json(a.condition) !== json(b.condition)) out.push("condition");
  if (json(a.timing) !== json(b.timing)) out.push("timing");
  if (json(a.narrowing) !== json(b.narrowing)) out.push("narrowing");
  for (const f of differingFields(a.subject ?? {}, b.subject ?? {})) out.push(`subject.${f}`);
  return out.sort();
}

export function diffTriggers(rows: TriggerRow[], candidate: TriggerParser, subjectOf: (text: string) => Partial<SubjectFilter>, isSelf?: (text: string) => boolean): TriggerDiff {
  const total = { distinct: 0, cards: 0 }, parsed = { distinct: 0, cards: 0 }, agree = { distinct: 0, cards: 0 };
  const nondeterministic: string[] = [];
  const groups = new Map<string, Group>();
  for (const row of rows) {
    total.distinct++; total.cards += row.cards;
    const read = candidate(row.preamble, row.condition);
    if (JSON.stringify(read) !== JSON.stringify(candidate(row.preamble, row.condition))) nondeterministic.push(row.preamble);
    if (read === null) continue;
    const cand = Array.isArray(read) ? read.find((r) => r.event === row.event) ?? read[0]! : read;
    parsed.distinct++; parsed.cards += row.cards;
    const base = storedReading(row, subjectOf, isSelf);
    const fields = readingDiff(base, cand);
    if (fields.length === 0) { agree.distinct++; agree.cards += row.cards; continue; }
    const key = fields.join(",");
    const g = groups.get(key) ?? groups.set(key, { fields, distinct: 0, cards: 0, examples: [] }).get(key)!;
    g.distinct++; g.cards += row.cards;
    g.examples.push({ row, baseline: base, candidate: cand });
  }
  const sorted = [...groups.values()].sort((a, b) => b.cards - a.cards || a.fields.join().localeCompare(b.fields.join()));
  for (const g of sorted) {
    g.examples.sort((a, b) => b.row.cards - a.row.cards || a.row.preamble.localeCompare(b.row.preamble));
    g.examples = g.examples.slice(0, EXAMPLES);
  }
  return { total, parsed, agree, nondeterministic, groups: sorted };
}

export function readTriggers(jsonl: string): TriggerRow[] {
  return jsonl.split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l) as TriggerRow);
}
