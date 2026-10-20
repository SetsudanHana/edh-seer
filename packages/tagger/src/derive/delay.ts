/** THE ONE READER OF A DELAYED-ACTION CUE (#1268 F5). "At the beginning of the next end step", "at the
 *  beginning of your next upkeep", "at end of turn", and a delayed trigger's own "when you next ..." were read
 *  by three regexes in two files; they read this. "At end of combat" is NOT a delay past combat: the
 *  ability triggers as the end of combat step begins (CR 511.2) and creatures leave combat only as that
 *  step ends (CR 511.3), so it is not a cue. */
export type DelayUntil = "next-end-step" | "next-upkeep" | "next-turn" | "end-of-turn" | "next-cast";
export interface Delay {
  until: DelayUntil;
  /** "step": the action lands at a turn-structure boundary. "event": a delayed trigger waits for an event ("when you next cast"). */
  kind: "step" | "event";
  /** Where the cue starts in the sentence, and how long it is. */
  index: number;
  length: number;
}

const CUE = /\bat (?:the beginning of (?:the|your) next (end step|upkeep|turn)|(?:the )?end of (?:the )?turn)\b|^when you next\b/gi;

/** Every delay cue in a sentence, in order. */
export function delaysIn(sentence: string): Delay[] {
  const out: Delay[] = [];
  for (const m of sentence.matchAll(CUE)) {
    const step = m[1]?.toLowerCase();
    const until: DelayUntil = m[0].toLowerCase().startsWith("when") ? "next-cast"
      : step === "end step" ? "next-end-step" : step === "upkeep" ? "next-upkeep" : step === "turn" ? "next-turn" : "end-of-turn";
    out.push({ until, kind: until === "next-cast" ? "event" : "step", index: m.index, length: m[0].length });
  }
  return out;
}

/** The first delay cue in a sentence, or null. */
export function delayOf(sentence: string): Delay | null {
  return delaysIn(sentence)[0] ?? null;
}

/** A return/put whose own sentence carries a next-end-step / next-upkeep cue within 120 characters before it, or right after it
 *  ("At the beginning of the next end step, return ..."). The cue is read by this module. */
export function returnDelay(sentence: string): "next-end-step" | "next-upkeep" | undefined {
  for (const d of delaysIn(sentence)) {
    if (d.until !== "next-end-step" && d.until !== "next-upkeep") continue;
    if (/\b(?:return|put)\b[^.]{0,120}$/i.test(sentence.slice(0, d.index)) || /^, (?:return|put)\b/i.test(sentence.slice(d.index + d.length))) return d.until;
  }
  return undefined;
}

/** "...exile target creature until this creature leaves the battlefield" (Constable of the Realm, Banisher Priest, Glass Casket, Mysterious Limousine): the exile
 *  lasts as long as its source, so the return the model synthesizes is DELAYED until the source leaves (#1295 item 3), not an immediate blink. The cue is read
 *  on a sentence that also exiles, off the clause text, because the synthesized return has no "return" word of its own. Bounded, anchored on literals. */
const UNTIL_LEAVES = /\buntil [^.,;]{1,60}? leaves? the battlefield\b/i;
// CEILING: the cue is read on the whole clause, so EVERY return in an "until this leaves" clause is marked source-leaves, including an immediate one beside it (Mysterious Limousine's "return each other card exiled with this Vehicle").
export function untilSourceLeaves(text: string): boolean {
  return text.split(".").some((sentence) => /\bexiles?\b/i.test(sentence) && UNTIL_LEAVES.test(sentence));
}

/** A return whose own sentence opens with an intervening "If ..." that picks a branch ("If you controlled it, return it to the battlefield tapped": Unyielding
 *  Gatekeeper; "If that permanent's mana value was 3 or less, return it ...": Vindictive Triumph). On the other branch the exile stays, so the card is removal (#1295 item 3).
 *  NOT a branch: "if you do" / "if you don't" (a cost confirmation) and any "... this way" ("If a creature is put into exile this way", "If it was exiled this way"). */
export function conditionalReturn(sentence: string): boolean {
  const open = /^\s*if\b([^,]{0,120}),/i.exec(sentence);
  if (!open) return false;
  const cond = open[1]!.trimEnd();
  // A cost confirmation ends in do/does/don't/doesn't, whoever the subject is ("If you do", "If they don't": Meathook Massacre II, "If that player does").
  return !/\b(?:do|does|don't|doesn't)$/i.test(cond) && !/\bthis way\b/i.test(cond);
}

/** AN ACTION ON ONE SIDE OF A COIN FLIP (CR 705; #1295 item 5). "If you win the flip, target Orc creature gets +2/+0. If you lose the flip, it gets -0/-2" (Orcish Captain), "If you lose the flip,
 *  sacrifice this creature" (Viashino Sandswimmer), "If it comes up heads, counter target ..." (Odds // Ends): the sentence opens with the branch, so the action in it happens on that side only.
 *  The bare "If you win" / "If you lose" count only where the clause itself flips a coin (`flipsCoin`), since "If you win the game" is no flip. Anchored at the sentence's start.
 *  CEILING: only a sentence that OPENS with the branch is read; "Otherwise, ..." (Plasma Caster) and a branch inside a sentence ("Destroy it if you lose the flip") mark nothing. */
export function flipBranch(sentence: string, flipsCoin: boolean): "win" | "lose" | "heads" | "tails" | undefined {
  const named = /^\s*(?:if|when) you (win|lose) (?:the|a) (?:coin )?flip\b/i.exec(sentence);
  if (named) return named[1]!.toLowerCase() as "win" | "lose";
  const side = /^\s*(?:if|when) (?:it|the coin) comes up (heads|tails)\b/i.exec(sentence);
  if (side) return side[1]!.toLowerCase() as "heads" | "tails";
  const bare = flipsCoin ? /^\s*(?:if|when) you (win|lose)\b(?! the game)/i.exec(sentence) : null;
  return bare ? (bare[1]!.toLowerCase() as "win" | "lose") : undefined;
}
