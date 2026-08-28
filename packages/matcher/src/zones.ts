import type { GameEvent } from "@edh-seer/tagger";

/** Canonicalize a zone-transition event. The `enters` verb ALWAYS means "enters the battlefield",
 *  so its zone is forced to battlefield (some tags erroneously put a source zone on an enters
 *  emit, e.g. Muldrotha). `enters-graveyard` and `dies` are legacy spellings of `enters@graveyard`
 *  and `leaves@battlefield`. All other verbs pass through untouched. */
export function normalizeZoneEvent(e: GameEvent): GameEvent {
  switch (e.verb) {
    case "enters":
      return { ...e, verb: "enters", subject: { ...e.subject, zone: "battlefield" } };
    case "enters-graveyard":
      return { ...e, verb: "enters", subject: { ...e.subject, zone: "graveyard" } };
    case "dies":
      return { ...e, verb: "leaves", subject: { ...e.subject, zone: "battlefield" } };
    default:
      return e;
  }
}

/** The reason-tag grouping key for a canonical zone event, kept in legacy spelling so the
 *  CATEGORY_MATCH table and theme labels don't change: enters@battlefield -> enters:key,
 *  enters@graveyard -> enters-graveyard:key, leaves@battlefield -> dies:key. */
export function zoneEventKey(verb: string, zone: string | undefined, subjectKey: string): string {
  if (verb === "enters" && zone === "graveyard") return `enters-graveyard:${subjectKey}`;
  if (verb === "leaves" && zone === "battlefield") return `dies:${subjectKey}`;
  return `${verb}:${subjectKey}`;
}
