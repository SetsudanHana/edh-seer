/** THE EFFECT LANDS ON THE PERMANENT THIS CARD IS ATTACHED TO (#1315): an Aura's "enchanted creature" (CR 303.4, Aura) or an Equipment's
 *  "equipped creature" (CR 301.5, Equipment). Read off the printed recipient, never the effect subject: see `Ability.host`. */
import type { Action } from "../canonicalize.js";

/** The effect kinds a host marker is read for: what a buff, a curse or a neutraliser does TO the thing it is attached to. */
const HOST_KINDS: ReadonlySet<string> = new Set(["pump", "debuff", "keyword-grant", "speed-increase", "type-grant", "ability-loss", "animate", "evasion"]);

/** "enchanted creature", "equipped creature", "enchanted permanent", "enchanted land": the host phrase at the START of a recipient. Not "enchanted creature's
 *  controller" (a player) and not "enchanted player" (a Curse) or a plural ("Enchanted creatures you control have shroud", Greater Auramancy: a class) and not "enchanted creature and ..." / "... or ..." (a list that is not only the host). */
const HOST_PHRASE = /^(?:enchanted|equipped) (?!(?:player|creatures|permanents|lands|artifacts|enchantments)\b)[a-z]+\b(?!['’]s| (?:and|or)\b)/i;

/** A recipient that names its own class: when the model kept the recipient in the object, the clause head is not consulted. */
const OTHER_CLASS = /^(?:all|each|every|other|another|target|the other|those|that (?:creature|permanent)|creatures?|permanents?|lands?)\b/i;

/** The verb that ends a clause's recipient: "Enchanted creature GETS", "it HAS", "enchanted creature CAN'T be blocked". */
const RECIPIENT_VERB = /^(.*?\S)\s+(?:gets?|has|have|gains?|loses?|can['’]t|cannot|is|are|becomes?)\b/i;

/** The words of a clause that precede its recipient: a trigger head ("Whenever enchanted creature attacks, ") or a condition ("As long as enchanted creature is black, ", "During your turn, "). */
const HEAD = /^(?:(?:when|whenever|at)\b[^,]*,\s*|(?:as long as|if|while|during)\b[^,]*,\s*)/i;

const PRONOUN = /^(?:it|that creature)$/i;

/** The clause STARTS with a host phrase, or a condition or trigger on one ("As long as enchanted creature is black, it gets ...", "Whenever equipped creature attacks, it gains ..."): a pronoun recipient is then the host.
 *  "Whenever this creature or equipped creature attacks, ... it" (Razorfield Ripper) opens on "this creature", so its "it" is not marked. */
function opensOnHost(clauseText: string): boolean {
  return HOST_PHRASE.test(clauseText.trim().replace(/^(?:as long as|when|whenever)\s+/i, ""));
}

// CEILING: these shapes are left unmarked, "not said" and never wrong. Census over the commander-legal Auras and Equipment (research/tagger/host-census.ts, derive 371): 56 print
// "enchanted|equipped X gets|has|gains|loses|can't ..." and derive no host ability, and 153 host-kind abilities on those cards are unmarked (102 on cards with no quote, 51 on cards with a quoted grant):
//  - a clause that MIXES recipients is judged by its first sentence's head when an action's object names none ("Enchanted creature gets +1/+1 and creatures you control gain haste"); the census
//    cannot count a wrong mark, and the other-class cards found (Inner Demon, Vampirism, the Magemarks) are separate clauses;
//  - a recipient LIST ("equipped creature and Zombies you control", Wand of Orcus, 1 card) is a list, not the host;
//  - a trigger on "this creature or equipped creature" (Razorfield Ripper, 1 card) has an "it" that may be either;
//  - the inner effect of a QUOTED grant (Dragon Mantle's "{R}: This creature gets +1/+0", `self`): only the grant clause is marked;
//  - a recipient deep inside a multi-sentence clause whose object lost it (Cocoon's "... and that creature gains flying");
//  - base P/T setters (Aettir and Priwen, Belt of Giant Strength, 2 cards derive no pump) and "doesn't untap" (Venarian Gold, Illusory Wrappings, Cocoon; 5 Auras print "has"/"have" and derive no
//    host-kind effect) derive no host-kind effect at all, and neither do the ability-loss misses (Mammoth Harness "loses flying", Blossombind, Lithoform Blight, Awesome Presence).
export function hostEffect(action: Action, effectKind: string | null | undefined, clauseText: string): boolean {
  if (!effectKind || !HOST_KINDS.has(effectKind)) return false;
  const object = (action.object ?? "").trim();
  if (HOST_PHRASE.test(object)) return true;
  // A buff's object IS its recipient ("enchanted creature +2/+0", "it"), so only a pronoun reaches back to the clause.
  if (action.verb === "modify-pt") return PRONOUN.test(object) && opensOnHost(clauseText);
  if (OTHER_CLASS.test(object)) return false;
  const body = clauseText.trim();
  // Two heads at most: "Whenever enchanted creature attacks, if its power is 2 or less, it can't be blocked" (Writ of Passage).
  const sentence = body.replace(HEAD, "").replace(HEAD, "");
  const who = RECIPIENT_VERB.exec(sentence)?.[1]?.trim();
  if (!who) return false;
  return HOST_PHRASE.test(who) || (PRONOUN.test(who) && opensOnHost(body));
}
