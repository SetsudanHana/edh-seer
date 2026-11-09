import type { Ability } from "../schema.js";
import { isSelfSubject } from "./self-reference.js";
import { withoutParentheses } from "./reminder.js";

/** ABILITIES THAT EXIST ONLY IF THE CARD WAS CAST, AND AURA TRIGGERS THAT ACT ON A HOST THAT HAS ALREADY GONE (#1513). Two small facts the matcher cannot read off the stored emits.
 *
 *  `castOnly`: (a) the card's own text turns away every entry that is not a cast ("If this creature would enter and it wasn't cast or no mana was spent to cast it, exile it instead":
 *  Primeval Spawn), so nothing a card puts onto the battlefield is it and none of its triggers can fire for it; (b) the ability is GRANTED by a clause that is the card's own cast trigger
 *  ("When you cast this spell, ... Thief of Existence gains 'When this creature leaves the battlefield, ...'"), so a Thief that was put onto the battlefield has no such trigger.
 *  `actsOnHost`: an Aura's own leaves / dies trigger whose effect names the permanent it was attached to ("destroy enchanted creature": Parallax Dementia; "enchanted permanent's controller
 *  sacrifices it": Reality Acid). When the Aura left BECAUSE its host did (CR 704.5m) the host is already gone and the trigger has nothing to act on.
 *
 *  CEILING: (a) reads only a SELF "would enter ... wasn't cast ... exile it instead" line (a class-wide one, Containment Priest, is not the card's own); a card that merely loses an ability when
 *  it is not cast (Hypnox's "if you cast it from your hand", a Champion's behold cost) is not marked, because its leave trigger still fires. (b) reads a grant clause whose trigger is the card's own
 *  cast, whoever the grantee is. `actsOnHost` reads the noun "enchanted <type>" in the sentence after the trigger's comma. Linear scans only: no regex touches the unbounded card text. */
export function neverEntersUncast(oracleText: string, cardName?: string): boolean {
  for (const line of withoutParentheses(oracleText).replace(/’/g, "'").split("\n")) {
    const s = line.trim().toLowerCase();
    if (!s.startsWith("if ")) continue;
    const at = s.indexOf(" would enter");
    if (at < 0 || !isSelfSubject(s.slice(3, at), cardName)) continue;
    const rest = s.slice(at);
    if (rest.includes("wasn't cast") && rest.includes("exile it instead")) return true;
  }
  return false;
}

export function stampCastOnly(a: Ability, all: readonly Ability[], entersOnlyCast: boolean): Ability {
  if (a.trigger === undefined) return a;
  if (entersOnlyCast) return { ...a, castOnly: true };
  const grantedByOwnCast = a.grantedBy !== undefined && all.some((x) => x.clause === a.grantedBy && x.trigger?.verbs.includes("cast") === true && x.trigger.subject.self === true);
  return grantedByOwnCast ? { ...a, castOnly: true } : a;
}

const HOST_NOUN = /\benchanted (?:creature|permanent|land|artifact|enchantment|planeswalker|battle)\b/i;
export function stampActsOnHost(a: Ability, clauseText: string | undefined, isAura: boolean): Ability {
  if (!isAura || clauseText === undefined || a.trigger?.subject.self !== true || !a.trigger.verbs.some((v) => v === "leaves" || v === "dies")) return a;
  const comma = clauseText.indexOf(",");
  return comma >= 0 && HOST_NOUN.test(clauseText.slice(comma + 1)) ? { ...a, actsOnHost: true } : a;
}
