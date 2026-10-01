/** WHAT STOPS THE ACTION GRAMMAR (#896): for each stored action the grammar does not read, which
 *  construction is the blocker. Pure; `action-blockers.ts` is the CLI.
 *
 *  Counting the sentences that CONTAIN a construction overstates what fixing it buys -- a sentence
 *  with "this way" usually fails on something else as well (measured 2026-10-02: fixing "this way"
 *  moved 95 of the 551 uses that contained it). So this asks the question directly, black-box: each
 *  construction comes with a NEUTRALISATION, a rewrite that removes it and leaves a sentence the
 *  grammar already knows how to read. An unread action is attributed to a construction when that
 *  rewrite ALONE makes the action read. When no single rewrite does, all the applicable rewrites are
 *  tried together (`combination`); when even that fails, the action is `unknown` -- a construction
 *  not in the catalogue yet, which the examples show.
 *
 *  CEILING: the rewrite proves the grammar would READ the action, not that it would read it RIGHT.
 *  It ranks work; it does not license a switch. Each fix is still measured on the decks. */
import { KEYWORD_ABILITIES, SUBTYPES } from "@edh-seer/tagger/subtypes";
import { alignByFamily, type ActionParser, type ActionRow } from "./action-diff-core.js";

/** The grammar's own report of the phrases it did not read (`unreadPhrases` in grammar/action.ts). */
export type UnreadOf = (effect: string, type: string | null, cost?: string) => string[];

export interface Construction { name: string; test: RegExp; rewrite: (text: string) => string }

const cut = (re: RegExp, by = "") => (t: string) => t.replace(re, by).replace(/\s{2,}/g, " ").replace(/ ([,.])/g, "$1");

