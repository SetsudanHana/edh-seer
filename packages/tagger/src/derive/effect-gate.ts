/** THE "IF <CONDITION>" THAT GATES ONE EFFECT SENTENCE (#1357, owner 2026-10-27): "Draw a card if an opponent has cast a blue or black spell this turn" (Veil of Summer), "Then draw a card if it has seven or more
 *  phyresis counters on it" (Weatherlight Compleated), "Create two 1/1 blue Fish creature tokens if an opponent controls more creatures than you" (Beza). The effect still counts; whether it happens depends on the
 *  condition, and the schema refuses a general condition slot (CR 603.4's intervening if has 241 distinct conditions), so the condition goes through THE ONE GATE PARSE (`parseGate`, derive/gate.ts) and rides on the
 *  ABILITY the sentence made as `Ability.gate`. This module only FINDS the condition and says which action's sentence it sits in; it reads no words of the condition itself.
 *
 *  WHICH SENTENCE IS AN ACTION'S: the k-th action of a verb takes the k-th sentence carrying that verb's printed word (`FLIP_VERB_WORDS`, the table `onFlip` and the delayed returns read too).
 *  CEILING: a verb whose printed word is not in the table (`other`, `cost-modify`, ...) finds no sentence and its ability is ungated, which is the reading before this existed; a word that also appears for another
 *  job in an earlier sentence can shift a later action's sentence (`effectGates` reports a gated sentence no action took, and the grammar refuses a mode over it).
 *  A LEADING CONDITION (#1357 part 2, owner 2026-10-27): a sentence that OPENS with its condition ("If you control a Dragon, draw a card"), "Then if ..." and the mid-sentence ", then if ..." gate every action of the
 *  sentence that stands AFTER the condition, however the predicate is joined ("If you control a Dragon, draw a card and you gain 2 life" gates both: unlike a trailing "if", a leading one governs the whole predicate).
 *  An "Otherwise, ..." / "If not, ..." sentence is the other branch of the nearest earlier sentence's "if": its actions get an `unknown` gate that says so (`isOtherwiseGate`), never none, which
 *  would read as sure. The parser has no negation, so the branch is unread (0.5, flagged), not a copy of the condition (which would read as its opposite).
 *  CEILING: A LEADING "IF" GOVERNS ITS OWN SENTENCE ONLY. "If X, mill three cards. Put one into your hand." has no printed marker for how far X reaches, so the following sentences stay ungated (an under-gate; the
 *  "Otherwise" branch is the one continuation that is marked, and is gated).
 *  CEILING: an action with both a trailing and a leading "if" takes the trailing one (one gate slot); an "Otherwise" sentence takes the unknown branch gate whatever "if" it holds.
 *  CEILING: AN "IF" GATES THE ACTION OF ITS OWN CONJUNCT ONLY, found by the printed verb words (see `effectGates`): in "Create a Treasure token and draw a card if X" the draw is gated and the Treasure is not, which
 *  under-gates a sentence whose "if" the writer meant for both; and a comma list inside a condition ("if you control a Dragon, an Elf, and a Goblin") ends it at ", and ".
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
 *   - "if that player does" / "if it does" / "if no one does" / "if a player does": the same follow-up, about another player or object. */
const FOLLOW_UP = /^(?:you|they|that player|he|she|it|no one|no player|a player|any player|the player|an opponent|each opponent) (do|does|did|don't|doesn't|didn't|can't|cannot|pay|paid)\b/i;
function notAGate(condition: string): boolean {
  const m = FOLLOW_UP.exec(condition);
  // "if you don't control a legendary creature" IS a condition (Errand-Rider of Gondor, Raving Oni-Slave): the bare follow-up ends there or at a comma.
  if (m) { const rest = condition.slice(m[0].length).trimStart(); return m[1] === "pay" || m[1] === "paid" || rest === "" || rest.startsWith(","); }
  return /^(?:able|possible)\b/i.test(condition);
}
/** "would" in the condition is a replacement (CR 614, `replacement.ts` owns it) and "instead" an alternative of the same effect ("Draw two cards instead if ..."): neither says whether the effect happens.
 *  So is the frame of a TRIGGER DOUBLER, which prints no "would": "If a permanent entering causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time" (Panharmonicon, Elesh Norn,
 *  Yarok, Roaming Throne: 7 of the 117 static leading conditions). The condition is the event the doubler modifies, not a chance the doubler does nothing. */
