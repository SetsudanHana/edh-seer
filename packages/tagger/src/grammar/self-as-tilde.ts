/** A rank or honorific that precedes a given name: "Captain Jonathan Archer" is "Captain Archer" in
 *  its own text. Only these shorten to title + surname (an arbitrary first word does not). */
const TITLES = new Set(["Captain", "Dr.", "Doctor", "Ensign", "Lieutenant", "Commander", "Admiral", "General", "Counselor", "Mr.", "Mrs.", "Ms.", "Professor", "Sergeant", "Major", "Colonel", "Chief", "Sir", "Lady", "Lord"]);

/** The forms a card calls itself by, longest first: each face's full name, the part before the comma
 *  ("Gandalf" for "Gandalf, Shadow's Foe"), and title + surname ("Captain Archer" for "Captain Jonathan
 *  Archer", "Dr. Crusher" for "Dr. Beverly Crusher"). */
function selfNames(name: string, legendary = false): string[] {
  const names = new Set<string>();
  for (const face of name.split(" // ")) {
    names.add(face);
    const short = face.split(",")[0]!;
    if (short !== face) names.add(short);
    const words = short.split(" ");
    if (words.length >= 3 && TITLES.has(words[0]!)) names.add(`${words[0]} ${words[words.length - 1]}`);
    // "Grakk the Pacifist" calls itself "Grakk": a LEGENDARY card whose name has no comma and whose first word is followed by "the" (an epithet). Only a card whose type line says Legendary:
    // "Awaken the Inferno" (a sorcery) never answers to "Awaken" (its first word is a verb). The caller passes the type line; one that does not (derive's own re-reads) gets the forms above only.
    // CEILING: any legendary "Word the ..." name; the class guard (CLASS_BEFORE) and the whole-word match keep a creature type that is the first word ("each Goblin") a class.
    if (legendary && short === face && words.length >= 3 && words[1] === "the" && /^[A-Z][a-z'-]{2,}$/.test(words[0]!)) names.add(words[0]!);
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
 *  not the card.
 *  NEVER A CLASS (#1349): the card's short name used as a TYPE is the type, not the card, whenever it follows an
 *  article or quantifier (each/a/an/another/other/non-, with the adjectives a class takes between them) or is followed by
 *  "planeswalker(s)": "put a loyalty counter on each Garruk you control" (Garruk, Cursed Huntsman), "a Lukka planeswalker",
 *  "non-Gideon creatures", "for each other attacking Aurochs", "a green Lizard creature". A card never calls itself
 *  "a Garruk" or "each Garruk"; "other than Ral" is still the card.
 *  The same holds after "empower" (CR 701.71, Empower Jace): the word there is the planeswalker TYPE the keyword action names, so on a card named
 *  "Jace, ..." (Jace, Reality Sculptor: "Empower Jace X") it stays "Jace" and the keyword action reads. */
// CEILING: the adjectives a class may take between its determiner and the name are a finite list (colours, combat and
// tap states, token, legendary, P/T); a class phrase with any other adjective, or a bare "target Garruk", still reads as the card.
const CLASS_BEFORE = /(?:\b(?:each|an?|another|other)\s+|\bnon-?|\bempower\s+)(?:(?:other|attacking|blocking|tapped|untapped|nontoken|token|legendary|nonlegendary|\d+\/\d+|white|blue|black|red|green|colorless|multicolored|monocolored)\s+)*$/i;
const CLASS_AFTER = /^ planeswalkers?\b/;

export function selfAsTilde(phrase: string, name: string, typeLine?: string): string {
  let out = phrase.replace(/\bCARDNAME\b/g, "~");
  for (const n of selfNames(name, /\bLegendary\b/.test(typeLine ?? ""))) {
    out = out.replace(new RegExp(`(?<![\\w'])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?!\\w|'(?!s\\b)|'s [A-Z])`, "g"), (m, offset: number, whole: string) =>
      CLASS_BEFORE.test(whole.slice(0, offset)) || CLASS_AFTER.test(whole.slice(offset + m.length)) ? m : "~");
  }
  return out;
}
