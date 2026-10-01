/** THE DIFFERENTIAL HARNESS for the action grammar (#896, task 6): a candidate parser of a clause's
 *  PRINTED effect text against the actions the clause store holds, over the census
 *  (`packages/tagger/actions.jsonl.gz`). Pure; `action-diff.ts` is the CLI. Same contract as
 *  `trigger-diff-core.ts`:
 *
 *  - A candidate answers per clause with one reading per printed action phrase, in printed order, or
 *    `null` for a phrase it cannot read COMPLETELY; that action keeps today's path, so it counts
 *    against coverage and never as a disagreement. `null` for the whole clause reads nothing.
 *  - A clause whose phrase count differs from the stored action count is one disagreement, `count`.
 *  - DISAGREEMENTS ARE GROUPED BY FAMILY AND BY WHICH FIELDS DIFFER (H3): `verb`, `amount`,
 *    `fromZone`, `toZone`, `optional`, and the object's own fields as `object.<field>`.
 *
 *  Counted per ACTION, weighted by the cards printing the clause, and reported per verb family (the
 *  order the owner ruled, 2026-10-01): draw/search, damage/life, counters, tokens, zone, other. */
import type { SubjectFilter } from "@edh-seer/tagger/schema";
import { differingFields } from "./phrase-diff-core.js";

export interface StoredAction { verb: string; object: string; fromZone?: string; toZone?: string; amount?: string; optional?: true }
export interface ActionRow { effect: string; type: string | null; actions: StoredAction[]; cards: number }

/** What an action phrase reads as. `actor` and `condition` are the grammar's additions: the store
 *  has no field for either, so they are not compared. */
export interface ActionReading {
  verb: string;
  object?: Partial<SubjectFilter>;
  amount?: string;
  fromZone?: string;
  toZone?: string;
  optional?: true;
  actor?: unknown;
  condition?: string;
}
export type ActionParser = (effect: string, type: string | null) => (ActionReading | null)[] | null;

export const FAMILIES = ["draw-search", "damage-life", "counters", "tokens", "zone", "other"] as const;
export type Family = (typeof FAMILIES)[number];
const FAMILY_OF: Record<string, Family> = {
  draw: "draw-search", discard: "draw-search", mill: "draw-search", search: "draw-search", scry: "draw-search",
  surveil: "draw-search", reveal: "draw-search",
  "deal-damage": "damage-life", "gain-life": "damage-life", "lose-life": "damage-life", "set-life": "damage-life",
  "add-counter": "counters", "remove-counter": "counters", proliferate: "counters",
  create: "tokens", populate: "tokens", amass: "tokens", investigate: "tokens", incubate: "tokens",
  destroy: "zone", exile: "zone", sacrifice: "zone", return: "zone", put: "zone", shuffle: "zone",
};
export const familyOf = (verb: string): Family => FAMILY_OF[verb] ?? "other";

export interface Example { row: ActionRow; index: number; stored: StoredAction; candidate: ActionReading | null }
export interface Group { family: Family; fields: string[]; actions: number; cards: number; examples: Example[] }
export interface Tally { actions: number; cards: number }
export interface FamilyTally { total: Tally; parsed: Tally; agree: Tally }
export interface ActionDiff { families: Record<Family, FamilyTally>; nondeterministic: string[]; groups: Group[] }

const EXAMPLES = 20;
const json = (v: unknown) => (v === undefined ? "undefined" : JSON.stringify(v));

/** The fields a stored action and a reading differ on, sorted. `subjectOf` reads the stored object
 *  the way derive does. */
export function actionDiff(stored: StoredAction, read: ActionReading, subjectOf: (text: string) => Partial<SubjectFilter>): string[] {
  const out: string[] = [];
  if (stored.verb !== read.verb) out.push("verb");
  for (const f of ["amount", "fromZone", "toZone", "optional"] as const) if (json(stored[f]) !== json(read[f])) out.push(f);
  for (const f of differingFields(subjectOf(stored.object), read.object ?? {})) out.push(`object.${f}`);
  return out.sort();
}

export function diffActions(rows: ActionRow[], candidate: ActionParser, subjectOf: (text: string) => Partial<SubjectFilter>): ActionDiff {
  const zero = (): FamilyTally => ({ total: { actions: 0, cards: 0 }, parsed: { actions: 0, cards: 0 }, agree: { actions: 0, cards: 0 } });
  const families = Object.fromEntries(FAMILIES.map((f) => [f, zero()])) as Record<Family, FamilyTally>;
  const nondeterministic: string[] = [];
  const groups = new Map<string, Group>();
  const add = (family: Family, fields: string[], ex: Example) => {
    const key = `${family}|${fields.join(",")}`;
    const g = groups.get(key) ?? groups.set(key, { family, fields, actions: 0, cards: 0, examples: [] }).get(key)!;
    g.actions++; g.cards += ex.row.cards; g.examples.push(ex);
  };
  const bump = (t: Tally, cards: number) => { t.actions++; t.cards += cards; };
  for (const row of rows) {
    const read = candidate(row.effect, row.type);
    if (JSON.stringify(read) !== JSON.stringify(candidate(row.effect, row.type))) nondeterministic.push(row.effect);
    row.actions.forEach((stored, i) => {
      const family = familyOf(stored.verb);
      const t = families[family];
      bump(t.total, row.cards);
      if (read === null) return;
      if (read.length !== row.actions.length) {
        bump(t.parsed, row.cards);
        add(family, ["count"], { row, index: i, stored, candidate: read[i] ?? null });
        return;
      }
      const r = read[i];
      if (r === null || r === undefined) return;
      bump(t.parsed, row.cards);
      const fields = actionDiff(stored, r, subjectOf);
      if (fields.length === 0) bump(t.agree, row.cards);
      else add(family, fields, { row, index: i, stored, candidate: r });
    });
  }
  const sorted = [...groups.values()].sort((a, b) => b.cards - a.cards || a.family.localeCompare(b.family) || a.fields.join().localeCompare(b.fields.join()));
  for (const g of sorted) {
    g.examples.sort((a, b) => b.row.cards - a.row.cards || a.row.effect.localeCompare(b.row.effect));
    g.examples = g.examples.slice(0, EXAMPLES);
  }
  return { families, nondeterministic, groups: sorted };
}

export function readActions(jsonl: string): ActionRow[] {
  return jsonl.split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l) as ActionRow);
}
