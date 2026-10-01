/** THE DIFFERENTIAL HARNESS for the action grammar (#896, task 6): a candidate parser of a clause's
 *  PRINTED effect text against the actions the clause store holds, over the census
 *  (`packages/tagger/actions.jsonl.gz`). Pure; `action-diff.ts` is the CLI. Same contract as
 *  `trigger-diff-core.ts`:
 *
 *  - A candidate answers per clause with the actions it read COMPLETELY, in printed order (the cost's
 *    first, as the store writes them). A phrase it cannot read is simply absent: that action keeps
 *    today's path, so it counts against coverage and never as a disagreement.
 *  - READINGS ALIGN TO STORED ACTIONS BY VERB, in order (a longest common subsequence), not by index:
 *    the store splits some phrases its own way ("put it onto the battlefield tapped" is put + tap).
 *    An aligned pair is compared field by field; a reading nothing aligns with is `extra:<verb>`.
 *  - DISAGREEMENTS ARE GROUPED BY FAMILY AND BY WHICH FIELDS DIFFER (H3): `verb`, `amount`,
 *    `fromZone`, `toZone`, `optional`, and the object's own fields as `object.<field>`.
 *
 *  Counted per ACTION, weighted by the cards printing the clause, and reported per verb family (the
 *  order the owner ruled, 2026-10-01): draw/search, damage/life, counters, tokens, zone, other. */
import type { SubjectFilter } from "@edh-seer/tagger/schema";
import { counterKindOf, parseCounter } from "@edh-seer/tagger/subject";
import { differingFields } from "./phrase-diff-core.js";

export interface StoredAction { verb: string; object: string; fromZone?: string; toZone?: string; amount?: string; optional?: true }
export interface ActionRow { effect: string; type: string | null; cost?: string; actions: StoredAction[]; cards: number }

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
  counter?: string;
  text?: string;
}
export type ActionParser = (effect: string, type: string | null, cost?: string) => ActionReading[] | null;

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

export interface Example { row: ActionRow; index: number; stored: StoredAction | null; candidate: ActionReading | null }
export interface Group { family: Family; fields: string[]; actions: number; cards: number; examples: Example[] }
export interface Tally { actions: number; cards: number }
export interface FamilyTally { total: Tally; parsed: Tally; agree: Tally }
export interface ActionDiff { families: Record<Family, FamilyTally>; nondeterministic: string[]; groups: Group[] }

const EXAMPLES = 20;
const json = (v: unknown) => (v === undefined ? "undefined" : JSON.stringify(v));

/** The counter KIND a stored counter action names in its object ("+1/+1", "a stun counter",
 *  "target creature, +1/+1"). */
export const storedCounter = (object: string): string => counterKindOf(object) ?? parseCounter(object.toLowerCase()) ?? object;

/** The fields a stored action and a reading differ on, sorted. `subjectOf` reads the stored object
 *  the way derive does. */
export function actionDiff(stored: StoredAction, read: ActionReading, subjectOf: (text: string) => Partial<SubjectFilter>): string[] {
  const out: string[] = [];
  if (stored.verb !== read.verb) out.push("verb");
  for (const f of ["amount", "fromZone", "toZone", "optional"] as const) if (json(stored[f]) !== json(read[f])) out.push(f);
  // A COUNTER action's stored object is the counter KIND ("+1/+1"); the reading carries the kind as
  // `counter` and the recipient as its object, which the store has no slot for (#731).
  if (stored.verb === "proliferate") return out.sort();
  // A GRANT's stored object is the ability ("flying"); the reading's object is who gets it, and its
  // text the ability.
  if (stored.verb === "grant-ability") {
    if (stored.object.toLowerCase() !== (read.text ?? "").toLowerCase()) out.push("ability");
    return out.sort();
  }
  if (stored.verb === "add-counter" || stored.verb === "remove-counter") {
    if (storedCounter(stored.object) !== (read.counter ?? "")) out.push("counter");
    return out.sort();
  }
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
    const read = candidate(row.effect, row.type, row.cost);
    if (JSON.stringify(read) !== JSON.stringify(candidate(row.effect, row.type, row.cost))) nondeterministic.push(row.effect);
    // Aligned FAMILY BY FAMILY: one sequence over every verb can trade a draw's match for two life
    // matches, which is not a disagreement about either.
    const pairs = alignByFamily(row.actions.map((a) => a.verb), (read ?? []).map((r) => r.verb));
    const matchedRead = new Set(pairs.map(([, j]) => j));
    const readOf = new Map(pairs);
    row.actions.forEach((stored, i) => {
      const t = families[familyOf(stored.verb)];
      bump(t.total, row.cards);
      const j = readOf.get(i);
      if (j === undefined) return;
      bump(t.parsed, row.cards);
      const fields = actionDiff(stored, read![j]!, subjectOf);
      if (fields.length === 0) bump(t.agree, row.cards);
      else add(familyOf(stored.verb), fields, { row, index: i, stored, candidate: read![j]! });
    });
    (read ?? []).forEach((r, j) => {
      if (!matchedRead.has(j)) add(familyOf(r.verb), [`extra:${r.verb}`], { row, index: j, stored: null, candidate: r });
    });
  }
  const sorted = [...groups.values()].sort((a, b) => b.cards - a.cards || a.family.localeCompare(b.family) || a.fields.join().localeCompare(b.fields.join()));
  for (const g of sorted) {
    g.examples.sort((a, b) => b.row.cards - a.row.cards || a.row.effect.localeCompare(b.row.effect));
    g.examples = g.examples.slice(0, EXAMPLES);
  }
  return { families, nondeterministic, groups: sorted };
}

/** `align` within each verb family, the pairs mapped back to the full sequences. */
export function alignByFamily(stored: string[], read: string[]): [number, number][] {
  const out: [number, number][] = [];
  for (const f of FAMILIES) {
    const si = stored.flatMap((v, i) => (familyOf(v) === f ? [i] : []));
    const ri = read.flatMap((v, j) => (familyOf(v) === f ? [j] : []));
    for (const [i, j] of align(si.map((i) => stored[i]!), ri.map((j) => read[j]!))) out.push([si[i]!, ri[j]!]);
  }
  return out;
}

/** Index pairs [stored, read] of a longest common subsequence of two verb sequences. */
export function align(stored: string[], read: string[]): [number, number][] {
  const n = stored.length, m = read.length;
  const L = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    L[i]![j] = stored[i] === read[j] ? L[i + 1]![j + 1]! + 1 : Math.max(L[i + 1]![j]!, L[i]![j + 1]!);
  }
  const out: [number, number][] = [];
  for (let i = 0, j = 0; i < n && j < m;) {
    if (stored[i] === read[j]) { out.push([i, j]); i++; j++; } else if (L[i + 1]![j]! >= L[i]![j + 1]!) i++; else j++;
  }
  return out;
}

export function readActions(jsonl: string): ActionRow[] {
  return jsonl.split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l) as ActionRow);
}
