/** THE DIFFERENTIAL HARNESS for the card grammar (#896, task 1): any parser against `parseSubject` over
 *  the phrase census (`packages/tagger/phrases.jsonl`). Pure; `phrase-diff.ts` is the CLI.
 *
 *  A candidate returns `null` for a phrase it cannot parse COMPLETELY -- that phrase falls back to
 *  today's path, so it counts against coverage (S1) and never as a disagreement.
 *
 *  DISAGREEMENTS ARE GROUPED BY WHICH FIELDS DIFFER (H3). Labelling thousands of phrases one at a time
 *  is not a triage anyone finishes; a group ("type" differs, "control" differs) is labelled once and
 *  its members spot-checked.
 *
 *  Two readings are the SAME filter, not a disagreement: a lone string and a one-element array
 *  (`type: "creature"` vs `["creature"]`), and an OR-list in another order. Nothing else is folded:
 *  an absent field and `null` stay different, because `token: null` is a statement. */
import type { SubjectFilter } from "@edh-seer/tagger/schema";

export interface Phrase { kind: "subject" | "object"; phrase: string; cards: number }
export type Parser = (text: string) => SubjectFilter | null;
export interface Example { kind: Phrase["kind"]; phrase: string; cards: number; baseline: SubjectFilter; candidate: SubjectFilter }
export interface Group { fields: string[]; distinct: number; cards: number; examples: Example[] }
export interface Tally { distinct: number; cards: number }
export interface PhraseDiff {
  total: Tally;
  /** Phrases the candidate parsed completely (S1). */
  parsed: Tally;
  /** ...of which it agrees with the baseline on every field. */
  agree: Tally;
  /** H2: the candidate gave the same answer twice on every phrase. */
  nondeterministic: string[];
  groups: Group[];
}

const EXAMPLES = 20;

/** JSON with object keys sorted at every depth: `anyOf` holds filters, and two parsers need not build
 *  their keys in the same order (review). */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v);
}

/** One field's value in a comparable form. */
function canon(v: unknown): string {
  if (v === undefined) return "undefined";
  const list = typeof v === "string" ? [v] : Array.isArray(v) ? v : undefined;
  return list ? JSON.stringify(list.map(stable).sort()) : stable(v);
}

/** The fields on which two filters differ, sorted. */
export function differingFields(a: object, b: object): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((k) => canon((a as Record<string, unknown>)[k]) !== canon((b as Record<string, unknown>)[k])).sort();
}

export function diffParsers(phrases: Phrase[], candidate: Parser, baseline: Parser): PhraseDiff {
  const total = { distinct: 0, cards: 0 }, parsed = { distinct: 0, cards: 0 }, agree = { distinct: 0, cards: 0 };
  const nondeterministic: string[] = [];
  const groups = new Map<string, Group>();
  for (const p of phrases) {
    total.distinct++; total.cards += p.cards;
    const cand = candidate(p.phrase);
    if (JSON.stringify(cand) !== JSON.stringify(candidate(p.phrase))) nondeterministic.push(p.phrase);
    if (cand === null) continue;
    parsed.distinct++; parsed.cards += p.cards;
    const base = baseline(p.phrase) ?? {} as SubjectFilter;
    const fields = differingFields(base, cand);
    if (fields.length === 0) { agree.distinct++; agree.cards += p.cards; continue; }
    const key = fields.join(",");
    const g = groups.get(key) ?? groups.set(key, { fields, distinct: 0, cards: 0, examples: [] }).get(key)!;
    g.distinct++; g.cards += p.cards;
    g.examples.push({ kind: p.kind, phrase: p.phrase, cards: p.cards, baseline: base, candidate: cand });
  }
  const sorted = [...groups.values()].sort((a, b) => b.cards - a.cards || a.fields.join().localeCompare(b.fields.join()));
  for (const g of sorted) {
    g.examples.sort((a, b) => b.cards - a.cards || a.phrase.localeCompare(b.phrase));
    g.examples = g.examples.slice(0, EXAMPLES);
  }
  return { total, parsed, agree, nondeterministic, groups: sorted };
}

export function readPhrases(jsonl: string): Phrase[] {
  return jsonl.split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l) as Phrase);
}
