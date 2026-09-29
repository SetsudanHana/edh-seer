/** WHAT THE EVENT SEARCH CANNOT ASK, SAID WHERE IT IS ASKED (#730, roadmap AK2). The search is asked
 *  in events: what a card makes happen and what it waits for. Some things a card DOES make nothing
 *  happen that another card waits for, so no event names them, and a player who types "ramp" got
 *  either nothing or a different question's answers with no word about the gap.
 *
 *  CHECKED AGAINST THE LIVE VOCABULARY (event-frequency.json, 2026-09-29), not the list `facets.ts`
 *  wrote when the does/theme chips went. Of its six, copying a spell has become an event since
 *  (`copy|spell`, "a spell is copied"), so it is not here. Making mana, clones and extra turns have
 *  no event; drain and trigger doubling each have one nearby, and the note points at it. */
export interface Unaskable { id: string; what: string; words: RegExp; nearby?: string }

export const UNASKABLE: readonly Unaskable[] = [
  { id: "mana", what: "Making mana (ramp)", words: /\b(ramp|mana(?! value)|dork|rocks?)\b/ },
  { id: "drain", what: "Drain", words: /\bdrain/, nearby: "life is lost" },
  { id: "clone", what: "Clones", words: /\bclones?\b|\bcopy of a creature/ },
  { id: "trigger-doubling", what: "Doubling triggers", words: /\bdoubl\w*\b.*\btriggers?\b|\btrigger ?doubl/, nearby: "a triggered ability to copy" },
  { id: "extra-turn", what: "Extra turns", words: /\bextra turns?\b|\btake an extra/ },
];

/** The one sentence for what was typed, or null when it names none of the six. */
export function unaskableNote(query: string): string | null {
  const q = query.trim().toLowerCase();
  if (q.length < 3) return null;
  const hit = UNASKABLE.find((u) => u.words.test(q));
  if (!hit) return null;
  return `${hit.what} can't be searched here yet: it makes nothing happen that another card waits for, so no event names it.`
    + (hit.nearby ? ` The closest event is "${hit.nearby}".` : "");
}
