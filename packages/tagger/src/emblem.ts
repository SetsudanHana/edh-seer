/** THE EMBLEM VOCABULARY, in one place (spec 2026-09-08, emblems as nodes).
 *
 *  CR 114.1: an emblem is a marker for an object with abilities and usually no other
 *  characteristics, put into the command zone. CR 114.2: "[Player] gets an emblem with [ability]"
 *  means that player puts it there, and owns and controls it. Not a permanent, not a token, not a
 *  card. Until 2026-09-08 the derive layer folded the `emblem` verb into `token-generation`, so
 *  86 planeswalkers read "makes a token" and Chandra, Roaring Flame's emblem trigger sat on Chandra
 *  as her own ability with control `you`.
 *
 *  SCRYFALL TREATS AN EMBLEM AS AN OBJECT. It has its own oracle id, layout `emblem`, and oracle
 *  text equal to the granted ability; the granting card's `allParts` names it as a `combo_piece`
 *  with an "Emblem — <name>" type line. That is the same exact join tokens use, so an emblem gets
 *  a node the way a token does, and its content comes from its own printed text. */

/** An `allParts` entry that names an emblem. A `combo_piece` pointing at a real card (a meld half,
 *  a checklist card) is what the token path excludes, and it stays excluded here. */
export function isEmblemPart(p: { component?: string; typeLine?: string }): boolean {
  return p.component === "combo_piece" && /^Emblem\b/.test(p.typeLine ?? "");
}

export function hasEmblemPart(allParts: readonly { component?: string; typeLine?: string }[] | undefined): boolean {
  return (allParts ?? []).some(isEmblemPart);
}

/** The printed grant, CR 114.2's own template. Anchored on the two words so a granted ability's
 *  text that merely mentions an emblem ("this emblem deals 3 damage") cannot match. */
export const GETS_AN_EMBLEM = /\bgets? an emblem\b/i;

/** Who the emblem goes to, read off the sentence that grants it, because the clause object usually
 *  says only "an emblem". Three corpus shapes hand it to someone else: "each opponent", "target
 *  opponent", and Chandra's "each player dealt damage this way". "Target player" is YOURS: the
 *  ordinary case is pointing it at yourself, the same reason a plain "create" counts as yours in
 *  `createsForYou` (matcher). Anything the regex does not see is `you`, the CR 114.2 default. */
const OPPONENT_GETS = /\b(?:each|target)\s+opponent\b[^.]*?\bgets? an emblem|\beach player dealt damage\b[^.]*?\bgets? an emblem/i;

export function emblemRecipient(text: string): "you" | "opp" {
  return OPPONENT_GETS.test(text) ? "opp" : "you";
}
