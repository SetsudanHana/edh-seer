/** ABILITY RESTRICTIONS (#1349 task 3): the sentence that limits WHEN or HOW OFTEN an ability may be used,
 *  and does nothing else. The bought clauses drop it -- "{G}, Sacrifice a Food: Put a +1/+1 counter on
 *  target creature. Activate only as a sorcery." stores [sacrifice, add-counter] -- and derive reads the
 *  restriction from the clause's PRINTED text, never from an action (`SORCERY_SPEED` in derive.ts, the
 *  "once each turn" rule in repeats.ts, "Activate only if" in threshold.ts and mana-lines.ts). So the
 *  action grammar absorbs the sentence as a rider that claims nothing, and `clauseTexts` still hands
 *  derive the whole printed clause, restriction included: the grammar path keeps the text, the readers see it.
 *
 *  The family is CR 602.5 (an activated ability's restriction: "Activate only once each turn", "only as a sorcery",
 *  "only as an instant"), CR 603.2h ("Do this only once each turn")
 *  and the printed "This ability triggers only once each turn". Pure; no model. */

/** One limit inside a restriction: a timing ("only as a sorcery", "only during your upkeep", "only before
 *  attackers are declared"), a frequency ("only once each turn", "no more than twice each turn") or a
 *  condition ("only if you control three or more artifacts"). The condition's words are not read here:
 *  `thresholdFor` reads a count off the printed clause, and a condition it cannot read stays unread
 *  there exactly as it does for a stored clause. */
const LIMIT = /^(?:only as an? (?:sorcery|instant)|only (?:once|twice)(?: each (?:turn|combat))?|no more than (?:once|twice|\w+ times?) each (?:turn|combat)|only (?:during|before|after|on|while|when) (?:(?!\band\b)[a-z0-9' ,-])+|only if .+)$/i;

/** The limits of one sentence's tail: "only as a sorcery and only once each turn", "only during your turn,
 *  before attackers are declared and only if you control a Swamp". Split where the NEXT limit begins
 *  (", only", " and only", " and no more than"), never on a bare comma or "and": a timing may list
 *  ("before attackers are declared"), a condition may join clauses of its own. */
function limitsOf(tail: string): string[] {
  return tail.split(/(?:, and |, | and )(?=only\b|no more than\b)/i);
}

/** What stands in front of the limits: who is bound, and by what. */
const HEADS = [
  /^activate(?: this ability)? /i,
  /^you may activate (?:each of those abilities|each of these abilities|this ability|these abilities) /i,
  /^this ability triggers /i,
  /^do this /i,
  // "Only your opponents may activate this ability and only as a sorcery" (Detention Vortex), "Only the
  // player this creature is attacking may activate this ability and only during the declare attackers step".
  /^only (?:your opponents|you|the player [a-z ']{1,40}|any player|each opponent|an opponent) may activate this ability /i,
];

/** Whether a sentence (its final period already cut) is an ability restriction and nothing more. */
export function isRestrictionSentence(sentence: string): boolean {
  const s = sentence.trim().replace(/\.$/, "");
  for (const [i, head] of HEADS.entries()) {
    const m = head.exec(s);
    if (!m) continue;
    const tail = s.slice(m[0].length);
    // A "may activate this ability" head is followed by its own "and only ..." limits, the others by the limits directly.
    const limits = limitsOf(i === HEADS.length - 1 ? tail.replace(/^and /i, "") : tail);
    return limits.length > 0 && limits.every((l) => LIMIT.test(l.trim()));
  }
  return false;
}

/** A PREFIX THAT LIMITS A PERMISSION TO ONE USE A TURN: "Once during each of your turns, you may cast a creature
 *  spell from your graveyard" (Karador), "Once each turn, you may play ...". The store reads the permission and
 *  drops the prefix, so this returns the sentence without it (or the sentence unchanged). The permission is a
 *  static grant, which `repeatsFor` calls continuous on the stored path too. */
export function withoutOncePrefix(sentence: string): string {
  return sentence.replace(/^once (?:during each of your turns|during each turn|each turn), (?=you may\b)/i, "");
}
