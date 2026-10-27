/** AN OPTIONAL-COST CHOICE IS THE PLAYER'S, NOT CHANCE'S (owner ruling 2026-10-27, #1357): "If this spell was kicked, draw a card" (Into the Roil), "If this creature was kicked, it enters with two +1/+1 counters on it" (Pixie
 *  Illusionist), "If this spell was bargained" (Archon's Glory), "If the gift was promised" (Mind Spiral). Whether the effect happens is decided when the card is cast, by paying the extra cost, so the gated effect counts
 *  WHOLE and the report says "when kicked" (basis `choice`), the same way a condition on the target is whole and flagged `narrow`.
 *  Recognised by the WORDS of the gate, one bounded regex, no card names. NOT here: "if {R} was spent to cast this spell" (the deck's mana decides, not a choice of cost: stays at the fixed weight) and "if this spell was
 *  cast from your hand" (a zone, not a cost).
 *  CEILING: "the {1}{B} cost was paid" (Baleful Mastery's alternative cost) is read as a choice by its wording; a mandatory additional cost followed by "if its additional cost was paid" would be too (no corpus card prints it). */
const CHOICE = /\b(?:was|were) (?:kicked|multikicked|bargained|overloaded|evoked)\b|\bgift was promised\b|\badditional cost was paid\b|\bthe (?:\{[^}]{1,6}\}){1,6} cost was paid\b/;

export function isChoiceCondition(gateText: string): boolean {
  return CHOICE.test(gateText.toLowerCase());
}