const REPLACEMENT_WORDS = /\bwould\b|\btriggered abilit(?:y|ies)\b/i;
const INSTEAD = /\binstead\b/i;
/** A sentence that restricts WHEN the card or ability may be used or what it costs, not what it does (part 1 of #1349 owns the activation restriction). "costs {2} less to cast if it targets ...", "costs {1} less to activate". */
const COST_CHANGE = /\bcosts? [^,]{0,80}\b(?:less|more) to (?:cast|activate)\b/i;
/** An ALTERNATIVE COST or a cast permission the card gives itself ("If an opponent cast a blue spell this turn, you may pay {R} rather than pay this spell's mana cost", the Traps; "If you control a creature with power 4 or greater, you may cast
 *  this spell as though it had flash", Dragon Grip; "If you control a commander, you may cast this spell without paying its mana cost", Deadly Rollick): a condition on HOW the card is cast, the same family as a cost reduction, and no gate on what it does.
 *  CEILING: "If it's a nonland card, you may cast it without paying its mana cost" (Unexpected Results) names a cast of ANOTHER card and is a gate; only "this spell/creature/card" is the card's own. */
const ALT_COST = /\brather than (?:pay|paying)\b|, (?:you may )?cast (?:this spell|this creature|this card)\b[^,.]{0,40}\b(?:as though|without paying)\b/i;
const RESTRICTION_OPENER = /^(?:activate|cast this|use this|any player may activate|you may activate|you may cast this)\b/i;
/** What stands before the "if" when the sentence is NOT "<effect> if <condition>": a bare connective, or an "only"/"as"/"even"/"except" the "if" belongs to ("only if", "as if", "even if", "except if this creature was embalmed"). */
const BARE_LEAD = new Set(["then", "and", "also", "otherwise"]);
const IF_BELONGS_TO_PREVIOUS = /(?:^|\s)(?:only|as|even|what|except)$/i;

export type SentenceGate =
  | { shape: "none" }
  | { shape: "exempt" }
  /** The sentence opens with its condition (or "Then if ..."): it gates the actions that follow it, see the header. */
  | { shape: "leading"; condition: string }
  | { shape: "trailing"; condition: string };

/** One gating "if" of a sentence: where it stands (`at`, the index of its "i"), the verbatim condition and where that condition ends (`end`, an index in the sentence). */
export interface SentenceIf { at: number; shape: "leading" | "trailing"; condition: string; start: number; end: number }

/** Where a condition that begins at `from` ends: at the first ", then " / ", and " (the next conjunct), or at the last comma before the NEXT "if" (a second "if" of its own conjunct), else at the sentence's end.
 *  A leading condition ends at its comma. A comma inside a list in a condition ("a Dragon, an Elf, and a Goblin") is cut at ", and ": CEILING below. */
function conditionEnd(lower: string, from: number, leading: boolean): number {
  if (leading) { const comma = lower.indexOf(",", from); return comma < 0 ? lower.length : comma; }
  let end = lower.length;
  for (const cut of [", then ", ", and "]) { const i = lower.indexOf(cut, from); if (i >= 0 && i < end) end = i; }
  const next = lower.indexOf(" if ", from);
  if (next >= 0 && next < end) { const comma = lower.lastIndexOf(", ", next); if (comma >= from) end = comma; }
  return end;
}

/** The gating ifs of one sentence, in order. A sentence that restricts use or cost, or says "instead", has none; an "if" that is a follow-up, a replacement or belongs to "only/as/even/except" is skipped. */
export function sentenceIfs(sentence: string): SentenceIf[] {
  const s = sentence.replace(/"[^"]*"/g, " ");
  const lower = s.toLowerCase();
  if (RESTRICTION_OPENER.test(s.trim()) || COST_CHANGE.test(s) || ALT_COST.test(s) || INSTEAD.test(s)) return [];
  const lead = lower.length - lower.trimStart().length;
  const starts: number[] = lower.startsWith("if ", lead) ? [lead] : [];
  for (let p = lower.indexOf(" if "); p >= 0; p = lower.indexOf(" if ", p + 1)) starts.push(p + 1);
  const out: SentenceIf[] = [];
  let ended = 0;
  for (const at of starts) {
    // An "if" inside the previous condition ("it's a creature or if {G}{W} was spent") is part of it.
    if (at < ended) continue;
    const opens = at === lead && lower.startsWith("if ", lead);
    const start = at + 3;
    const pre = s.slice(0, at).trim();
    // "Then if X, do Y" and "Until end of turn, if X, ..." and "Before the game begins, if ...": the condition leads, whatever the words before it.
    // ...and the same joined to an earlier effect: "create a Rat token, then if you control five or more Rats, each Rat gets +2/+0" (Ogre Chitterlord).
    const lastWord = pre.slice(pre.lastIndexOf(" ") + 1).replace(/,$/, "").toLowerCase();
    const leads = opens || (!IF_BELONGS_TO_PREVIOUS.test(pre) && (BARE_LEAD.has(lastWord) || pre.endsWith(",")));
    const end = conditionEnd(lower, start, leads);
    const condition = s.slice(start, end).trim();
    ended = end;
    if (condition === "" || REPLACEMENT_WORDS.test(condition) || notAGate(condition)) continue;
    if (!opens && IF_BELONGS_TO_PREVIOUS.test(pre)) continue;
    out.push({ at, shape: leads ? "leading" : "trailing", condition, start, end });
  }
  return out;
}

