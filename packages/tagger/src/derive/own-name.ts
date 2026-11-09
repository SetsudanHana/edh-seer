import type { Ability } from "../schema.js";
import { SUBTYPES } from "./subtypes.js";

/** THE CARD'S OWN NAME IS NOT A CLASS (#1570). A card whose name holds a creature type read the name as that type wherever a subject was parsed from a clause head: "Phelddagrif gains trample" (a grant's recipient) was the class of Phelddagrifs, "Human Torch gains flying" every
 *  Human, "Return Phelddagrif to its owner's hand" and "When Eye of Nidhogg is put into a graveyard" a bounce and a recursion of a class, "creatures you control named Templar Knight" Knights, "time counters on The War Doctor" a count of Doctors. #1568 took the name out of a double /
 *  triple object (emits.ts); this is the same fact for every other subject path, as a pass over the finished abilities.
 *
 *  A subtype that is a WORD OF THE NAME stays only when the card's text says the type itself, which is read two ways: the word appears in the text once the card's own name (full and short forms) is taken out ("Other Goblin creatures" in Goblin Rabblemaster), or it stands in a
 *  CLASS POSITION in the text as printed -- after "a / an / other / another / each / all / every / target / no / a number" and up to three describing words, with no "named" between ("becomes a Coward", "becomes a green Lizard" in Lizard, Connors's Curse, "each other attacking Aurochs").
 *  Not touched: a `self` subject (Arden Angel's own death is an Angel's), a `ref` subject for the card's own subtypes ("When The Scarab God dies, return it"), a TOKEN subject (a Goblin Rabblemaster's Goblin tokens are Goblins), and a counter kind.
 *  CEILING: the class position test is a window of four words, not a parse: a name word that follows "each" or "a" within four words without being a class ("a Phelddagrif's ... ") is read as one, and a type said only by a quoted ability of a token is missed. */
/** Words that open a class mention. "the / that / this / your / their / its" are not among them: they stand before a name as freely as before a noun ("The Scarab God dies", "on the Eye"). */
const CLASS_CUES = new Set(["a", "an", "other", "another", "each", "all", "every", "target", "no", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "x", "any", "number"]);

