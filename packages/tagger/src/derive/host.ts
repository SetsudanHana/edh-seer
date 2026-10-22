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

/** The clause STARTS with a host phrase, or a condition on one ("As long as enchanted creature is black, it gets ..."): a pronoun recipient is then the host. */
function opensOnHost(clauseText: string): boolean {
  return HOST_PHRASE.test(clauseText.trim().replace(/^as long as\s+/i, ""));
}

/** LIMITS (stated here and on `Ability.host`): a trigger head ("Whenever equipped creature attacks, it gets +1/+0") is not a host opening, so its "it" is unmarked; a clause that mixes recipients
 *  ("Enchanted creature gets +1/+1 and creatures you control gain haste") marks an action whose object states no recipient by the clause head alone. */
export function hostEffect(action: Action, effectKind: string | null | undefined, clauseText: string): boolean {
  if (!effectKind || !HOST_KINDS.has(effectKind)) return false;
  const object = (action.object ?? "").trim();
  if (HOST_PHRASE.test(object)) return true;
  // A buff's object IS its recipient ("enchanted creature +2/+0", "it"), so only a pronoun reaches back to the clause.
  if (action.verb === "modify-pt") return PRONOUN.test(object) && opensOnHost(clauseText);
  if (OTHER_CLASS.test(object)) return false;
  const body = clauseText.trim();
  const sentence = body.replace(HEAD, "");
  const who = RECIPIENT_VERB.exec(sentence)?.[1]?.trim();
  if (!who) return false;
  return HOST_PHRASE.test(who) || (PRONOUN.test(who) && opensOnHost(body));
}
