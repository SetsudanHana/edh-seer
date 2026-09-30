/** REFERENCES (#896, task 4): what "it", "that card", "the exiled card", "the copy" point at.
 *
 *  A reference object names no thing of its own. The walk here says WHERE its thing is -- an earlier
 *  action, the trigger's subject, or nowhere -- and `antecedentText` turns that into the text derive
 *  parses. It used to be three closures inside `deriveAbilities`, each grown for one bug; it is one
 *  module now so the resolver can be measured and changed in one place. Behaviour is unchanged from
 *  the closures at DERIVE 215 (corpus re-derived byte-identical); DERIVE 216 changed three rules, each
 *  marked #896 task 4 below. */
import type { Action, ClauseRecord } from "../canonicalize.js";
import { isSelfSubject, SELF_REFERENCE } from "./self-reference.js";
import { parseSubject } from "./subject.js";

/** AN AURA'S "ENCHANT X" LINE BOUNDS ITS "ENCHANTED PERMANENT" (UX sweep 2026-09-06, E1). Kaya's
 *  Ghostform prints `Enchant creature or planeswalker you control` and then `When enchanted
 *  permanent dies` -- and "enchanted permanent" parsed as ANY permanent, so a land dying (Fabled
 *  Passage) and an enchantment leaving (Mystic Remora, Dress Down) each "enabled" it: six false rows
 *  on the site's own example deck. The Enchant line is the only thing the permanent can be, so the
 *  subject text takes it verbatim ("enchanted creature or planeswalker you control") and the
 *  parser does the rest. Census (`bin/enchant-restriction-census.ts`): 50 cards whose subject is
 *  wider than their Enchant line, 29 derived. A card without an Enchant line, or without its text
 *  here, keeps "permanent" -- nothing is guessed. */
const ENCHANT_LINE = /^Enchant ([^\n]+)$/m;
const ENCHANTED_PERMANENT = /\benchanted permanent\b/i;
/** `enchantText` is the text the Enchant line is read from: the clause's OWN FACE when faces are
 *  known (a two-face card with two Auras must not bind face A's line to face B's clause), and the
 *  whole card otherwise. Reminder text after the line is dropped -- by string ops, not by a
 *  trailing `\s*(...)?\s*$` (CodeQL js/polynomial-redos on the first cut). */
export function boundedByEnchantLine(text: string, enchantText: string): string {
  if (!ENCHANTED_PERMANENT.test(text)) return text;
  const raw = enchantText.match(ENCHANT_LINE)?.[1];
  if (!raw) return text;
  const paren = raw.indexOf("(");
  const line = (paren >= 0 ? raw.slice(0, paren) : raw).trim().replace(/\.$/, "");
  return line ? text.replace(ENCHANTED_PERMANENT, `enchanted ${line}`) : text;
}

/** The "your library for ..." preamble a search object always carries; stripping it leaves the thing
 *  actually searched for, which is the subject the pronoun that follows refers to. */
export const PRONOUN_SOURCE = /^(?:your |their |a |an )?librar(?:y|ies)(?: for)?\s*/i;

/** Objects that name no thing of their own and inherit one from earlier in the clause. A closed list,
 *  read off the 107 untyped `enters` emits in the corpus rather than guessed: "that creature" names a
 *  type and must keep parsing as itself, so only bare back-references belong here.
 *
 *  "HER" AND "HIM" ARE PRONOUNS TOO. The Origins flip-walkers and their kin say "exile her, then
 *  return her to the battlefield" where every other card says "it"; nine corpus cards, all
 *  planeswalkers. Unlisted, "her" parsed as a noun with no class and the re-entry became an
 *  untyped `enters` with no self flag -- the wildcard shape this file's own comments warn about --
 *  so Chandra, Fire of Kaladesh "supplied" Horn of Gondor's own ETB (owner, 2026-09-08). */
export const PRONOUN_OBJECT =
  /^(?:(?:the |that |those )?(?:searched|exiled|chosen) cards?|that cards?|those cards|it|them|her|him|herself|himself|the cards?|one|one of those cards|the copy|that copy)$/i;

/** A reference to the card an imprint exiled: "the exiled card", "a card exiled with this artifact".
 *  PLURAL TOO (#896 task 4): Petradon's leaves trigger returns "the exiled cards" its enters trigger
 *  exiled, and read as its own trigger's "this creature" the flicker claimed a creature. */
