/** A CONDITION ON THE TARGET IS A TARGETING RESTRICTION, NOT A CHANCE (#1357 task 2, owner ruling 2026-10-27 C): Pyroblast's "Counter target spell if it's blue", Fatal Push's "Destroy target creature if it has mana
 *  value 2 or less". The card still answers, whole, in the role where it applies; it just answers a NARROW set of things. So no weight: the effect always happens when it is aimed at something it can hit.
 *  (Answer coverage: only a COLOUR condition drops the card from a class, `COLOUR_HOSER` in rules.ts; a stat or state condition keeps the class, marked narrow. Owner refinement, same day.)
 *
 *  HOW TO TELL: the gate's condition opens with a pronoun for the target ("it", "it's", "its power", "that creature", "their") AND the clause holding it (the sentence from its last ", then ") names a "target" before
 *  it. "Draw a card if it has flying" (Miles "Tails" Prower, a Vehicle that entered) and "draw a card if it was attacking" (Garna) have no target in the clause and stay effect conditions. Two kinds of "it" are
 *  NOT the target: the day or night ("if it's night", Wolf Strike) and the spell's own casting ("if {G}{W} was spent to cast this spell", "if it was kicked"), and a condition that holds a second "if" or a mana symbol is a
 *  mis-split of two effects (Firespout), so none of these is a target condition. Derive does not mark it (that would be a derive change), so this reads the printed clause beside the gate text.
 *  CEILING: only a pronoun-led condition is read. "Counter target spell if no mana was spent to cast it" (Nix), "destroy target nonland permanent if another permanent has the same name" (Winnow) and "if you control
 *  more creatures than that player" (Unified Will) are target conditions that open with something else; they stay effect conditions at the fixed weight (0.5). Mythos of Nethroi's "if it's a creature or if {G}{W}
 *  was spent" mixes the target with the casting and stays at 0.5 too. CEILING: the clause is found by the gate's verbatim text and split on full stops, line breaks and ", then ", so a gate text that also occurs in an
 *  earlier sentence is judged by that one. */
const PRONOUN = /^(?:it|its|that|those|their|they)\b/;
/** Day or night, and the cast itself: not conditions on the target. */
const NOT_THE_TARGET = /\b(?:night|day)\b|\bspent\b|\bwas (?:kicked|bargained|cast|paid|foretold|gifted)\b|\{| if /;

/** The text of the clause that holds `gateText` (lowercase, verbatim), up to the gate; "" when it is not there. */
function clauseBefore(oracleText: string, gateText: string): string {
  const lower = oracleText.toLowerCase().replace(/[’]/g, "'");
  const at = lower.indexOf(gateText.toLowerCase().replace(/[’]/g, "'"));
  if (at < 0) return "";
  const start = Math.max(lower.lastIndexOf(".", at), lower.lastIndexOf("\n", at), lower.lastIndexOf(", then ", at)) + 1;
  return lower.slice(start, at);
}

/** The gate is a condition on the effect's own target. */
export function isTargetCondition(oracleText: string | undefined, gateText: string): boolean {
  const gate = gateText.toLowerCase().replace(/[’]/g, "'");
  if (!oracleText || !PRONOUN.test(gate) || NOT_THE_TARGET.test(gate)) return false;
  return /\btarget\b/.test(clauseBefore(oracleText, gate));
}
