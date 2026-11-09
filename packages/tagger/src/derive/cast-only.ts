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
 *  CEILING: (a) reads only a SELF "would enter ... wasn't cast ... exile it instead" line (a class-wide one, Containment Priest, is not the card's own). (c) A leave trigger that returns what a cast-only exile took
 *  (#1581, `exileIsCastOnly`: Hypnox, the Champions) is marked too: it fires, but returns nothing for a card that was not cast. (b) reads a grant clause whose trigger is the card's own
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

/** THE EXILE THAT A LEAVE TRIGGER GIVES BACK HAPPENS ONLY WHEN THE CARD IS CAST (#1581, owner ruling 2026-11-09). Two printed shapes, both read by line:
 *  an exile in the ADDITIONAL CASTING COST ("As an additional cost to cast this spell, behold a Kithkin and exile it": the five Champions), and an enters trigger gated on the cast whose payload exiles ("When this creature enters,
 *  if you cast it from your hand, exile all cards from target opponent's hand": Hypnox). A copy of the card that entered any other way exiled nothing, so the leave trigger that returns "the exiled card(s)" returns nothing.
 *  CEILING: the line shape only, not what is exiled: an exile in the cost or after the cast gate that the leave trigger does not return (no such card in the corpus: Furnace Dragon, Angel of the Dire Hour have no return) would be
 *  marked too if a return were added. Linear scans of the printed lines; no regex touches the card text. */
export function exileIsCastOnly(oracleText: string): boolean {
  const lines = withoutParentheses(oracleText).replace(/’/g, "'").split("\n").map((l) => l.trim().toLowerCase());
  // The card must also say the return, or there is nothing for the leave trigger to refuse.
  if (!lines.some((s) => (s.startsWith("when ") || s.startsWith("whenever ")) && s.includes(" leaves the battlefield,") && s.includes("return the exiled"))) return false;
  for (const s of lines) {
    if (s.startsWith("as an additional cost to cast this spell") && s.includes("exile")) return true;
    if (!s.startsWith("when ") && !s.startsWith("whenever ")) continue;
    for (const gate of [", if you cast ", ", if it was cast,"]) {
      const at = s.indexOf(gate);
      if (at > 0 && s.slice(0, at).includes(" enter") && s.indexOf("exile", at + gate.length) > 0) return true;
    }
  }
  return false;
}

/** A SELF LEAVE TRIGGER THAT RETURNS "THE EXILED CARD(S)" (#1581), judged on its printed clause when the clause text is known (`exileIsCastOnly` has already found the return line on the card).
 *  CEILING: a clause id with no printed text (a stored row whose ids the segmenter does not share) is taken as the return; a card with a second self leave trigger would be marked on both. None in the corpus. */
export function returnsExiledCards(a: Ability, clauseText: string | undefined): boolean {
  return a.trigger?.subject.self === true && a.trigger.verbs.includes("leaves") && (clauseText === undefined || clauseText.toLowerCase().includes("return the exiled"));
}

export function stampCastOnly(a: Ability, all: readonly Ability[], entersOnlyCast: boolean, exileCastOnly = false, clauseText?: string): Ability {
  if (a.trigger === undefined) return a;
  if (entersOnlyCast) return { ...a, castOnly: true };
  if (exileCastOnly && returnsExiledCards(a, clauseText)) return { ...a, castOnly: true };
  const grantedByOwnCast = a.grantedBy !== undefined && all.some((x) => x.clause === a.grantedBy && x.trigger?.verbs.includes("cast") === true && x.trigger.subject.self === true);
  return grantedByOwnCast ? { ...a, castOnly: true } : a;
}

const HOST_NOUN = /\benchanted (?:creature|permanent|land|artifact|enchantment|planeswalker|battle)\b/i;
export function stampActsOnHost(a: Ability, clauseText: string | undefined, isAura: boolean): Ability {
  if (!isAura || clauseText === undefined || a.trigger?.subject.self !== true || !a.trigger.verbs.some((v) => v === "leaves" || v === "dies")) return a;
  const comma = clauseText.indexOf(",");
  return comma >= 0 && HOST_NOUN.test(clauseText.slice(comma + 1)) ? { ...a, actsOnHost: true } : a;
}
