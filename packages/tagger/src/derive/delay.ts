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