/** What one sentence says about its FIRST gating if: the verbatim condition of a trailing one, or why it has none. */
export function sentenceGate(sentence: string): SentenceGate {
  const first = sentenceIfs(sentence)[0];
  if (first) return { shape: first.shape, condition: first.condition };
  const plain = sentence.replace(/"[^"]*"/g, " ");
  return plain.toLowerCase().includes(" if ") || plain.trimStart().toLowerCase().startsWith("if ") ? { shape: "exempt" } : { shape: "none" };
}

/** What starts a new conjunct between two verbs of one sentence. */
const CONJUNCT_BOUNDARY = [", then ", ", and ", " and ", ", "];

/** The gate text of the OTHER BRANCH of an "if" ("Otherwise, draw a card"): derive makes it an `unknown` gate (the parser has no negation) and asks no deck demand of it. The report prints a gate after "it only works if", so the text
 *  is a clause that reads there: "it only works if it is not the case that it was attacking" / "...if the condition before it does not hold" (no earlier condition found). */
const NOT_THE_CASE = "it is not the case that ";
const NO_EARLIER = "the condition before it does not hold";
export const isOtherwiseGate = (condition: string): boolean => condition.startsWith(NOT_THE_CASE) || condition === NO_EARLIER;
/** A sentence that is the OTHER branch of the "if" before it. */
const OTHERWISE_OPENER = /^(?:otherwise|if not)\b/i;

export interface EffectGates {
  /** Per action, in order: the verbatim condition of the "if" that governs that action (its own conjunct's trailing "if", else the leading "if" before it), the other-branch text (`isOtherwiseGate`) of an "Otherwise" sentence, or null. */
  gates: (string | null)[];
  /** Some sentence carries a gating "if" that no action took (no action's verb finds it). The grammar refuses a mode over it. */
  refused: boolean;
}

/** THE GATE OF EACH ACTION of an effect body (the clause's text after its trigger preamble, cost and ability word; the card's own name may be "~" or printed). `verbs` are the clause's action verbs in order.
 *  AN "IF" BELONGS TO ITS OWN CONJUNCT (#1357 review): an action takes the first trailing "if" that follows its verb's printed word, unless another action's word stands between them ("Mill two cards, then
 *  destroy ... if ..." gates the destroy, "gets +2/+0, gains trample if it's red, and gains vigilance if it's white" gives each grant its own) or a ", except" rider does (a clone's "except it enters with a
 *  counter on it if ..." gates the counter, never the copy). A condition ends at its conjunct's ", then " / ", and " (or at the comma before the next "if"). */