/** The catalogue, roughly from the general (a clause wrapper) to the particular (a noun phrase). */
export const CONSTRUCTIONS: Construction[] = [
  { name: "replacement (if ... would ..., ... instead)", test: /\bwould\b[^.]*\binstead\b/i,
    rewrite: (t) => t.replace(/\bif [^,.]*\bwould\b[^,.]*, /gi, "").replace(/ instead(?= of [^.]*)? ?(?:of [^.]*)?(?=\.|$)/gi, "") },
  { name: "leading condition (if/when/as long as/during ...,)", test: /(?:^|\. )(?:if|when|whenever|as long as|during|unless|otherwise|while|at the beginning of [^,]+|until [^,]+),? /i,
    rewrite: cut(/(?:^|(?<=\. ))(?:if|when|whenever|as long as|during|unless|while)\b[^,.]*, |(?:^|(?<=\. ))(?:otherwise|then), /gi) },
  { name: "trailing condition (if/unless/as long as ...)", test: / (?:if|unless|as long as|only if) [^,.]+(?=\.|$)/i,
    rewrite: cut(/ (?:if|unless|as long as|only if) [^,.]+(?=\.|$)/gi) },
  { name: "duration (until end of turn, this turn, ...)", test: / (?:until (?:end of turn|your next turn|end of combat|the end of your next turn)|this turn|for as long as [^,.]+)/i,
    rewrite: cut(/ (?:until (?:end of turn|your next turn|end of combat|the end of your next turn)|this turn|for as long as [^,.]+)/gi) },
  { name: "for each ...", test: / for each [^,.]+/i, rewrite: cut(/ for each [^,.]+/gi) },
  { name: "where X is ...", test: /, where X is [^.]+/i, rewrite: (t) => cut(/, where X is [^.]+/gi)(t).replace(/\bX\b/g, "two") },
  { name: "that much / that many", test: /\bthat (?:much|many)\b/i, rewrite: (t) => t.replace(/\bthat much\b/gi, "2").replace(/\bthat many\b/gi, "two") },
  { name: "back-referenced controller (that player controls)", test: /\b(?:that player|they|that opponent|its controller) controls?\b/i,
    rewrite: (t) => t.replace(/\b(?:that player|that opponent|its controller) controls\b/gi, "an opponent controls").replace(/\bthey control\b/gi, "an opponent controls") },
  { name: "... this way", test: /\bthis way\b/i, rewrite: cut(/ \w+ this way\b| this way\b/gi) },
  { name: "the exiled / revealed / chosen card", test: /\bthe (?:exiled|revealed|milled|discarded|sacrificed|chosen) (?:cards?|creatures?|permanents?)\b/i,
    rewrite: (t) => t.replace(/\bthe (?:exiled|revealed|milled|discarded|sacrificed|chosen) (?:cards?|creatures?|permanents?)\b/gi, "it") },
  { name: "the chosen <quality> / of your choice", test: /\bthe chosen (?:color|type|creature type|player|number|name)\b|\bof (?:your|their) choice\b/i,
    rewrite: (t) => cut(/ of (?:your|their) choice\b/gi)(t).replace(/\bthe chosen (?:color|type|creature type)\b/gi, "red").replace(/\bthe chosen player\b/gi, "target opponent") },
  { name: "your choice of A, B, or C", test: /\byour choice of\b/i, rewrite: (t) => t.replace(/\byour choice of (?:an? )?([^,.]+?)(?:,| or)[^.]*?(?=\.|$| on | to )/gi, "$1") },
  { name: "from among them / those", test: / from among (?:them|those [a-z]+|the [a-z ]+)\b/i, rewrite: cut(/ from among (?:them|those [a-z]+|the [a-z ]+)\b/gi) },
  { name: "another / each other", test: /\banother\b|\beach other\b/i, rewrite: (t) => cut(/ each other\b/gi)(t).replace(/\banother\b/gi, "a") },
  { name: "the first / second / next time", test: /\bthe (?:first|second|third|next) (?:time )?/i, rewrite: (t) => t.replace(/\bthe (?:first|second|third|next) (?:time )?/gi, "a ") },
  { name: "only during / only as / only once", test: /\bonly (?:during|as|once|any time)\b[^.]*/i, rewrite: cut(/ ?\b(?:activate |cast this spell )?only (?:during|as|once|any time)\b[^.]*/gi) },
  { name: "in addition to its other types", test: / in addition to (?:its|their) other (?:creature )?types/i, rewrite: cut(/ in addition to (?:its|their) other (?:creature )?types/gi) },
  { name: "base power and toughness", test: /\bbase power and toughness \S+/i, rewrite: cut(/,? (?:with |and has |has )?base power and toughness \S+/gi) },
  { name: "if able / must", test: /\bif able\b|\bmust\b/i, rewrite: (t) => t.replace(/ must be blocked if able/gi, " can't be blocked").replace(/ if able\b/gi, "") },
  { name: "as though ...", test: / as though [^,.]+/i, rewrite: cut(/ as though [^,.]+/gi) },
  { name: "quoted ability", test: /"[^"]+"/, rewrite: (t) => t.replace(/ with "[^"]+"/g, "").replace(/"[^"]+"/g, "flying") },
  { name: "with mana value / power N or less", test: / with (?:mana value|power|toughness|total power) [^,.]*?\b(?:or (?:less|greater|more))\b/i,
    rewrite: cut(/ with (?:mana value|power|toughness|total power) [^,.]*?\b(?:or (?:less|greater|more))\b/gi) },
  { name: "then do the same / repeat this process", test: /\b(?:do the same|repeats? this process)\b/i, rewrite: cut(/,? then (?:do the same|repeats? this process)[^.]*|(?:^|(?<=\. ))(?:do the same|repeat this process)[^.]*\.?/gi) },
  { name: "rather than pay", test: / rather than pay(?:ing)? [^,.]+/i, rewrite: cut(/ rather than pay(?:ing)? [^,.]+/gi) },
  { name: "or (alternative actions)", test: / or (?:pay|discard|sacrifice|exile|return|put|draw|lose)\b/i, rewrite: cut(/ or (?:pay|discard|sacrifice|exile|return|put|draw|lose)\b[^,.]*/gi) },
];

/** The words a verb is printed with. An action whose clause prints none of them cannot be read by
 *  any grammar: the store filed it under the wrong clause, or wrote an action the text does not have. */
