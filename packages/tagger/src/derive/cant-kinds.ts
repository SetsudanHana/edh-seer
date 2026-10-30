/** THE THREE `cant` LINES #1401 part 5 STOPPED READING AS ABILITY-LOSS, EACH WITH A KIND OF ITS OWN (#1423, owner ruling 2026-10-30): `targeting-ban`, `trigger-suppression`, `untap-denial`.
 *  Pure readers over a stored action's object and the printed clause; `effect-kind.ts` asks "is it one" and `derive.ts` copies the fields onto the ability. Every reader is a WHITELIST: a word it does not
 *  know refuses the whole line (a missing answer beats a silent wrong one), and none of them backtracks on card text (words are split on a single space, never matched with a leading `.*`). */
import type { SubjectFilter } from "../schema.js";

/** The words of a phrase, lowercased, commas dropped (a list is read by its words). Empty for a blank phrase. */
function words(text: string): string[] {
  return text.toLowerCase().replace(/[,.]/g, " ").split(" ").filter((w) => w !== "");
}

/** The sentence of `text` holding index `at`: from the previous ". " to the next one. */
function sentenceAround(text: string, at: number): { head: string; tail: string } {
  const from = text.lastIndexOf(". ", at);
  const start = from < 0 ? 0 : from + 2;
  const to = text.indexOf(". ", at);
  return { head: text.slice(start, at), tail: text.slice(at, to < 0 ? text.length : to + 1) };
}

/** The `n`-th (clamped) start index of a global regex's match in `text`, or -1 when there is none. */
function nthMatch(text: string, re: RegExp, n: number): RegExpExecArray | undefined {
  const hits = [...text.matchAll(re)];
  return hits[Math.min(n, hits.length - 1)];
}

const COLOUR_LETTER: Readonly<Record<string, string>> = { white: "W", blue: "U", black: "B", red: "R", green: "G" };
const SOURCE_TYPES: ReadonlySet<string> = new Set(["artifact", "creature", "enchantment", "land", "planeswalker", "instant", "sorcery", "battle"]);

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// 1. TARGETING-BAN
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

/** WHAT CAN'T TARGET IT, AND WHOSE (#1423). `by`: a spell, an ability, or both ("spells or abilities"); "activated abilities" (Peace Talks) is `activated-ability`. `source` is the filter on the
 *  spell or ability's SOURCE: `control` `opp` for "your opponents control", else `any`; `colors` / `notColors` (WUBRG letters) for "blue spells or abilities from blue sources" and "nongreen ...";
 *  `type` for "abilities from artifact sources"; `subtype` for "Aura spells". Hexproof (CR 702.11) is exactly `{by: [spell, ability], source: {control: opp}}`, shroud (CR 702.18) the same with
 *  `control: any`. */
export interface TargetingBan {
  by: ("spell" | "ability" | "activated-ability")[];
  source: SubjectFilter;
}

const TARGET_OF = /\bbe the targets? of\b/i;
const CANT_SUFFIXES = ["can't", "can’t", "cannot"];
/** Words a targeting-ban tail may hold. Anything else ("that", "only", "unless", "if", "named", "with", a number) is a narrowing this kind cannot hold, and refuses the line. */
const TAIL_GLUE: ReadonlySet<string> = new Set(["or", "and", "of", "from", "the"]);