const words = (s: string): string[] => s.split(/[^A-Za-z0-9'-]+/).filter((w) => w !== "");

/** The forms a card calls itself by, as `selfAsTilde` keeps them: each face's full name and the part before the comma. */
function selfForms(cardName: string): string[] {
  const out = new Set<string>();
  for (const face of cardName.split(" // ")) {
    out.add(face);
    out.add(face.split(",")[0]!);
  }
  return [...out].filter((f) => f !== "").sort((a, b) => b.length - a.length);
}

/** `text` with every occurrence of the card's own name forms taken out (case-insensitive, whole-word, a possessive kept as part of the name). Linear indexOf scans. */
function withoutOwnName(text: string, forms: readonly string[]): string {
  let out = text;
  for (const f of forms) {
    const lower = f.toLowerCase();
    let from = 0;
    for (;;) {
      const at = out.toLowerCase().indexOf(lower, from);
      if (at < 0) break;
      const before = at === 0 ? " " : out[at - 1]!;
      const after = out[at + lower.length] ?? " ";
      if (/[A-Za-z0-9_']/.test(before) || /[A-Za-z0-9_]/.test(after)) { from = at + lower.length; continue; }
      out = `${out.slice(0, at)} ${out.slice(at + lower.length + (out.slice(at + lower.length).startsWith("'s") ? 2 : 0))}`;
      from = at;
    }
  }
  return out;
}

const forms = (w: string): string[] => [w, `${w}s`, `${w}es`, w.endsWith("f") ? `${w.slice(0, -1)}ves` : w, w.endsWith("fe") ? `${w.slice(0, -2)}ves` : w, w.endsWith("y") ? `${w.slice(0, -1)}ies` : w];

/** Does `text` say the type `type` in a class position (see the header)? `tokens` are the text's whitespace-separated words with their punctuation, so a window stops at a comma, colon, semicolon, dash or full stop. */
function classPosition(tokens: readonly string[], type: string): boolean {
  const wanted = new Set(forms(type));
  const alnum = (ch: string): boolean => (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || (ch >= "0" && ch <= "9");
  const bare = (t: string): string => { let a = 0, b = t.length; while (a < b && !alnum(t[a]!)) a++; while (b > a && !alnum(t[b - 1]!)) b--; return t.slice(a, b).toLowerCase(); };
  for (let i = 0; i < tokens.length; i++) {
    if (!wanted.has(bare(tokens[i]!))) continue;
    for (let back = 1; back <= 4 && i - back >= 0; back++) {
      if (/[,:;.\u2014]$/.test(tokens[i - back]!)) break;
      const w = bare(tokens[i - back]!);
      if (w === "named") break;
      if (CLASS_CUES.has(w)) return true;
    }
  }
  return false;
}

/** The subtypes of the card's name that the card's text does not say as a type. Empty for the great majority of cards (a name with no subtype word). */
export function nameOnlyTypes(cardName: string | undefined, oracleText: string | undefined): ReadonlySet<string> {
  const out = new Set<string>();
  if (!cardName) return out;
  const nameWords = new Set(words(cardName).map((w) => w.toLowerCase()));
  const candidates = [...nameWords].flatMap((w) => [w, ...(w.endsWith("es") ? [w.slice(0, -2)] : []), ...(w.endsWith("s") ? [w.slice(0, -1)] : [])]).filter((w) => SUBTYPES.has(w));
  if (candidates.length === 0) return out;
  // The reminder text is read too: a keyword's reminder says a real type (Borg Queen's "It's a Borg artifact creature").
  const text = oracleText ?? "";
  const elsewhere = new Set(words(withoutOwnName(text, selfForms(cardName))).map((w) => w.toLowerCase()));
  const tokens = text.split(/\s+/).filter((w) => w !== "");
  for (const c of new Set(candidates)) {
    if (forms(c).some((f) => elsewhere.has(f)) || classPosition(tokens, c)) continue;
    out.add(c);
  }
  return out;
}

/** The card's printed types on a subject. Several are a CONJUNCTION (an artifact creature is both), which `allTypes` says; the bare list reads as "either" and would let a noncreature or nonartifact consumer hear an artifact creature. */
function setTypes(subject: Record<string, unknown>, types: readonly string[]): void {
  subject.type = types.length === 1 ? types[0] : [...types];
  if (types.length > 1) subject.allTypes = [...types];
}

/** What the strip needs to put back what the name stood for. */
export interface OwnNameFacts {
  /** The card's own creature/land/... subtypes, lowercased. */
  ownSubtypes: ReadonlySet<string>;
  /** The card's own printed card types, lowercased ("artifact", "creature"). */
  ownTypes: readonly string[];
  /** The card's name and its short forms, lowercased: what a `named` field holds when it names the card. */
  nameForms: ReadonlySet<string>;
  /** The text says "not named": a `named` field of this card is then the wrong polarity (Burning-Rune Demon's "cards not named Burning-Rune Demon") and no type is put back. */
  notNamed: boolean;
}

export function ownNameFacts(cardName: string | undefined, oracleText: string | undefined, ownSubtypes: readonly string[], ownTypes: readonly string[]): OwnNameFacts {
  return {
    ownSubtypes: new Set(ownSubtypes.map((t) => t.toLowerCase())),
    ownTypes: ownTypes.map((t) => t.toLowerCase()),
    nameForms: new Set(cardName === undefined ? [] : selfForms(cardName).map((f) => f.toLowerCase())),
    notNamed: (oracleText ?? "").toLowerCase().includes("not named"),
  };
}

/** The ability with the name-only subtypes taken out of every subject that is not the card itself or a token, and what the name stood for put back:
 *  a subject of cards NAMED this card ("each player returns all cards named Myr Servitor") keeps the card's own types, which the subtype carried (a creature entering is what Authority of the Consuls hears);
 *  a subject left with no class at all (Phelddagrif's "{G}: Phelddagrif gains trample", Eye of Nidhogg's "return it", The War Doctor's "counters on The War Doctor") was the card, so it is `self` (with the card's printed types in an emit). */
export function stripOwnNameSubtypes(a: Ability, drop: ReadonlySet<string>, facts: OwnNameFacts): Ability {
  if (drop.size === 0) return a;
  // `typed`: the subject sits in an EMIT, where the event's class is what a consumer reads. An effect subject made `self` stays untyped (Scion of the Ur-Dragon's "becomes a copy" with a creature type paired it with every legendary creature's legend rule, Dragon or not).
  const walk = (v: unknown, typed = false): unknown => {
    if (Array.isArray(v)) return v.map((x) => walk(x, typed));
    if (v === null || typeof v !== "object") return v;
    const o = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(o)) out[k] = walk(x, typed || k === "emits");
    if (o.subtype !== undefined && o.self !== true && o.token !== true) {
      // A subject that points back at the trigger's object ("When The Scarab God dies, return it", `ref`) is the card itself there: its own subtypes are real.
      const kept = [o.subtype as string | string[]].flat().filter((t) => !drop.has(t.toLowerCase()) || (o.ref !== undefined && facts.ownSubtypes.has(t.toLowerCase())));
      if (kept.length === 0) delete out.subtype;
      else out.subtype = kept.length === 1 ? kept[0] : kept;
      if (kept.length === 0 && out.type === undefined && out.anyOf === undefined && out.allTypes === undefined) {
        if (typeof o.named === "string" && facts.nameForms.has(o.named.toLowerCase())) {
          if (!facts.notNamed && facts.ownTypes.length > 0) setTypes(out, facts.ownTypes);
        } else if (o.named === undefined) {
          // ...with its printed types, as a self emit has them (#1518: The Stone Brain is the artifact it exiles): Graf Rats' exile of itself and Midnight Scavengers is a creature exile Syr Vondam and Soulherder hear.
          out.self = true;
          if (typed && facts.ownTypes.length > 0) setTypes(out, facts.ownTypes);
        }
      }
    }
    return out;
  };
  const stripped = walk(a) as Ability;
  return JSON.stringify(stripped) === JSON.stringify(a) ? a : stripped;
}
