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
