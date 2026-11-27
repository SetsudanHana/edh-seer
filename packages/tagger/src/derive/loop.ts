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
 *  CEILING: an action is placed in a sentence by COUNTING printings of its verb's words (`VERB_WORDS`): the k-th action of a verb is the k-th printing, a sentence that prints the verb twice holds two, and past the last printing it stays on the last. A verb word that reappears in a sentence that is no action
 *  shifts the count (an action already placed in the loop is never moved to a sentence after the repeat, which keeps Claim Jumper's second search in the loop; a shifted action BEFORE the repeat is not caught). The misses that remain:
 *  - the repeat sentence leans on its ONE previous sentence when it states no action of its own, so a process spread over two sentences without a connective keeps only the nearer: Mana Clash's coin flip (the damage sentence is marked, the flip is not), Calamity, Galloping Inferno's token (the sacrifice is marked), Ad Nauseam's
 *    reveal sentence, Tainted Pact's exile, Zimone and Dina's draw, the first two of Rally the Horde's three exiles; a looped sentence whose action makes no ability marks nothing (Plague of Vermin's payment, Tainted Pact);
 *  - a looped sentence that leans on an earlier one through "it", "that card" or "the exiled cards" is marked when it opens with a subject of its own (Thieves' Auction's "Starting with you, each player chooses one of the exiled cards") and refused when it opens with an anaphor (below).
 *  REFUSED, MARKING NOTHING: a head sentence that opens with an anaphor ("The player who exiled ...", "That player exiles ...", "Those ...", "It ...") leans on an EARLIER sentence for what it acts on, so the true start of the process is unknown, and marking it marks the outcome (Timesifter's extra turn, which is granted once, while the
 *  exile before it is what repeats). Struggle for Sanity ("That player exiles a card from it") is refused by the same rule: unlabelled beats mislabelled.
 *  AN UNROLLED LOOP IS MARKED ONCE: where the store already wrote the passes out (Research // Development's three token makers for "two more times", Equipoise, Invoke Despair, Firemind's Foresight, Kathril, Claim Jumper's two searches), as many actions of a verb as the repeat states passes ("once" is 2, "two more times" 3, "for A and B" 3) are
 *  the passes themselves, so only the first of each verb carries the `fixed` marker: marking every copy would state the repetition twice. A repeat that states no countable number ("X more times") is not read as unrolled. *  Unlabelled beats mislabelled. */
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
const ANAPHORIC_HEAD = /^\s*(?:the|that|those|these|it|its|they|them|he|she)\b/i;
// One literal space each, applied to a trimmed sentence (no `\s+` beside an optional group: CodeQL js/polynomial-redos).
const PURE_REPEAT_RE = /^(?:then )?(?:(?:you|they|that \w+) may )?repeat\b/i;
const PURE_REPEAT = { test: (s: string): boolean => PURE_REPEAT_RE.test(s.trim().replace(/\s+/g, " ")) };

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
  // A head that opens with an anaphor leans on an earlier sentence: refuse the clause (see the CEILING above).
  if (ANAPHORIC_HEAD.test(sentences[start]!)) return none;
  // The k-th action of a verb is the k-th printing of that verb's words (a sentence that prints it twice holds two); past the last printing it stays where the verb was last placed.
  const printings = new Map<string, number[]>();
  const taken = new Map<string, number>();
  let last = 0;
  const inLoop = new Map<string, number>();
  const flags = actions.map((a) => {
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
      // A verb already placed in the loop is never moved to a sentence after the repeat (a verb word printed again in a non-action sentence: "If you search your library this way, shuffle").
      if (at > r && inLoop.has(verb)) at = inLoop.get(verb)!;
    }
    if (at < 0) at = last;
    last = at;
    const looped = at >= start && at <= r;
    if (looped) inLoop.set(verb, at);
    return looped;
  });
  // AN UNROLLED LOOP IS MARKED ONCE (see the CEILING above): the first looped action of each verb.
  const passes = passesOf(sentences[r]!);
  if (loopOf(sentences[r]!) === "fixed" && passes !== undefined) {
    const seen = new Map<string, number>();
    const total = new Map<string, number>();
    actions.forEach((a, i) => { if (flags[i]) total.set(a.verb ?? "", (total.get(a.verb ?? "") ?? 0) + 1); });
    actions.forEach((a, i) => {
      if (!flags[i]) return;
      const v = a.verb ?? "";
      const n = seen.get(v) ?? 0;
      seen.set(v, n + 1);
      if ((total.get(v) ?? 0) >= passes && n > 0) flags[i] = false;
    });
  }
  return flags;
}

const NUMBER_WORDS: Readonly<Record<string, number>> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

/** How many passes a FIXED repeat states in all, the first included: "once" 2, "twice" 3, "two more times" 3, "for A, B and C" 4. Undefined when no number is countable ("X more times"). */
function passesOf(sentence: string): number | undefined {
  const m = REPEAT.exec(sentence);
  const tail = m?.[1] ?? "";
  if (/^\s+once\b/i.test(tail)) return 2;
  if (/^\s+twice\b/i.test(tail)) return 3;
  const more = /^\s+(\w+) more times?\b/i.exec(tail);
  if (more) { const n = /^\d+$/.test(more[1]!) ? Number(more[1]) : NUMBER_WORDS[more[1]!.toLowerCase()]; return n === undefined ? undefined : n + 1; }
  const t = tail.trim().replace(/\s+/g, " ");
  if (t.toLowerCase().startsWith("for ")) return t.slice(4).replace(/, and /gi, ",").replace(/ and /gi, ",").split(",").filter((x) => x.trim() !== "").length + 1;
  return undefined;
}
