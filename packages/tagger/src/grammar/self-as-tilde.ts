/** A rank or honorific that precedes a given name: "Captain Jonathan Archer" is "Captain Archer" in
 *  its own text. Only these shorten to title + surname (an arbitrary first word does not). */
const TITLES = new Set(["Captain", "Dr.", "Doctor", "Ensign", "Lieutenant", "Commander", "Admiral", "General", "Counselor", "Mr.", "Mrs.", "Ms.", "Professor", "Sergeant", "Major", "Colonel", "Chief", "Sir", "Lady", "Lord"]);

/** The forms a card calls itself by, longest first: each face's full name, the part before the comma
 *  ("Gandalf" for "Gandalf, Shadow's Foe"), and title + surname ("Captain Archer" for "Captain Jonathan
 *  Archer", "Dr. Crusher" for "Dr. Beverly Crusher"). */
function selfNames(name: string): string[] {
  const names = new Set<string>();
  for (const face of name.split(" // ")) {
    names.add(face);
    const short = face.split(",")[0]!;
    if (short !== face) names.add(short);
    const words = short.split(" ");
    if (words.length >= 3 && TITLES.has(words[0]!)) names.add(`${words[0]} ${words[words.length - 1]}`);
  }
  return [...names].sort((a, b) => b.length - a.length);
}

/** Pronouns for the card in a clause whose subject is the card by name: "Whenever Beckett Mariner becomes
 *  tapped, put a promotion counter on her". Replaced only while nothing earlier in the effect could be
 *  their antecedent (a target, "that creature", a chosen or enchanted object, another or other one). */
const PRONOUN = /\b(?:he|she|him|her|his)\b/gi;
const OTHER_ANTECEDENT = /\b(?:target|chosen|enchanted|equipped|another|other|each|all|opponents?|players?)\b|\b(?:that|those) (?:creatures?|players?|permanents?|opponents?|planeswalkers?)\b/i;

/** The card's pronouns in `effect` as "~" (see PRONOUN). The caller vouches that the clause's subject is
 *  the card's own name.
 *  CEILING: "his" is never converted, and neither is any "her" followed by a lowercase word (it may be a possessive,
 *  "her power", or an object, "return her to the battlefield", Hellcat, Undying Vigilante: the clause is left unread
 *  rather than half converted). "he"/"she" are converted whatever follows and "him" always; "her" is converted
 *  unless a lowercase word other than and/then/or/if/unless/until/for follows.
 *  The contractions "She's" / "He's" are converted too, to "~'s" (the "she"/"he" is the word, the "'s" stays), which reads as the card's
 *  possessive ("~'s power") rather than "~ is": Princess Yue, Fang and Bruce Banner print one. All three are model-derived today, so this is inert; a card
 *  that reaches the grammar with one is read by that possessive. */
export function selfPronouns(effect: string): string {
  let out = "";
  let last = 0;
  for (const m of effect.matchAll(PRONOUN)) {
    const before = effect.slice(0, m.index);
    if (OTHER_ANTECEDENT.test(before.replace(/~/g, ""))) break;
    const word = m[0].toLowerCase();
    const after = effect.slice(m.index + m[0].length);
    if (word === "his" || (word === "her" && /^ [a-z]/.test(after) && !/^ (?:and|then|or|if|unless|until|for)\b/.test(after))) continue;
    out += effect.slice(last, m.index) + "~";
    last = m.index + m[0].length;
  }
  return out + effect.slice(last);
}

/** THE CARD'S OWN NAME WRITTEN "~" (Scryfall's convention), as the phrase census writes it (#896).
 *  The filter grammar was built and measured on census phrases, so derive hands it the same shape:
 *  one function, so the census and the switch cannot drift apart.
 *
 *  Each face's full name and its short forms (`selfNames`), longest first, whole-word, with a
 *  possessive kept ("Picard's power" is "~'s power"), unless a Capitalised word follows it: "Volo's Journal"
 *  is another object's name, not the card's; the literal "CARDNAME" is the name too.
 *  CASE-SENSITIVE: Oracle capitalises a name, and Storm, Force of Nature's "has storm" is the keyword,
 *  not the card. */
export function selfAsTilde(phrase: string, name: string): string {
  let out = phrase.replace(/\bCARDNAME\b/g, "~");
  for (const n of selfNames(name)) {
    out = out.replace(new RegExp(`(?<![\\w'])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?!\\w|'(?!s\\b)|'s [A-Z])`, "g"), "~");
  }
  return out;
}
