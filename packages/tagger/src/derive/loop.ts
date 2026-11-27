import { VERB_WORDS } from "./verb-words.js";

/** "REPEAT THIS PROCESS" IS A LOOP (#1335, owner ruling 2026-11-26): the clause's own sentence (reminder text stripped: Jadelight Ranger's explore reminder says "then repeat this process" and the card does not loop) names a repetition of the effect before it.
 *  The store files the sentence as a `trigger-again` action, which the printed-verb guard (#1321) correctly drops (nothing triggers again), so the loop was lost with it. Read off the printed words:
 *  - `unbounded`: the player chooses the count ("any number of times", "as many times as they choose": Ad Nauseam, Kindle the Carnage, Trade Secrets);
 *  - `fixed`: a stated count ("repeat this process once", "two more times", "X more times", "for an enchantment and a planeswalker": Claim Jumper, Research // Development);
 *  - `conditional`: anything else ("If you do, repeat this process", "repeat this process until ..."). Unlabelled beats mislabelled, so a repetition with a stated end is the conditional one only when no count is stated.
 *  CEILING: the first "repeat this process" of the clause names its shape; no corpus card prints two in one clause today, so a clause with two would read as its first.
 *
 *  WHICH ABILITIES LOOP (`loopedActions`): not the whole clause. What comes after the repeat sentence (Plague of Vermin's Rats, Rally the Horde's tokens, Demonlord Belzenlok's damage, Claim Jumper's shuffle) and the setup before it (Thieves' Auction's "Exile all nontoken permanents", Struggle for Sanity's "reveals their hand")
 *  are not repeated. The looped sentences are the repeat sentence itself (its own actions: "draw a card and repeat this process") when it states any, the sentence before it when it states none ("Repeat this process until ..."), and the sentences those lean on through a leading "if / then / when you do / otherwise".
 *  CEILING: an action is placed in its sentence by its object text, else by the next sentence that prints its verb, in order, so a paraphrased object can land one sentence off; and a looped sentence that leans on an earlier one WITHOUT a connective is left unmarked, because "it", "that card" and "the exiled cards" lean on setup as well
 *  (Ad Nauseam's reveal sentence, Tainted Pact's exile, Zimone and Dina's draw, the first two of Rally the Horde's three exiles); Kathril, Aspect Warper's counters are expanded one action per keyword and only the first two land in the looped sentence; a looped sentence whose action makes no ability (Plague of Vermin's payment, Tainted Pact) marks nothing.
 *  Unlabelled beats mislabelled. */
export type Loop = "conditional" | "unbounded" | "fixed";

const REPEAT = /\brepeat (?:this|the) process\b([^.]{0,80})/i;
const UNBOUNDED = /^\s+(?:any number of times|as many times as)/i;
const FIXED = /^\s+(?:once\b|twice\b|(?:\w+|x) more times?\b|for\b)/i;

export function loopOf(clauseText: string | undefined): Loop | undefined {
  if (!clauseText) return undefined;
  // Linear: the parenthesis is stripped by a bounded, non-nested pattern (CodeQL js/polynomial-redos).
  const printed = clauseText.replace(/\([^()]{0,400}\)/g, " ");
  const m = REPEAT.exec(printed);
  if (!m) return undefined;
  const tail = m[1] ?? "";
  return UNBOUNDED.test(tail) ? "unbounded" : FIXED.test(tail) ? "fixed" : "conditional";
}

const CONNECT = /^\s*(?:then\b|if\b|otherwise\b|when you do\b|unless\b)/i;
const PURE_REPEAT = /^\s*(?:then\s+)?(?:(?:you|they|that \w+)\s+may\s+)?repeat\b/i;

/** For each action of the clause, whether it is part of the looped sentences (see the CEILING above). All false when the clause prints no "repeat this process". The `trigger-again` action itself is never looped: it is the repeat sentence. */
export function loopedActions(clauseText: string | undefined, actions: readonly { verb?: string; object?: string }[]): boolean[] {
  const none = actions.map(() => false);
  if (!clauseText) return none;
  const printed = clauseText.replace(/\([^()]{0,400}\)/g, " ");
  const sentences = printed.split(/(?<=[.!?])\s+/);
  const r = sentences.findIndex((x) => REPEAT.test(x));
  if (r < 0) return none;
  let start = PURE_REPEAT.test(sentences[r]!) ? r - 1 : r;
  while (start > 0 && CONNECT.test(sentences[start]!)) start--;
  start = Math.max(start, 0);
  // The k-th action of a verb is the k-th printing of that verb's words (a sentence that prints it twice holds two); past the last printing it stays where the verb was last placed.
  const printings = new Map<string, number[]>();
  const taken = new Map<string, number>();
  let last = 0;
  return actions.map((a) => {
    if (a.verb === "trigger-again") return false;
    const verb = a.verb ?? "";
    const words = VERB_WORDS[verb];
    let at = -1;
    if (words !== undefined) {
      let list = printings.get(verb);
      if (list === undefined) {
        const re = new RegExp(`\\b(?:${words})`, "gi");
        list = sentences.flatMap((x, idx) => Array.from({ length: [...x.matchAll(re)].length }, () => idx));
        printings.set(verb, list);
      }
      const k = taken.get(verb) ?? 0;
      taken.set(verb, k + 1);
      at = list.length === 0 ? -1 : list[Math.min(k, list.length - 1)]!;
    }
    if (at < 0) at = last;
    last = at;
    return at >= start && at <= r;
  });
}
