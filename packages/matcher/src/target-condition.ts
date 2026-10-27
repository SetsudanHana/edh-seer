/** A CONDITION ON THE TARGET IS A TARGETING RESTRICTION, NOT A CHANCE (#1357 task 2, owner ruling 2026-10-27 C): Pyroblast's "Counter target spell if it's blue", Titan's Presence's "Exile target creature if its
 *  power is less than or equal to the revealed card's power". The card still answers, whole, in the role where it applies; it just answers a NARROW set of things, the way `COLOUR_HOSER` (rules.ts, #581) already
 *  keeps "destroy target permanent if it's blue" out of an answer class. So no weight: the effect always happens when it is aimed at something it can hit.
 *
 *  HOW TO TELL: the gate's condition opens with a pronoun for the target ("it", "it's", "its power", "that creature", "their") AND the sentence holding it names a "target" before it. "Draw a card if it has flying"
 *  (Miles "Tails" Prower, a Vehicle that entered) has no target in the sentence and stays an effect condition. Derive does not mark it (that would be a derive change), so this reads the printed sentence beside the
 *  gate text. CEILING: the sentence is found by the gate's verbatim text and split on full stops and line breaks, so a gate text that also occurs in an earlier sentence is judged by that one. */
const PRONOUN = /^(?:it|its|that|those|their|they)\b/;

/** The sentence of `oracleText` holding `gateText` (lowercase, verbatim), or "". */
function sentenceOf(oracleText: string, gateText: string): string {
  const lower = oracleText.toLowerCase().replace(/[’]/g, "'");
  const at = lower.indexOf(gateText.toLowerCase().replace(/[’]/g, "'"));
  if (at < 0) return "";
  const start = Math.max(lower.lastIndexOf(".", at), lower.lastIndexOf("\n", at)) + 1;
  return lower.slice(start, at);
}

/** The gate is a condition on the effect's own target. */
export function isTargetCondition(oracleText: string | undefined, gateText: string): boolean {
  if (!oracleText || !PRONOUN.test(gateText.toLowerCase())) return false;
  return sentenceOf(oracleText, gateText).includes("target");
}