export function effectGates(body: string, verbs: readonly string[]): EffectGates {
  const plain = body.replace(/"[^"]*"/g, " ");
  const sentences = plain.split(".");
  const parsed = sentences.map(sentenceIfs);
  // A verb's printed word is looked for in what the sentence DOES, never in its condition: "Draw a card if an opponent HAS cast a blue or black spell" is no grant (`has`). The same sentences, conditions blanked.
  const doing = sentences.map((sentence, i) => parsed[i]!.reduce((acc, f) => acc.slice(0, f.start) + " ".repeat(f.end - f.start) + acc.slice(f.end), sentence));
  const where = verbs.map((verb, i): { sentence: number; offset: number } | null => {
    if (verb === "" || verb === "none" || verb === "other") return null;
    const k = verbs.slice(0, i).filter((v) => v === verb).length;
    let seen = 0;
    for (let at = 0; at < doing.length; at++) {
      for (const m of doing[at]!.matchAll(new RegExp(printedVerbWord(verb, true), "gi"))) {
        if (seen === k) return { sentence: at, offset: m.index };
        seen++;
      }
    }
    return null;
  });
  const taken = new Set<string>();
  /** The condition each sentence's "otherwise" would negate: the nearest earlier sentence's first "if", gating or not ("You may pay {1}. If you do, ... Otherwise, ..."). */
  const branchOf: (string | undefined)[] = [];
  let latest: string | undefined;
  sentences.forEach((sentence, i) => {
    branchOf.push(latest);
    if (OTHERWISE_OPENER.test(sentence.trimStart())) return;
    const first = parsed[i]![0];
    if (first) latest = first.condition;
    else if (sentence.toLowerCase().includes(" if ") || sentence.trimStart().toLowerCase().startsWith("if ")) latest = "";
  });
  const otherwise = sentences.map((sentence) => OTHERWISE_OPENER.test(sentence.trimStart()));
  const gates = where.map((w, j) => {
    if (w === null) return null;
    // THE OTHER BRANCH: unread, whatever "if" the sentence also holds (CEILING in the header).
    if (otherwise[w.sentence]) { for (const f of parsed[w.sentence]!) taken.add(`${w.sentence}:${f.at}`); return branchOf[w.sentence] ? `${NOT_THE_CASE}${branchOf[w.sentence]!.toLowerCase()}` : NO_EARLIER; }
    const next = parsed[w.sentence]!.find((f) => f.shape === "trailing" && f.at > w.offset);
    if (next) {
      const lower = sentences[w.sentence]!.toLowerCase();
      // Another action's word in a LATER conjunct between this one's and the "if": the "if" is that action's. A word inside the same conjunct is a modifier ("gets +2/+2 until end of turn BEFORE IT FIGHTS if you
      // control a creature with power 4 or greater", Savage Punch) and shares the "if".
      const theirs = where.some((o, i) => i !== j && o !== null && o.sentence === w.sentence && o.offset > w.offset && o.offset < next.at && CONJUNCT_BOUNDARY.some((b) => lower.slice(w.offset, o.offset).includes(b)));
      if (!theirs && !lower.slice(w.offset, next.at).includes(" except ")) { taken.add(`${w.sentence}:${next.at}`); return next.condition; }
    }
    // A LEADING "if" governs every action after it in its sentence (the last one before the action, for ", then if X, ..., then if Y, ...").
    const lead = parsed[w.sentence]!.filter((f) => f.shape === "leading" && f.end <= w.offset).pop();
    if (!lead) return null;
    taken.add(`${w.sentence}:${lead.at}`);
    return lead.condition;
  });
  const refused = parsed.some((ifs, at) => ifs.some((f) => !taken.has(`${at}:${f.at}`)));
  return { gates, refused };
}

// ---- THE COUNTER A GATE NAMES --------------------------------------------------------------------------------------------------------------
/** Words before "counter(s)" that name no kind of counter. */
const NOT_A_KIND = new Set(["a", "an", "the", "more", "no", "any", "of", "that", "those", "its", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "twenty", "other", "additional", "such", "each", "same", "many", "fewer", "or", "and", "kind", "total", "number"]);
const escapeRe = (w: string): string => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** DOES THE CONDITION'S COUNTER COME FROM THE CARD ITSELF, so that no deck supplies it? "it has five or more hunger counters on it" (Fasting: "put a hunger counter on this enchantment"), "exiled cards with hit counters on them"
 *  (Etrata: "put a hit counter on that card"), "it had a death counter on it" (Bogardan Phoenix): a named kind the card's own text puts is nobody else's, so the condition makes no counters demand. A +1/+1 counter
 *  is every counters deck's, so it is the card's own only when the condition is about the card ("it has a +1/+1 counter on it", Steel Dromedary: "enters tapped with two +1/+1 counters on it"); "that creature has a
 *  +1/+1 counter on it" (Marcus) and a counter with no kind ("a permanent with a counter on it", Federation Field Medic) stay demands.
 *  CEILING: reads the card's whole text, not the clause, and the card's own pronoun "it" is taken to be the card (a trigger about another object saying "it has a +1/+1 counter" would lose its demand). */
export function counterIsTheCardsOwn(condition: string, cardText: string): boolean {
  const lower = condition.toLowerCase();
  const text = cardText.toLowerCase();
  const kinds = new Set<string>();
  for (const m of lower.matchAll(/([+-]\d+\/[+-]\d+|[a-z][a-z-]{1,20}) counters?\b/g)) if (!NOT_A_KIND.has(m[1]!)) kinds.add(m[1]!);
  if (kinds.size === 0) return false;
  const aboutTheCard = /^(?:it|this [a-z]+|~) (?:has|had)\b/.test(lower);
  const places = (kind: string): boolean => new RegExp(`\\b(?:put|puts|moves?|enters?(?: [a-z ]{0,20})? with)\\b[^.]{0,80}${escapeRe(kind)} counters?`).test(text);
  return [...kinds].every((kind) => /^[+-]/.test(kind) ? aboutTheCard && places(kind) : places(kind));
}
