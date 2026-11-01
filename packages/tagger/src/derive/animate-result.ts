/** WHAT AN ANIMATE'S OBJECT BECOMES (#1364): "Target land you control becomes a 3/3 Elemental creature", "All lands are 1/1 creatures", "enchanted creature ... is a blue Fish". Read off the
 *  PRINTED clause, so the stored answer and the grammar's reading state the same result whatever they put in the animate's object (the store writes a self animate's result into its subject
 *  and a target animate's not at all). It is `Effect.becomes`, never the subject: the subject is what is targeted or affected, and `spellTargeting` reads a `scope: target` creature
 *  subject as "aimed at a creature you control" (Brave the Wilds is aimed at a land).
 *
 *  NO REGEX HERE STARTS WITH AN UNANCHORED RUN OF WHITESPACE (CodeQL js/polynomial-redos): the text is normalised to single spaces once and every cut is a literal-needle `indexOf`. */
import { parse } from "../grammar/filter.js";
import type { SubjectFilter } from "../schema.js";

/** A clause longer than this is not an animate's sentence; refused so no scan is ever long. */
const MAX_CLAUSE = 4000;

/** `text` without everything from `open` to the next `close` (reminder text, quoted abilities). Linear. */
function without(text: string, open: string, close: string): string {
  let out = "";
  let from = 0;
  for (;;) {
    const a = text.indexOf(open, from);
    const b = a < 0 ? -1 : text.indexOf(close, a + 1);
    if (a < 0 || b < 0) return out + text.slice(from);
    out += `${text.slice(from, a)} `;
    from = b + 1;
  }
}
const strip = (t: string): string => without(without(without(without(t, "(", ")"), "\"", "\""), "“", "”"), "“", "“");

/** Where the result noun phrase ends: its keywords and riders, a clause break. Each starts with the single space the text is normalised to. */
const ENDS = [" with ", " that's", " that are ", " that is ", " until ", " for as long as ", " as long as ", " in addition", " it's ", " they're ", " has ", " have ", " gain ", " gains ", " lose ", " loses ", " unless ", " if ", ",", ".", ";", ":", "—"];
const COLOURS = new Set(["white", "blue", "black", "red", "green", "colorless"]);
/** An alternative the printed text leaves to a choice: no one result. */
const CHOICE = /\b(?:your choice of|of your choice|the chosen|a copy of|copies of)\b/i;
const CONDITION_WORDS = ["as long as ", "if ", "when ", "whenever ", "while ", "during "];

function earliest(text: string, needles: readonly string[]): number {
  let at = -1;
  for (const n of needles) { const i = text.indexOf(n); if (i >= 0 && (at < 0 || i < at)) at = i; }
  return at;
}
const lastWord = (s: string): string => s.slice(s.lastIndexOf(" ") + 1);
const firstWord = (s: string): string => { const i = s.indexOf(" "); return i < 0 ? s : s.slice(0, i); };

/** One sentence without a condition ahead of the result ("As long as enchanted permanent is a Vehicle, it's a creature ...", "During your turn, Gideon Blackblade is a 4/4 ...") or trailing it
 *  ("..., if it's a creature card, put it onto the battlefield"). */
function unconditioned(sentence: string): string {
  let s = sentence.trim();
  // An ability word ("Celebration — As long as ...", "Bear Form — During your turn, ...") heads the sentence, not the result.
  const dash = s.indexOf(" — ");
  if (dash >= 0 && dash <= 40 && !/[.,]/.test(s.slice(0, dash))) s = s.slice(dash + 3);
  // A lead may stack ("When an opponent casts a spell, if this permanent is an enchantment, it becomes ..."): drop each up to its comma.
  for (let low = s.toLowerCase(); CONDITION_WORDS.some((w) => low.startsWith(w)); low = s.toLowerCase()) { const c = s.indexOf(", "); if (c < 0) return ""; s = s.slice(c + 2); }
  const low = s.toLowerCase();
  const at = Math.min(...[" if ", " unless "].map((n) => { const j = low.indexOf(n); return j < 0 ? Infinity : j; }));
  if (at === Infinity) return s;
  const rest = s.slice(at + 1);
  const stop = earliest(rest, [",", ";", " and "]);
  return s.slice(0, at) + (stop < 0 ? "" : rest.slice(stop));
}

const REFUSE = Symbol("refuse");
type Read = SubjectFilter | typeof REFUSE | undefined;