export const VERB_WORDS: Record<string, RegExp> = {
  create: /\bcreates?\b/i, "add-counter": /\bcounters?\b|\{E\}/i, "remove-counter": /\bremoves?\b/i, proliferate: /\bproliferate\b/i,
  "deal-damage": /\bdeals?\b|\bdamage\b/i, "gain-life": /\bgains?\b[^.]*\blife/i, "lose-life": /\b(?:loses?|pays?)\b[^.]*\blife/i, "set-life": /\blife total\b/i,
  draw: /\bdraws?\b/i, discard: /\bdiscards?\b/i, mill: /\bmills?\b/i, search: /\bsearch(?:es)?\b/i, reveal: /\breveals?\b/i, scry: /\bscry\b/i, surveil: /\bsurveils?\b/i,
  destroy: /\bdestroys?\b/i, exile: /\bexiles?\b/i, sacrifice: /\bsacrific/i, return: /\breturns?\b/i, put: /\bputs?\b/i, shuffle: /\bshuffles?\b/i,
  "modify-pt": /[+-](?:\d+|x)\/[+-](?:\d+|x)|\bpower\b|\btoughness\b/i, "grant-ability": /\b(?:gains?|has|have)\b/i, "add-mana": /\badds?\b/i,
  tap: /\btaps?\b|\btapped\b/i, untap: /\buntaps?\b/i, cant: /can't|cannot|doesn't|don't|if able|\bonly\b|\bskip/i, "counter-spell": /\bcounter\b/i,
  "gain-control": /\bcontrol\b/i, fight: /\bfights?\b/i, copy: /\bcop(?:y|ies)\b/i, attach: /\battach/i, transform: /\btransform/i, goad: /\bgoad/i,
  cast: /\bcast\b/i, play: /\bplay\b/i, prevent: /\bprevent/i, "cost-modify": /\bcosts?\b/i, animate: /\bbecomes?\b|\bis an?\b|\bare\b/i, double: /\bdouble\b|\btwice\b/i,
};

export type Attribution = { kind: "single"; names: string[] } | { kind: "combination"; names: string[] } | { kind: "unknown" };
/** Why an action is unread, before any construction is tried. */
export type Cause = "no-grammar" | "not-in-text" | "count" | "phrase";
export interface BlockerRow { row: ActionRow; index: number; attribution: Attribution }
export interface Blockers {
  total: { actions: number; uses: number };
  /** no-grammar: the parser never produces the verb. not-in-text: the clause prints no word of it
   *  (a store error). count: the grammar reads the verb in this clause, but fewer times than the
   *  store holds it (the store split one phrase, or invented one). phrase: the phrase is unread --
   *  the only cause the construction catalogue speaks to. */
  causes: Record<Cause, number>;
  /** Uses each construction unblocks ALONE. A use can count under several (each alone suffices). */
  single: Record<string, number>;
  /** Uses unblocked by the first single construction in catalogue order: the shares add up. */
  first: Record<string, number>;
  combination: number;
  unknown: number;
  /** The unread PHRASE of each phrase-caused action, normalised (numbers, mana, types, keywords,
   *  colours and quotes as placeholders): one construction per row, however many cards print it. */
  shapes: { shape: string; uses: number; texts: number; examples: string[] }[];
  /** The same, coarser: the verb and the first words of the shape. */
  heads: { head: string; uses: number; shapes: number }[];
  examples: Record<string, ActionRow[]>;
}

const EXAMPLES = 12;

/** The stored action indexes the candidate reads (aligned by family, as the switch aligns). */
function readIndexes(row: ActionRow, candidate: ActionParser, effect = row.effect): Set<number> {
  const read = candidate(effect, row.type, row.cost) ?? [];
  return new Set(alignByFamily(row.actions.map((a) => a.verb), read.map((r) => r.verb)).map(([i]) => i));
}

export function attribute(row: ActionRow, index: number, candidate: ActionParser, catalogue = CONSTRUCTIONS): Attribution {
  const applicable = catalogue.filter((c) => c.test.test(row.effect));
  const single = applicable.filter((c) => readIndexes(row, candidate, c.rewrite(row.effect)).has(index)).map((c) => c.name);
  if (single.length) return { kind: "single", names: single };
  if (applicable.length > 1) {
    const all = applicable.reduce((t, c) => c.rewrite(t), row.effect);
    if (readIndexes(row, candidate, all).has(index)) return { kind: "combination", names: applicable.map((c) => c.name) };
  }
  return { kind: "unknown" };
}

/** Over the census: every stored action the candidate leaves unread, except the store's catch-all
 *  `other` (free text, no action to read) and rows with no printed text. */