export const EXILED_REF = /^(?:the exiled cards?|the imprinted card|a card exiled with (?:this|~)(?: [a-z]+)?)$/i;

/** A zone named as an object ("shuffle your library"): never what a later pronoun means. */
export const ZONE_OBJECT = /^(?:your|their|its owner's|that player's|each player's) (?:library|graveyard|hand)(?: and (?:your |their )?(?:library|graveyard|hand))?(?: into (?:your|their) library)?$/i;

/** Where a reference's thing is: an earlier action of the same clause, the clause's trigger subject,
 *  or nowhere. */
export type Source = { to: "action"; action: number } | { to: "trigger" } | { to: "none" };

/** The walk for a reference object at `actions[idx]`. See `antecedentText`.
 *
 *  A fetch is two actions: `search "your library for a Swamp or Mountain card"`, then
 *  `put "that card" onto the battlefield`. The EMIT comes from the put, whose object is a
 *  pronoun, so the enters event carried no type at all -- and an untyped producer subject is a
 *  wildcard that satisfies every consumer filter in the matcher. Windswept Heath "supplied" every
 *  enters trigger in its deck. The type is not missing, it is just on the other action.
 *  Generalised past the fetch: "exile target creature you control, then return IT to the
 *  battlefield" is the same shape, and a flicker whose emit is untyped is the same wildcard.
 *  The antecedent is the nearest EARLIER action in the clause that names a thing of its own. */
export function antecedentSource(actions: readonly Action[], idx: number, triggerSubject: string | undefined, cardName?: string): Source {
  // A REFERENCE THAT NAMES ITS VERB takes that verb's object (#860): "cast THE COPY" means what the
  // earlier `copy` copied, and "copy THE EXILED CARD" what the earlier `exile` exiled -- not the
  // nearest thing named. Surge to Victory's "creatures you control get +X/+0" sits between its
  // exile and its copy, and the nearest-object walk cast a creature.
  const own = (actions[idx]?.object ?? "").trim();
  const verb = /^(?:the|that) cop(?:y|ies)$/i.test(own) ? "copy" : /^(?:the |that |those )?exiled cards?$/i.test(own) ? "exile" : undefined;
  if (verb) {
    for (let i = idx - 1; i >= 0; i--) {
      const a = actions[i]!;
      if (a.verb !== verb) continue;
      return PRONOUN_OBJECT.test((a.object ?? "").trim()) ? antecedentSource(actions, i, triggerSubject, cardName) : { to: "action", action: i };
    }
    if (verb === "copy") return { to: "none" };
  }
  for (let i = idx - 1; i >= 0; i--) {
    const o = (actions[i]?.object ?? "").trim();
    // A ZONE IS NO THING A PRONOUN MEANS (owner's edge-magnitude sheet, 2026-09-29): The Five
    // Doctors' "put those cards onto the battlefield" found the shuffle's "your library" and
    // entered untyped, which is how it "fed" Gallifrey Stands' own ETB.
    if (o === "" || PRONOUN_OBJECT.test(o) || SELF_REFERENCE.test(o) || ZONE_OBJECT.test(o)) continue;
    return { to: "action", action: i };
  }
  // Kaya's Ghostform: "When ENCHANTED PERMANENT dies, return THAT CARD to the battlefield." The
  // antecedent is the trigger's subject, not an earlier action -- there is no earlier action.
  const t = (triggerSubject ?? "").trim();
  return t === "" || PRONOUN_OBJECT.test(t) || !namesAThing(t, cardName) ? { to: "none" } : { to: "trigger" };
}

/** A TRIGGER SUBJECT IS A REFERENT ONLY WHEN IT NAMES A THING (#896 task 4). "At the beginning of your
 *  upkeep, cast IT" (Galvanoth) and "At the beginning of the next end step, return THOSE CARDS" name a
 *  player or a time, never the card the pronoun means -- that card was revealed or exiled by text the
 *  clause did not record. Resolved to "you", the emit was an UNTYPED cast: a wildcard that fed every
 *  "whenever you cast" payoff. Unresolved is silent, which is right. 80 references (census). */
function namesAThing(t: string, cardName: string | undefined): boolean {
  if (SELF_REFERENCE.test(t) || isSelfSubject(t, cardName)) return true;
  const s = parseSubject(t);
  return s.type !== undefined || s.subtype !== undefined || s.commander === true || /\b(?:cards?|permanents?|spells?|tokens?)\b/i.test(t);
}

/** WHERE A TRIGGER'S OBJECT IS WHEN THE ABILITY RESOLVES (#896 task 4, #823). "Whenever a creature an
 *  opponent controls dies, exile IT" (Mari, the Killing Quill) exiles a card from a GRAVEYARD: the
 *  action states no zone, and without one the exile read as a creature leaving the battlefield -- a
 *  false `leaves` event, and the sentence "exiles a creature an opponent controls". */
export function zoneAfterEvent(event: string | undefined): "graveyard" | "exile" | undefined {
  if (event === "dies" || event === "put-into-graveyard" || event === "discarded" || event === "sacrificed" || event === "mill" || event === "milled") return "graveyard";
  if (event === "exiled") return "exile";
  return undefined;
}

/** The text a source names, as derive parses it. A trigger subject is BOUNDED BY THE ENCHANT LINE
 *  like the trigger itself: the returned card is the creature or planeswalker that died, so the emit
 *  says so -- without this the emit stayed "any permanent enters" and Dress Down "entered thanks to
 *  Kaya's Ghostform". */
export function antecedentText(actions: readonly Action[], source: Source, triggerSubject: string | undefined, enchantText: string): string | undefined {
  if (source.to === "action") return boundedByEnchantLine((actions[source.action]!.object ?? "").trim().replace(PRONOUN_SOURCE, ""), enchantText);
  if (source.to === "trigger") return boundedByEnchantLine((triggerSubject ?? "").trim(), enchantText);
  return undefined;
}

/** ...and the case the walk deliberately walks PAST: the nearest earlier action names the
 *  CARD, not a class. Necromancy reads `cast "this spell"` then `sacrifice "it"`, so the hunt for
 *  a class found nothing and the pronoun stayed untyped — a wildcard emit that satisfies every
 *  consumer filter, which is how a REANIMATION spell came to "fill the graveyard" for anything
 *  recursive. The antecedent is not missing here, it is the card. */
export function antecedentIsSelf(actions: readonly Action[], idx: number, cardName: string | undefined): boolean {
  for (let i = idx - 1; i >= 0; i--) {
    const o = (actions[i]?.object ?? "").trim();
    // A zone names nothing here either -- the same skip `antecedentSource` makes (review).
    if (o === "" || PRONOUN_OBJECT.test(o) || ZONE_OBJECT.test(o)) continue;
    return SELF_REFERENCE.test(o) || isSelfSubject(o, cardName);
  }
  return false;
}

/** "THE EXILED CARD" IS WHAT AN EARLIER CLAUSE EXILED (#860). Isochron Scepter exiles "an instant
 *  card with mana value 2 or less from your hand" in one clause and copies "the exiled card" in the
 *  next; Surge to Victory exiles "target instant or sorcery card" and copies it from a later
 *  trigger. The in-clause antecedent never sees across clauses, so the copy read as a CLONE (of
 *  the trigger's creature, for Surge) and its cast named nothing. Only when THIS clause exiled
 *  nothing before the reference: an in-clause exile is the nearer antecedent (Identity Thief).
 *
 *  Called once per clause, in order. Returns the clause with those references rewritten to what was
 *  exiled, and the exile the next clause refers back to. */
export function exiledAcrossClauses(clause: ClauseRecord, lastExiled: string | undefined, cardName: string | undefined): { clause: ClauseRecord; lastExiled: string | undefined } {
  const before = clause.actions ?? [];
  const refersBack = (a: Action, i: number): boolean =>
    EXILED_REF.test((a.object ?? "").trim()) && !before.slice(0, i).some((b) => b.verb === "exile");
  if (lastExiled && before.some(refersBack)) {
    const from = lastExiled;
    clause = { ...clause, actions: before.map((a, i) => refersBack(a, i) ? { ...a, object: from } : a) };
  }
  for (const a of clause.actions ?? []) {
    const o = (a.object ?? "").trim();
    if (a.verb === "exile" && o && !PRONOUN_OBJECT.test(o) && !SELF_REFERENCE.test(o) && !isSelfSubject(o, cardName)) lastExiled = o;
  }
  return { clause, lastExiled };
}