/** The spell/ability words of a tail, adjective by adjective. Returns undefined for any word it does not know. */
function parseTargetingTail(tail: string): TargetingBan | undefined {
  const ws = words(tail);
  let spell: string[] | undefined, ability: string[] | undefined, activated = false;
  /** The adjectives read since the last noun (before "spells"), or since "from" (before "sources", for an ability). */
  let pending: string[] = [];
  let control = 0, lastWasControl = false;
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i]!;
    const wasControl: boolean = lastWasControl;
    lastWasControl = false;
    if (w === "spells" || w === "spell") { if (spell) return undefined; spell = pending; pending = []; continue; }
    if (w === "abilities" || w === "ability") {
      if (ability) return undefined;
      activated = ws[i - 1] === "activated";
      ability = []; // the qualifier of an ability comes after it: "abilities from artifact sources"
      continue;
    }
    if (w === "your" && ws[i + 1] === "opponents" && ws[i + 2] === "control") { control++; i += 2; lastWasControl = true; continue; }
    if (w === "activated") continue;
    if (w === "sources" || w === "source") { if (!ability || pending.length === 0) return undefined; ability = pending; pending = []; continue; }
    if (w === "this") { if (ws[i + 1] !== "turn") return undefined; i++; lastWasControl = wasControl; continue; }
    if (TAIL_GLUE.has(w)) continue;
    if (w in COLOUR_LETTER || (w.startsWith("non") && w.slice(3) in COLOUR_LETTER) || SOURCE_TYPES.has(w) || w === "aura") { pending.push(w); continue; }
    return undefined;
  }
  if (pending.length > 0 || (!spell && !ability)) return undefined;
  const nouns = (spell ? 1 : 0) + (ability ? 1 : 0);
  // WHOSE: "your opponents control" once, at the very end (it covers every noun before it), or once per noun (Thrun).
  if (control > 0 && !(control === nouns || (control === 1 && lastWasControl))) return undefined;
  // Where both nouns carry a qualifier it must be the same one; a qualifier on only one of two is a ban this filter cannot hold.
  const key = (g: string[]) => [...new Set(g)].sort().join("|");
  if (spell && ability && key(spell) !== key(ability)) return undefined;
  const adj = spell ?? ability ?? [];
  const source: SubjectFilter = { control: control > 0 ? "opp" : "any", token: null };
  const colors = adj.filter((a) => a in COLOUR_LETTER).map((a) => COLOUR_LETTER[a]!);
  const notColors = adj.filter((a) => a.startsWith("non") && a.slice(3) in COLOUR_LETTER).map((a) => COLOUR_LETTER[a.slice(3)]!);
  if (colors.length > 0) source.colors = [...new Set(colors)];
  if (notColors.length > 0) source.notColors = [...new Set(notColors)];
  const types = [...new Set(adj.filter((a) => SOURCE_TYPES.has(a)))];
  if (types.length > 0) source.type = types.length === 1 ? types[0]! : types;
  if (adj.includes("aura")) source.subtype = ["aura"];
  const by: TargetingBan["by"] = [...(spell ? ["spell" as const] : []), ...(ability ? [activated ? "activated-ability" as const : "ability" as const] : [])];
  return { by, source };
}

/** A SCOPED "can't be the target of ..." (CR 115.1 targets; CR 702.11 hexproof and CR 702.18 shroud are the keyword forms of the same restriction), read off the action's object
 *  ("be the target of spells or abilities your opponents control", or with its subject kept: "players can't be the targets of spells or activated abilities"). `clauseText`, where known,
 *  must print "can't|cannot be the target(s) of" and must not hold a CONDITION on the sentence ("As long as ..., this creature can't be the target ..."). Refused: a narrowed spell or ability
 *  ("spells that can target only Walls": Wall of Shadows), a condition ("... unless it attacked or blocked this turn": Lurker), and anything that is not a ban (Kaya, Bane of the Dead's
 *  "can be the targets of spells and abilities you control as though they didn't have hexproof" is the opposite permission).
 *  CEILING: only the whitelisted words of a tail are read (spells, abilities, activated, a colour or non-colour, a card type, Aura, "your opponents control", "from ... sources", "this turn");
 *  a qualifier on only one of "spells" and "abilities" that is not repeated refuses, and a ward-like cost ("unless its controller pays") is not a ban. */
export function targetingBanOf(object: string, clauseText = "", occurrence = 0): TargetingBan | undefined {
  const at = object.search(TARGET_OF);
  if (at < 0) return undefined;
  const tail = object.slice(at).replace(TARGET_OF, "");
  if (clauseText !== "") {
    const hit = nthMatch(clauseText, /\b(?:can['’]t|cannot) be the targets? of\b/gi, occurrence);
    if (!hit) return undefined;
    const { head } = sentenceAround(clauseText, hit.index);
    if (/\b(?:as long as|if|while|unless)\b/i.test(head)) return undefined;
  }
  return parseTargetingTail(tail);
}

/** The words that name WHO can't be targeted: the object's own subject ("players can't be the targets of ...") when it kept one, else undefined (the caller reads the clause). */
export function targetingBanSubjectInObject(object: string): string | undefined {
  const at = object.search(TARGET_OF);
  let head = object.slice(0, at < 0 ? 0 : at).trim();
  if (head === "") return undefined;
  const lower = head.toLowerCase();
  for (const s of CANT_SUFFIXES) if (lower.endsWith(` ${s}`)) { head = head.slice(0, head.length - s.length - 1).trim(); break; }
  return head === "" ? undefined : head;
}
