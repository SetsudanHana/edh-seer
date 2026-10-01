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
import { counterKindOf } from "@edh-seer/tagger/subject";
import { KEYWORD_ABILITIES } from "@edh-seer/tagger/subtypes";

export interface Phrase { kind: "subject" | "object"; phrase: string; cards: number }
export type Parser = (text: string) => SubjectFilter | null;
export interface Example { kind: Phrase["kind"]; phrase: string; cards: number; baseline: SubjectFilter; candidate: SubjectFilter }
export interface Group { fields: string[]; distinct: number; cards: number; examples: Example[] }
export interface Tally { distinct: number; cards: number }
export interface PhraseDiff {
  total: Tally;
  /** Total and parsed per `domainOf` bucket: S1 over the filter language is the `filter` row. */
  byDomain: Record<string, { total: Tally; parsed: Tally }>;
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
  const byDomain: PhraseDiff["byDomain"] = {};
  const total = { distinct: 0, cards: 0 }, parsed = { distinct: 0, cards: 0 }, agree = { distinct: 0, cards: 0 };
  const nondeterministic: string[] = [];
  const groups = new Map<string, Group>();
  for (const p of phrases) {
    total.distinct++; total.cards += p.cards;
    const cand = candidate(p.phrase);
    if (JSON.stringify(cand) !== JSON.stringify(candidate(p.phrase))) nondeterministic.push(p.phrase);
    const dom = byDomain[domainOf(p.phrase)] ??= { total: { distinct: 0, cards: 0 }, parsed: { distinct: 0, cards: 0 } };
    dom.total.distinct++; dom.total.cards += p.cards;
    if (cand === null) continue;
    dom.parsed.distinct++; dom.parsed.cards += p.cards;
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
  return { total, byDomain, parsed, agree, nondeterministic, groups: sorted };
}

export function readPhrases(jsonl: string): Phrase[] {
  return jsonl.split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l) as Phrase);
}

/** WHICH LANGUAGE A PHRASE IS IN, so coverage of the FILTER language is measured over filter
 *  phrases. The census holds every trigger subject and action object, and most of it is not a noun
 *  phrase for a filter at all: "Flying" (a keyword granted), "+1/+1" (a counter kind), "{C}" (mana),
 *  "this creature" (a reference, task 4), "chapter II" (a time, task 5), "be blocked" (a verb).
 *
 *  Decided HERE, by a few explicit rules on the first words, and never by the parser under test: a
 *  grammar that marked what it cannot read as out of its domain would grade itself. Everything no
 *  rule claims is `filter`, so a rule too narrow LOWERS the measured coverage rather than raising it. */
const KEYWORD_LISTS = KEYWORD_ABILITIES.map((k) => k.split(" "));
const REFERENCE_WORDS = new Set(["this", "that", "those", "these", "it", "its", "them", "they", "itself", "enchanted", "equipped", "the", "he", "she", "him", "her"]);
const VERB_WORDS = new Set(["be", "block", "attack", "untap", "not", "pay", "sacrifice", "exert", "discard", "exile", "draw", "deal", "deals", "tap", "gain", "lose", "return", "put", "cast", "create", "destroy", "transform", "search", "reveal", "look", "mill", "scry", "copy", "choose", "do", "remove", "counter", "become", "becomes", "play", "attacks", "blocks", "dies", "enters", "leaves"]);
const TIME = /\b(?:chapter|turn|upkeep|end step|main phase|combat|draw step|untap step|day|night|beginning)\b|^(?:i|ii|iii|iv|v|vi)(?:,|$)/;
const ZONE = /^(?:(?:your|their|its owner's|target player's|target opponent's|an opponent's|each opponent's|all opponents'|each player's|that player's|a player's|all|each)\s+)?(?:library|libraries|hand|hands|graveyard|graveyards|life total)\b/;
/** A CLAUSE, not a noun phrase: a finite verb the subject does ("target creature GAINS trample",
 *  "you PAY {1}", "you HAVE no maximum hand size"). Task 6's actions. A verb inside a relative clause
 *  ("a creature THAT HAS flying") is still a noun phrase, so a relative pronoun before the verb keeps
 *  the phrase in `filter`. "cast"/"casts" are absent on purpose: "spells you cast" is a filter. */
const CLAUSE_VERB = /\b(?:gains?|gets?|loses?|can't|can|becomes?|has|have|is|are|deals?|may|would|pays?|attacks|blocks|enters|dies|wins?|draws?|puts?|untaps?)\b/;
const RELATIVE = /\b(?:that|that's|who|which|whose)\b/;
/** A REFERENCE inside a longer phrase: what was exiled, revealed or chosen earlier, "those", "that
 *  many". Task 4 and #900's population, resolved by `derive/references.ts`, not by a filter. */
const INNER_REFERENCE = /\b(?:this way|exiled with|from among|of them|of those|those|they (?:control|own|don't)|that (?:card|creature|player|spell|permanent|ability|many|much|token|land|artifact|opponent))\b/;

export function domainOf(phrase: string): string {
  // "~" is the card's own name: a self-reference, except after "named", where it is a filter on a
  // name ("a card named ~", "any number of cards named ~").
  if (phrase.replace(/\bnamed ~/g, "").includes("~")) return "reference";
  const text = phrase.toLowerCase().replace(/’/g, "'").trim();
  if (text.startsWith("(")) return "reminder";
  const w = text.split(/[\s,]+/).filter((x) => x !== "");
  if (w.length === 0) return "empty";
  if (REFERENCE_WORDS.has(w[0]!) || (w[0] === "one" && w[1] === "of")) return "reference";
  // "Enchant creature you control" names a CLASS after the keyword: a filter phrase, and one the
  // grammar does not read yet. Counting it as a keyword would hide 1,239 card-occurrences of misses
  // (review). Every other keyword line is a grant or a cost.
  if (w[0] !== "enchant" && KEYWORD_LISTS.some((ws) => ws.every((x, j) => w[j] === x))) return "keyword";
  if (/^[+-]\d/.test(w[0]!) || counterKindOf(text) || (/\bcounters?$/.test(text) && counterKindOf(text.replace(/^(?:a|an|one or more|one|two|three|x|\d+|all)\s+/, "")))) return "counter";
  if (w.length === 1 && /^(?:\d+|x)$/.test(w[0]!)) return "number";
  if (w[0]!.startsWith("{") || /\bmana\b(?! value| cost)/.test(text)) return "mana";
  if (ZONE.test(text)) return "zone";
  if (!text.includes(" named ") && TIME.test(text)) return "time";
  if (VERB_WORDS.has(w[0]!)) return "verb";
  if (INNER_REFERENCE.test(text)) return "reference";
  // Only the HEAD is read: a verb inside a granted ability's quotes ('a Rat token with "This token
  // can't block."') or a count ("a card for each counter you have") does not make a clause.
  const head = text.split(/["“]|\bfor each\b|\bwhere\b|\bequal to\b|\bthe number of\b/)[0]!;
  const verb = CLAUSE_VERB.exec(head);
  if (verb && !RELATIVE.test(head.slice(0, verb.index))) return "clause";
  return "filter";
}
