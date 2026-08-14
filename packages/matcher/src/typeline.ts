/** Card supertypes, per the comprehensive rules (plus the un-set `host`/`elite`). Everything else
 *  left of the em dash is a card type. */
const SUPERTYPES = new Set(["basic", "legendary", "ongoing", "snow", "world", "host", "elite"]);

export interface ParsedTypeLine {
  supertypes: string[];
  types: string[];
  subtypes: string[];
}

/** Split "Legendary Creature — Human Wizard" into its three parts, all lowercased.
 *
 *  Takes a SINGLE face's type line. A combined double-faced line ("A — B // C — D") splits on its
 *  first separator only, leaving "//" visible in the subtypes rather than quietly merging the two
 *  faces -- callers must pass `faces[].typeLine` for multi-faced cards.
 *
 *  Unlike `characteristics.ts`'s private splitter, supertypes are separated rather than counted as
 *  card types; unlike `hierarchy.ts`'s `buildHierarchy`, they are kept rather than discarded. */
export function parseTypeLine(typeLine: string): ParsedTypeLine {
  const sep = /\s[—–-]\s/.exec(typeLine);
  const left = sep ? typeLine.slice(0, sep.index) : typeLine;
  const right = sep ? typeLine.slice(sep.index + sep[0].length) : "";
  const words = (s: string): string[] =>
    s.trim().split(/\s+/).filter(Boolean).map((w) => w.toLowerCase());

  const supertypes: string[] = [];
  const types: string[] = [];
  for (const w of words(left)) (SUPERTYPES.has(w) ? supertypes : types).push(w);
  return { supertypes, types, subtypes: words(right) };
}

/** The WHOLE card: every face's type line, unioned and deduped, for a caller that wants what the
 *  card IS rather than what one face is.
 *
 *  `parseTypeLine` above leaves "//" visible on purpose so a caller passing a combined line is loud
 *  rather than silently wrong. `graph-projection.ts` passed `card.typeLine` whole regardless, and
 *  the deck graph paints from what it returns — 861 corpus cards carry "//" in the type line, 111 of
 *  them in the 71 calibration decks. Three symptoms, not one cosmetic bucket:
 *
 *  - "Instant // Land" has no em dash, so "//" landed in TYPES and the Type paint mode grew a
 *    literal "//" swatch. 222 cards.
 *  - Where the front face HAS subtypes the split ate everything after the first separator, so the
 *    back face's TYPE was lost entirely — Witch Enchanter // Witch-Blessed Meadow was a creature and
 *    never a land — and its words fell into subtypes. 639 cards.
 *  - Those words include the back face's card types and the em dash itself, so "creature",
 *    "enchantment" and "—" all became subtypes.
 *
 *  Splitting on " // " is a no-op for a genuinely single-faced line, and `faces` wins when the
 *  caller has it — the same fallback `graph.ts` already does per face, which is why that path was
 *  never wrong. */
export function parseTypeLineAllFaces(typeLine: string, faces?: readonly string[]): ParsedTypeLine {
  const lines = faces?.length ? faces : typeLine.split(" // ");
  const out: ParsedTypeLine = { supertypes: [], types: [], subtypes: [] };
  for (const line of lines) {
    const p = parseTypeLine(line);
    for (const k of ["supertypes", "types", "subtypes"] as const) {
      for (const v of p[k]) if (!out[k].includes(v)) out[k].push(v);
    }
  }
  return out;
}
