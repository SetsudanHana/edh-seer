/** THE "IF <CONDITION>" THAT GATES ONE EFFECT SENTENCE (#1357, owner 2026-10-27): "Draw a card if an opponent has cast a blue or black spell this turn" (Veil of Summer), "Then draw a card if it has seven or more
 *  phyresis counters on it" (Weatherlight Compleated), "Create two 1/1 blue Fish creature tokens if an opponent controls more creatures than you" (Beza). The effect still counts; whether it happens depends on the
 *  condition, and the schema refuses a general condition slot (CR 603.4's intervening if has 241 distinct conditions), so the condition goes through THE ONE GATE PARSE (`parseGate`, derive/gate.ts) and rides on the
 *  ABILITY the sentence made as `Ability.gate`. This module only FINDS the condition and says which action's sentence it sits in; it reads no words of the condition itself.
 *
 *  WHICH SENTENCE IS AN ACTION'S: the k-th action of a verb takes the k-th sentence carrying that verb's printed word (`FLIP_VERB_WORDS`, the table `onFlip` and the delayed returns read too).
 *  CEILING: a verb whose printed word is not in the table (`other`, `cost-modify`, ...) finds no sentence and its ability is ungated, which is the reading before this existed; a word that also appears for another
 *  job in an earlier sentence can shift a later action's sentence (`effectGates` reports a gated sentence no action took, and the grammar refuses a mode over it).
 *  CEILING: ONLY A TRAILING "if". A sentence that OPENS with the condition ("If you control a Dragon, draw a card", "Then if ...") stays ungated: its condition can govern several following clauses and an "Otherwise"
 *  branch, and which of the sentence's actions it gates is not a word-level question. The grammar keeps refusing a MODE that opens with one (`effectGates().refused`).
 *  CEILING: a sentence with two ifs ("... if {U} was spent, and ... if {R} was spent", Unnerving Assault) is one condition, the whole tail from the first "if": `unknown`, flagged on every action of the sentence.
 *  Bounded literals and `indexOf` only, no `\s*...$` tail and no nested quantifier (CodeQL js/polynomial-redos). */

/** The printed word(s) an action verb reads as, where they differ from the verb's name ("modify-pt" is "gets", "deal-damage" is "deals"). The default is the verb's first word, with its plural/third-person ending:
 *  "draw" reads "draws", "destroy" reads "destroys". */
export const FLIP_VERB_WORDS: Record<string, string> = {
  "modify-pt": "gets?", "deal-damage": "deals?", "gain-life": "gains?", "lose-life": "loses?|lose", "add-counter": "puts?", "remove-counter": "removes?", "gain-control": "gains? control",
  "counter-spell": "counters?", "extra-turn": "extra turn", "phase-out": "phases? out", "grant-ability": "gains?", "create": "creates?", "sacrifice": "sacrifices?",
};
/** Words only a GATED sentence is looked up by, so `onFlip`'s table (above) does not move: a counter put by a replacement ("enters with two +1/+1 counters on it if it's a creature", What Must Be Done; "enters with
 *  a +1/+1 counter on it if you attacked this turn", the 49 corpus cards that print it) is not "put". Each row is a verb the gated sentences of the corpus printed in other words (measured against the sentences no action found). */
const GATE_ONLY_WORDS: Record<string, string> = {
  "add-counter": "puts?|enters? (?:the battlefield )?with",
  // "This creature can't be blocked if you've cast two or more spells this turn" (Illvoi Infiltrator), "Enchanted creature can't block if it's black": a restriction is printed "can't".
  "cant": "can't|cannot|doesn't|don't",
  // "Equipped creature has lifelink if you control a Cleric" (Multiclass Baldric), "Each spell you cast has split second if ...": a static grant is printed "has" / "have".
  "grant-ability": "gains?|has|have",
  // "that permanent becomes saddled if it's a Mount": an animate is printed "becomes".
  "animate": "becomes?",
};
export function printedVerbWord(verb: string, forGate = false): string {
  const own = (forGate ? GATE_ONLY_WORDS[verb] : undefined) ?? FLIP_VERB_WORDS[verb] ?? `${verb.split("-")[0]}(?:s|es)?`;
  return `\\b(?:${own})\\b`;
}
/** The index (in `text.split(".")`) of the sentence holding the k-th (0-based) match of the regex source `pattern`; -1 when there are fewer. */
export function nthSentenceIndex(text: string, pattern: string, k: number): number {
  const word = new RegExp(pattern, "gi");
  let seen = 0;
  const sentences = text.split(".");
  for (let i = 0; i < sentences.length; i++) {
    const n = (sentences[i]!.match(word) ?? []).length;
    if (seen + n > k) return i;
    seen += n;
  }
  return -1;
}
/** The sentence of `text` holding the k-th (0-based) match of the regex source `pattern`; "" when there are fewer. */
export function nthSentenceMatching(text: string, pattern: string, k: number): string {
  const at = nthSentenceIndex(text, pattern, k);
  return at < 0 ? "" : text.split(".")[at]!;
}

/** A condition that is no gate on whether the effect happens:
 *   - "if you do" / "if you don't" / "if you did" / "if they do": the follow-up to an optional cost or choice inside the same effect ("you may pay {1}. If you do, ...");
 *   - "if able" / "if possible": a rules qualifier on an instruction ("attacks each combat if able");
 *   - "if you pay {2} more": the price of an option ("You may cast this spell as though it had flash if you pay {2} more to cast it");
 *   - "if that player does" / "if it does": the same follow-up, about another player or object. */