export function blockers(rows: ActionRow[], candidate: ActionParser, unreadOf?: UnreadOf, catalogue = CONSTRUCTIONS): Blockers {
  const out: Blockers = { total: { actions: 0, uses: 0 }, causes: { "no-grammar": 0, "not-in-text": 0, count: 0, phrase: 0 }, single: {}, first: {}, combination: 0, unknown: 0, examples: {}, shapes: [], heads: [] };
  const shapes = new Map<string, { uses: number; texts: Set<string>; examples: string[] }>();
  const produced = new Set<string>();
  for (const row of rows) for (const r of candidate(row.effect, row.type, row.cost) ?? []) produced.add(r.verb);
  const example = (k: string, row: ActionRow) => { const e = (out.examples[k] ??= []); if (e.length < EXAMPLES * 4) e.push(row); };
  for (const row of rows) {
    if (row.effect.trim() === "") continue;
    const got = readIndexes(row, candidate);
    const readVerbs = (candidate(row.effect, row.type, row.cost) ?? []).map((r) => r.verb);
    row.actions.forEach((a, i) => {
      if (got.has(i) || a.verb === "other") return;
      out.total.actions++; out.total.uses += row.cards;
      const words = VERB_WORDS[a.verb];
      const cause: Cause = !produced.has(a.verb) ? "no-grammar"
        : words && !words.test(`${row.cost ?? ""} ${row.effect}`) ? "not-in-text"
        : readVerbs.includes(a.verb) ? "count" : "phrase";
      out.causes[cause] += row.cards;
      if (cause !== "phrase") { example(cause, row); return; }
      if (unreadOf) {
        // The unread phrase that prints this verb, else the first unread phrase.
        const phrases = unreadOf(row.effect, row.type, row.cost);
        const phrase = phrases.find((p) => words?.test(p)) ?? phrases[0];
        if (phrase !== undefined) {
          const k = `${a.verb} :: ${shapeOf(phrase)}`;
          const e = shapes.get(k) ?? shapes.set(k, { uses: 0, texts: new Set(), examples: [] }).get(k)!;
          e.uses += row.cards; e.texts.add(phrase);
          if (e.examples.length < 3 && !e.examples.includes(phrase)) e.examples.push(phrase);
        }
      }
      const at = attribute(row, i, candidate, catalogue);
      if (at.kind === "single") {
        for (const n of at.names) out.single[n] = (out.single[n] ?? 0) + row.cards;
        out.first[at.names[0]!] = (out.first[at.names[0]!] ?? 0) + row.cards;
        example(at.names[0]!, row);
      } else if (at.kind === "combination") { out.combination += row.cards; example("combination", row); }
      else { out.unknown += row.cards; example("unknown", row); }
    });
  }
  out.shapes = [...shapes].map(([shape, e]) => ({ shape, uses: e.uses, texts: e.texts.size, examples: e.examples })).sort((a, b) => b.uses - a.uses || a.shape.localeCompare(b.shape));
  const heads = new Map<string, { uses: number; shapes: number }>();
  for (const sh of out.shapes) {
    const head = sh.shape.split(" ").slice(0, 6).join(" ");
    const h = heads.get(head) ?? heads.set(head, { uses: 0, shapes: 0 }).get(head)!;
    h.uses += sh.uses; h.shapes++;
  }
  out.heads = [...heads].map(([head, h]) => ({ head, ...h })).sort((a, b) => b.uses - a.uses || a.head.localeCompare(b.head));
  // The examples by uses, most first, so the list shows what moves the number.
  for (const k of Object.keys(out.examples)) out.examples[k] = out.examples[k]!.sort((a, b) => b.cards - a.cards || a.effect.localeCompare(b.effect)).slice(0, EXAMPLES);
  return out;
}

const escape = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const TYPE_RE = new RegExp(`\\b(?:${[...SUBTYPES].filter((t) => t.length > 2).sort((a, b) => b.length - a.length).map(escape).join("|")})s?\\b`, "gi");
const KW_RE = new RegExp(`\\b(?:${[...KEYWORD_ABILITIES].map((k) => k.toLowerCase()).sort((a, b) => b.length - a.length).map(escape).join("|")})\\b`, "gi");

/** A phrase as a construction: what varies between cards replaced by placeholders. */
export function shapeOf(phrase: string): string {
  return phrase.toLowerCase()
    .replace(/"[^"]*"/g, "QUOTE").replace(/(?:\{[^}]+\})+/g, "{M}").replace(/[+-]?\b(?:\d+|x)\/[+-]?(?:\d+|x)\b/g, "P/T")
    .replace(/\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|x)\b/g, "N")
    .replace(/\b(?:white|blue|black|red|green|colorless|multicolored|monocolored)\b/g, "COLOR")
    .replace(KW_RE, "KW").replace(TYPE_RE, "TYPE")
    .replace(/\b(?:creature|artifact|enchantment|land|planeswalker|instant|sorcery|battle|permanent|spell|card|token)s?\b/g, "CLASS")
    .replace(/\bKW(?:,? (?:and |or )?KW)+/g, "KW").replace(/\b(?:CLASS|TYPE|COLOR)(?:,? (?:and |or |and\/or )?(?:CLASS|TYPE|COLOR))+/g, "CLASS")
    .replace(/\s+/g, " ").trim();
}
