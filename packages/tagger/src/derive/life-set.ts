/** A LIFE TOTAL SET (#1333; CR 119.5: "If an effect sets a player's life total to a specific number, the player gains or loses the necessary amount of life to end up with the new total").
 *  The clause layer files five different printed things under `set-life`; the PRINTED CLAUSE decides which (owner ruling 2026-11-01):
 *   - `loss`: a set aimed at an opponent or a target player to a PRINTED number of 10 or less (Sorin Markov, Magister Sphinx, Vraska, Relic Seeker, Master of Cruelties' "that player"). Read as the
 *     `lose-life` it amounts to, so it gets the subject and the emit a printed "target opponent loses N life" gets. The amount lost is unknown (it is the difference), so no amount is kept.
 *   - `all-but`: "you lose all but 1 life" (Soulgorger Orgg) is a printed loss of your own life, not a set.
 *   - `set`: every other genuine set (your own life, each player's, Blessed Wind's 20, Torgaar's "half their starting life total"): effect kind `life-total-set`, no direction, no emit.
 *   - `none`: a damage floor ("damage that would reduce your life total to less than 1 reduces it to 1 instead": Ali from Cairo, Angel's Grace, Fortune Thief, Sustaining Spirit) or anything the
 *     clause text does not print as a set. Stays unclaimed, as before.
 *  CEILING: the loss threshold is the owner's printed 10, and a number the text does not print ("half", "the highest") is never a loss. A set that is a loss only because the opponent is already above
 *  the number is the rule's own shape (CR 119.5), but a set the opponent is already below would be a gain; no card prints one at an opponent today (Blessed Wind targets any player and prints 20). */
import type { Action } from "../canonicalize.js";

export type LifeSetRead =
  | { read: "loss"; who: string }
  | { read: "all-but" }
  | { read: "set"; who: string }
  | { read: "none" };

/** A life total that becomes something: "becomes", "become" ("you may have your life total become ..."), or Resolute Archangel's "it becomes equal to your starting life total". */
const SET_PHRASE = /\blife totals? (?:becomes?|is set to)\b|\bit becomes equal to your starting life total\b/i;
const WHO_IN_TEXT = /(?:^|[\s,])((?:up to one )?target (?:opponent|player)|each opponent|each player|that player|(?:the )?defending player|your)(?:['’]s)? life totals? (?:becomes?|become)\b/i;
const NUMBER_IN_TEXT = /\blife totals? becomes? (\d+)\b(?!\s*(?:for|times|more|less))/i;
const ALL_BUT = /\byou lose all but (?:\d+|one) life\b/i;
const WHO_IN_OBJECT = /^(?:(up to one )?target (opponent|player)|each (opponent|player)|that player|(?:the )?defending player|you(?:r life total)?)\b/i;
/** Whose life a LOSS reading may hit: the printed shapes the owner ruled on. `each player` is symmetric and stays a set. */
const OPPONENT_SIDE = /^(?:(?:up to one )?target (?:opponent|player)|each opponent|that player|(?:the )?defending player)$/;

function whoOf(action: Action, text: string): string {
  const printed = WHO_IN_TEXT.exec(text)?.[1]?.toLowerCase().replace(/^the /, "");
  // "Whenever this creature attacks a player and isn't blocked, THAT PLAYER's life total becomes 1" (Master of Cruelties): the attacked player is the defending player, and the engine reads the defending player as the opponent (as a printed "defending player loses 1 life" does).
  if (printed === "that player" && /\battacks (?:a player|an opponent)\b/i.test(text)) return "defending player";
  if (printed) return printed === "your" ? "you" : printed;
  const obj = WHO_IN_OBJECT.exec((action.object ?? "").trim())?.[0]?.toLowerCase().replace(/^the /, "");
  if (!obj) return /\byour (?:starting )?life total\b/i.test(text) ? "you" : "";
  return obj.startsWith("you") ? "you" : obj;
}

export function readLifeSet(action: Action, clauseText = ""): LifeSetRead {
  if (action.verb !== "set-life") return { read: "none" };
  const text = clauseText.trim();
  if (text === "") {
    // No printed clause to judge a floor by: only the unmistakable shape (an opponent-side recipient and a stored number) is read.
    const who = whoOf(action, "");
    const n = /^\d+$/.test(String(action.amount ?? "").trim()) ? Number(action.amount) : /^\d+$/.test((action.object ?? "").trim()) ? Number(action.object) : undefined;
    return OPPONENT_SIDE.test(who) && n !== undefined && n <= 10 ? { read: "loss", who } : { read: "none" };
  }
  if (ALL_BUT.test(text)) return { read: "all-but" };
  if (!SET_PHRASE.test(text)) return { read: "none" };
  const who = whoOf(action, text);
  const n = NUMBER_IN_TEXT.exec(text)?.[1];
  if (n !== undefined && Number(n) <= 10 && OPPONENT_SIDE.test(who)) return { read: "loss", who };
  return { read: "set", who };
}

/** The action a set reads as: a loss is the `lose-life` it amounts to (no amount), "all but 1" is your own loss, a set keeps its verb with the object narrowed to whose life it is. */
export function lifeSetRewrite(action: Action, clauseText = ""): Action | undefined {
  const r = readLifeSet(action, clauseText);
  if (r.read === "none") return undefined;
  const { amount: _amount, ...rest } = action;
  if (r.read === "loss") return { ...rest, verb: "lose-life", object: r.who };
  if (r.read === "all-but") return { ...rest, verb: "lose-life", object: "you" };
  return r.who === "" ? undefined : { ...action, object: r.who };
}
