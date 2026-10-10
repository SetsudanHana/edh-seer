import type { GameEvent } from "@edh-seer/tagger";
import { impliedSubjectKey } from "@edh-seer/tagger/schema";

/** THE CENSUS AND SUGGESTIONS' WILDCARD: "a subject of any kind". It is a string no stored tag can be,
 *  so a demand row that matches everything and a tag that names no class are never the same thing
 *  (#1166; before it both were `:any`). */
export const WILDCARD_SUBJECT = "*";

/** Canonicalize a zone-transition event. The `enters` verb ALWAYS means "enters the battlefield",
 *  so its zone is forced to battlefield (some tags erroneously put a source zone on an enters
 *  emit, e.g. Muldrotha). `enters-graveyard` is the legacy spelling of `enters@graveyard`.
 *
 *  `dies` and `leaves` are TWO verbs. CR 700.4: dies means "is put into a graveyard from the
 *  battlefield"; CR 603.6c: a leaves-the-battlefield ability triggers on a move to ANY zone. So a
 *  death is one kind of leave, and `eventMatches` lets a `leaves` demand accept a `dies` supply --
 *  never the reverse. Until 2026-09-05 this function rewrote `dies` INTO `leaves@battlefield` on
 *  both sides, which made the two one event: harmless only while nothing emitted `leaves` (0
 *  corpus emits against 3,240 `dies`), and the moment a flicker did, Ephemerate would have fed
 *  Blood Artist. Both verbs are stamped `battlefield` when they state no zone; a `leaves` whose
 *  subject already names a zone ("leave your graveyard") keeps it. */
export function normalizeZoneEvent(e: GameEvent): GameEvent {
  switch (e.verb) {
    case "enters":
      return { ...e, verb: "enters", subject: { ...e.subject, zone: "battlefield" } };
    case "enters-graveyard":
      return { ...e, verb: "enters", subject: { ...e.subject, zone: "graveyard" } };
    case "dies":
      return { ...e, subject: { ...e.subject, zone: "battlefield" } };
    case "leaves":
      return e.subject.zone === undefined ? { ...e, subject: { ...e.subject, zone: "battlefield" } } : e;
    default:
      return e;
  }
}

/** The reason-tag grouping key for a canonical zone event, kept in legacy spelling so the
 *  CATEGORY_MATCH table and theme labels don't change: enters@battlefield -> enters:key,
 *  enters@graveyard -> enters-graveyard:key, leaves@graveyard -> leaves-graveyard:key. `dies` and a
 *  battlefield `leaves` key on their own verb -- the same strings every cached panel verdict was
 *  written against. */
export function zoneEventKey(verb: string, zone: string | undefined, subjectKey: string): string {
  // A MOVE FROM OR TO ANOTHER ZONE IS A CARD'S, NOT A PERMANENT'S: "leaves your graveyard" and
  // `enters-graveyard` name cards, so only the battlefield zone (or none stated) implies a permanent.
  const offBattlefield = (verb === "enters" || verb === "leaves") && zone !== undefined && zone !== "battlefield";
  return zoneEventKeyRaw(verb, zone, offBattlefield ? subjectKey : impliedSubjectKey(verb, subjectKey));
}

/** `zoneEventKey` without the implied class: the census's own row keys, whose untyped subject is
 *  `WILDCARD_SUBJECT`, because they COUNT shapes and `suggest-keys.ts` reads the wildcard as "every
 *  subject". Tags a player sees use `zoneEventKey`, which fills `VERB_IMPLIED_CLASS` (#1166). */
export function zoneEventKeyRaw(verb: string, zone: string | undefined, subjectKey: string): string {
  if (verb === "enters" && zone === "graveyard") return `enters-graveyard:${subjectKey}`;
  if (verb === "leaves" && zone === "graveyard") return `leaves-graveyard:${subjectKey}`;
  return `${verb}:${subjectKey}`;
}