/** The noun phrase after a verb, up to where it ends, and the text that follows it. */
function phraseAfter(text: string, at: number): { phrase: string; longer: string; tail: string } {
  let rest = text.slice(at);
  for (const a of ["also ", "each "]) if (rest.startsWith(a)) rest = rest.slice(a.length);
  for (const a of ["an ", "a ", "the "]) if (rest.startsWith(a)) { rest = rest.slice(a.length); break; }
  // " and " ends the phrase, except between two colour words ("a 4/4 red and green Dragon artifact creature").
  const end = earliest(rest, ENDS);
  // One character past the end, so a " and " that is the last thing before it ("an artifact creature and gains haste") is seen.
  const stop = end < 0 ? rest : rest.slice(0, end + 1);
  let cut = end < 0 ? rest.length : end;
  for (let from = 0; ;) {
    const i = stop.indexOf(" and ", from);
    if (i < 0) break;
    if (COLOURS.has(lastWord(stop.slice(0, i))) && COLOURS.has(firstWord(stop.slice(i + 5)))) { from = i + 5; continue; }
    cut = i; break;
  }
  const phrase = rest.slice(0, cut).trim();
  // The same, but a LIST goes on: "a Mountain, Forest, and Plains" (Lush Growth).
  const listEnd = earliest(rest, ENDS.filter((n) => n !== ","));
  return { phrase, longer: (listEnd < 0 ? rest : rest.slice(0, listEnd)).trim(), tail: rest.slice(cut) };
}

function resultOf(text: string, at: number): Read {
  const { phrase, longer, tail } = phraseAfter(text, at);
  if (phrase === "" || phrase.length > 60) return undefined;
  // "a Plains or an Island" (Tundra Kavu): one of them, not both.
  if (` ${longer} `.includes(" or ")) return REFUSE;
  // A "named" whose name runs on past a comma ("named Mileva, the Stalwart") is cut short by it.
  if (phrase.includes(" named ") && tail.startsWith(",")) return REFUSE;
  const hasComma = longer.includes(",") && longer.length <= 60;
  const read = ((hasComma ? parse(longer) : null) ?? parse(phrase)) as SubjectFilter | null;
  if (!read) return undefined;
  // A noun phrase joined to another by "and" ("Saproling creatures and Forest lands", Life and Limb) is two results this does not split.
  if (tail.startsWith(" and ")) {
    const next = phraseAfter(tail, 5).phrase;
    const more = next === "" ? null : (parse(next) as SubjectFilter | null);
    if (more && (more.type !== undefined || more.subtype !== undefined)) return REFUSE;
  }
  // A result with P/T or colours and no type is a guess at a half: none.
  if (read.type === undefined && read.subtype === undefined) return undefined;
  const out: SubjectFilter = { ...read };
  // A plural ("1/1 Elemental creatures") is still one result, not a class of the deck.
  delete out.scope;
  // "a Rhino with base power and toughness 4/4", "a blue Fish with base power and toughness 0/1": the numbers are in the tail the noun phrase stopped before.
  const base = /\bbase power and toughness (\d+)\/(\d+)\b/i.exec(text);
  if (out.stats === undefined && base) out.stats = [{ metric: "power", op: "eq", value: Number(base[1]) }, { metric: "toughness", op: "eq", value: Number(base[2]) }];
  return out;
}

/** The end of every whole-word `verb` (each ends in a space) in `text`. */
function verbEnds(text: string, verbs: readonly string[]): number[] {
  const out: number[] = [];
  for (const v of verbs) {
    for (let i = text.indexOf(v); i >= 0; i = text.indexOf(v, i + 1)) {
      if (i > 0 && /[\p{L}\p{N}_]/u.test(text[i - 1]!)) continue;
      out.push(i + v.length);
    }
  }
  return out.sort((x, y) => x - y);
}

/** The result an animate clause states, or undefined when it states none that reads (a colour alone, a creature type of your choice, a copy, an "or", two different results). A "becomes" is read
 *  before an "is" / "are" ("if it isn't a creature or Vehicle, it becomes a 0/0 Construct artifact creature"), and the second is only a static's wording ("All lands are 1/1 creatures"). */
export function animateResult(clauseText: string): SubjectFilter | undefined {
  if (clauseText.length > MAX_CLAUSE) return undefined;
  const flat = strip(clauseText).replace(/[^\S\n]+/g, " ").toLowerCase();
  const text = flat.split("\n").flatMap((line) => line.split(". ").map(unconditioned)).join(". ") + " ";
  if (CHOICE.test(text)) return undefined;
  for (const verbs of [["becomes ", "become "], ["is ", "are ", "it’s ", "it's ", "they’re ", "they're "]]) {
    const all: SubjectFilter[] = [];
    for (const at of verbEnds(text, verbs)) {
      const r = resultOf(text, at);
      if (r === REFUSE) return undefined;
      if (r) all.push(r);
    }
    if (all.length === 0) continue;
    // Two animates in a clause with different results (a branch, two targets) are not one result.
    return all.every((r) => JSON.stringify(r) === JSON.stringify(all[0])) ? all[0] : undefined;
  }
  return undefined;
}