const FOLLOW_UP = /^(?:you|they|that player|he|she|it) (do|does|did|don't|doesn't|didn't|can't|cannot|pay|paid)\b/i;
function notAGate(condition: string): boolean {
  const m = FOLLOW_UP.exec(condition);
  // "if you don't control a legendary creature" IS a condition (Errand-Rider of Gondor, Raving Oni-Slave): the bare follow-up ends there or at a comma.
  if (m) { const rest = condition.slice(m[0].length).trimStart(); return m[1] === "pay" || m[1] === "paid" || rest === "" || rest.startsWith(","); }
  return /^(?:able|possible)\b/i.test(condition);
}
/** "would" in the condition is a replacement (CR 614, `replacement.ts` owns it) and "instead" an alternative of the same effect ("Draw two cards instead if ..."): neither says whether the effect happens. */
const REPLACEMENT_WORDS = /\bwould\b/i;
const INSTEAD = /\binstead\b/i;
/** A sentence that restricts WHEN the card or ability may be used or what it costs, not what it does (part 1 of #1349 owns the activation restriction). "costs {2} less to cast if it targets ...", "costs {1} less to activate". */
const COST_CHANGE = /\bcosts? [^,]{0,80}\b(?:less|more) to (?:cast|activate)\b/i;
const RESTRICTION_OPENER = /^(?:activate|cast this|use this|any player may activate|you may activate|you may cast this)\b/i;
/** What stands before the "if" when the sentence is NOT "<effect> if <condition>": a bare connective, or an "only"/"as"/"even" the "if" belongs to ("only if", "as if", "even if"). */
const BARE_LEAD = new Set(["then", "and", "also", "otherwise"]);
const IF_BELONGS_TO_PREVIOUS = /(?:^|\s)(?:only|as|even|what)$/i;

export type SentenceGate =
  | { shape: "none" }
  | { shape: "exempt" }
  /** The sentence opens with its condition (or "Then if ..."): not read, see the header. */
  | { shape: "leading" }
  | { shape: "trailing"; condition: string };

/** What one sentence says about a gate: the verbatim condition after its first trailing "if", or why it has none. */
export function sentenceGate(sentence: string): SentenceGate {
  const s = sentence.replace(/"[^"]*"/g, " ").trim();
  if (s === "") return { shape: "none" };
  const lower = s.toLowerCase();
  const opens = lower.startsWith("if ");
  const at = opens ? 0 : lower.indexOf(" if ");
  if (at < 0) return { shape: "none" };
  if (RESTRICTION_OPENER.test(s) || COST_CHANGE.test(s) || INSTEAD.test(s)) return { shape: "exempt" };
  const pre = opens ? "" : s.slice(0, at).trim();
  const condition = s.slice(at + (opens ? 3 : 4)).trim();
  if (REPLACEMENT_WORDS.test(condition) || notAGate(condition)) return { shape: "exempt" };
  if (opens) return { shape: "leading" };
  if (IF_BELONGS_TO_PREVIOUS.test(pre)) return { shape: "exempt" };
  // "Then if X, do Y" and "Until end of turn, if X, ..." and "Before the game begins, if ...": the condition leads, whatever the words before it.
  // ...and the same joined to an earlier effect: "create a Rat token, then if you control five or more Rats, each Rat gets +2/+0" (Ogre Chitterlord).
  const lastWord = pre.slice(pre.lastIndexOf(" ") + 1).replace(/,$/, "").toLowerCase();
  if (BARE_LEAD.has(lastWord) || pre.endsWith(",")) return { shape: "leading" };
  return condition === "" ? { shape: "none" } : { shape: "trailing", condition };
}

/** The words of a sentence that say what happens: a trailing condition is cut at its first " if ", a leading one ("If X, do Y") through its comma. */
function effectPart(sentence: string): string {
  const lower = sentence.toLowerCase();
  if (lower.trimStart().startsWith("if ")) { const comma = sentence.indexOf(","); return comma < 0 ? "" : sentence.slice(comma + 1); }
  const at = lower.indexOf(" if ");
  return at < 0 ? sentence : sentence.slice(0, at);
}

export interface EffectGates {
  /** Per action, in order: the verbatim trailing condition of the sentence that action's verb finds, or null. */
  gates: (string | null)[];
  /** Some sentence carries a gating "if" that no action took: it opens with its condition, or no action's verb finds it. The grammar refuses a mode over it. */
  refused: boolean;
}

/** THE GATE OF EACH ACTION of an effect body (the clause's text after its trigger preamble, cost and ability word; the card's own name may be "~" or printed). `verbs` are the clause's action verbs in order. */
export function effectGates(body: string, verbs: readonly string[]): EffectGates {
  const plain = body.replace(/"[^"]*"/g, " ");
  const sentences = plain.split(".");
  // A verb's printed word is looked for in what the sentence DOES, never in its condition: "Draw a card if an opponent HAS cast a blue or black spell" is no grant (`has`), and "... if you control a creature
  // that DREW" is no draw. The same sentences, the condition cut off.
  const doing = sentences.map(effectPart).join(".");
  const taken = new Set<number>();
  const gates = verbs.map((verb, i) => {
    if (verb === "" || verb === "none" || verb === "other") return null;
    const k = verbs.slice(0, i).filter((v) => v === verb).length;
    const at = nthSentenceIndex(doing, printedVerbWord(verb, true), k);
    if (at < 0) return null;
    const g = sentenceGate(sentences[at]!);
    if (g.shape !== "trailing") return null;
    taken.add(at);
    return g.condition;
  });
  const refused = sentences.some((sentence, at) => {
    const g = sentenceGate(sentence);
    return g.shape === "leading" || (g.shape === "trailing" && !taken.has(at));
  });
  return { gates, refused };
}
