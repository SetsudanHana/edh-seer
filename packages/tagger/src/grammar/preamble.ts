/** THE PRINTED TRIGGER PREAMBLE of a clause (#896, task 5): the trigger word and everything up to
 *  the comma that ends the trigger condition, the card's name written "~". One function, so the
 *  census (`bin/extract-triggers.ts`) and derive's switch read the same shape the trigger grammar
 *  was measured on. */
import { withoutArticle } from "../derive/self-reference.js";
import { SUBTYPES } from "../derive/subtypes.js";
import { selfAsTilde } from "./self-as-tilde.js";

/** A comma inside a short list ("whenever you cast an instant, sorcery, or Wizard spell,") does not
 *  end the preamble: one followed by list items of one or two words and then ", or" / ", and", one
 *  that is itself ", or" / ", and" before a short item, or one between two "non-" adjectives ("a
 *  noncreature, nonland card", "a nontoken, non-Angel creature"). An EFFECT that is itself a list
 *  ("at the beginning of your upkeep, choose flying, first strike, ...", "whenever you gain life,
 *  each Advisor, Artificer, and Monk ...") opens with a verb or "each", which never continues one,
 *  and items are one or two words. CEILING: a list of longer verb phrases ends the preamble at its
 *  first comma (Repeated Reverberation: "when you next cast an instant spell, cast a sorcery spell,
 *  or activate a loyalty ability"), and the trigger reads its first item only.
 *  and a list never continues after a whole "spell" or "card" ("whenever you cast a noncreature
 *  spell, Birds, Frogs, Otters, and Rats you control get +1/+1"). */
const PREAMBLE = /^\s*((?:whenever|when|at the beginning of|at end of)\b(?:[^,]|(?<!\b(?:spells?|cards?)), (?!(?:each|choose|you|target|draw|create|put|return|exile|it|that|this|up to) )(?=(?:[^, ]+(?: [^, ]+)?, )+(?:or|and|and\/or) )|, (?:or|and|and\/or) (?=[^,]+,)|, (?=non-?[a-z]+ [a-z]+))*),/i;

/** A card with no comma in its name still shortens itself to its first word ("When Imskir enters",
 *  Imskir Iron-Eater) -- the rule `isSelfSubject` already reads, never for a creature type or an
 *  article ("Whenever a Goblin enters" on Goblin Bombardment is the class). */
function shortNameAsTilde(preamble: string, name: string): string {
  let out = preamble;
  for (const face of name.split(" // ")) {
    // "Rosie Cotton OF SOUTH LANE" shortens to the words before "of", as a comma name does.
    const before = /^(\p{Lu}[\p{L}'-]*(?: \p{Lu}[\p{L}'-]*)+) of /u.exec(face.trim())?.[1];
    if (before) out = out.replace(new RegExp(`(?<=(?:^(?:When|Whenever)| or| and| by| on) )${before.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?= [a-z]|$)`, "gu"), "~");
    const first = withoutArticle(face.trim()).split(/[\s,]+/)[0] ?? "";
    if (first.length < 3 || SUBTYPES.has(first.toLowerCase()) || !/^\p{Lu}/u.test(first)) continue;
    // Only where a subject stands (after the trigger word, "or", "and", "by", "on") and a lower-case
    // word or the end follows: "Rosie Cotton" is not "~ Cotton", "named Labyrinth of Skophos" is not
    // the card.
    out = out.replace(new RegExp(`(?<=(?:^(?:When|Whenever)| or| and| by| on) )${first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?= [a-z]|$)`, "gu"), "~");
  }
  return out;
}

/** An ABILITY WORD label ("Do You Like Squirrels? — ", "The Seven-fold Chant — ") names the ability and
 *  does nothing: the text without it. The spaced em dash, a capitalised label of at most 40 characters
 *  made of words, apostrophes, commas, "?", "!" and hyphens -- never a ".", ":" or a brace, which
 *  would make it a sentence, a cost or a mana symbol. The ONE rule `parseActions` reads too. */
export function withoutAbilityWord(text: string): string {
  const dash = text.indexOf(" — ");
  return dash > 0 && dash <= 41 && /^[A-Z~][\w' ,~?!-]*$/.test(text.slice(0, dash)) ? text.slice(dash + 3) : text;
}

/** AN ACTIVATED ABILITY THE SEGMENTER LEFT STATIC AND COST-LESS: its cost and effect, the pair `segment()`
 *  would have produced. Two ways it misses one:
 *  - behind a label its `ABILITY_WORD` does not strip ("I LOVE Squirrels! — {1}{G}{G}{G}: Create ...").
 *    Only a cost of MANA ALONE is taken here: a tap or sacrifice behind such a label is refused by the
 *    caller.
 *  - an ENERGY payment it does not know as a cost ("{T}, Pay {E}{E}{E}: ...", "Pay {E}{E}: ..."), then a
 *    colon and a capital -- the shape `parseActions` takes for a cost left in the text. CEILING: energy
 *    only; a tap or sacrifice cost left in (Wall of Roots) stays as the segmenter classed it, because
 *    recording it activated moved bought cards off the grammar's reading.
 *  Callers pass a clause the segmenter classed static with no cost. */
export function missedCost(text: string): { cost: string; effect: string } | null {
  const bare = withoutAbilityWord(text);
  const labelled = bare !== text;
  const colon = bare.indexOf(": ");
  if (colon <= 0) return null;
  const prefix = bare.slice(0, colon);
  if (/[."]/.test(prefix) || !/^[A-Z]/.test(bare.slice(colon + 2))) return null;
  const mana = /^(?:\{(?:\d+|[WUBRGCSX]|[WUBRG]\/[WUBRGP])\})+$/.test(prefix);
  const ok = labelled ? mana : /\bPay (?:X )?(?:\{E\})+/.test(prefix);
  return ok ? { cost: prefix, effect: bare.slice(colon + 2) } : null;
}

/** The preamble of a triggered clause's printed text, or null when the text opens with no trigger
 *  word. The name becomes "~" BEFORE the cut: a name with a comma ("Gisela, the Broken Blade") would
 *  otherwise end it. */
export function printedPreamble(text: string, cardName: string): string | null {
  text = withoutAbilityWord(text);
  const m = PREAMBLE.exec(cardName ? selfAsTilde(text, cardName) : text);
  return m ? (cardName ? shortNameAsTilde(m[1]!.trim(), cardName) : m[1]!.trim()) : null;
}

/** THE EFFECT a clause prints (#896 task 6): its text with the card's name as "~", after the trigger
 *  preamble and an intervening "if ...," when it has them. An activated clause's text already
 *  excludes its cost (`segment()` keeps that apart). */
export function effectText(text: string, cardName: string): string {
  text = withoutAbilityWord(text);
  // A TOKEN's name is its type ("Rat"): "for each other Rat you control" is the class, never the card.
  const typeName = cardName.split(" ").every((w) => SUBTYPES.has(w.toLowerCase()));
  const named = cardName && !typeName ? selfAsTilde(text, cardName) : text;
  const m = PREAMBLE.exec(named);
  const rest = m ? named.slice(m[0].length).trim() : named.trim();
  return m ? rest.replace(/^if [^,.]+, /i, "") : rest;
}
