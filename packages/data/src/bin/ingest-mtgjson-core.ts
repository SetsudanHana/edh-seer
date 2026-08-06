/** Selects the MTGJSON fields worth merging onto our Scryfall-based cards, and keys them by oracle
 *  id so the join needs no name matching.
 *
 *  The join is exact: our `cards._id` IS the Scryfall oracle id, and every AtomicCards face carries
 *  `identifiers.scryfallOracleId`. That matters — name matching is what made SLD and Universes
 *  Beyond flavour names painful, and this avoids it entirely.
 *
 *  Pure, so the field selection can be tested without a 158MB download or a database.
 */

/** One AtomicCards face. Only the fields we read are declared. */
export interface AtomicFace {
  identifiers?: { scryfallOracleId?: string };
  types?: string[];
  supertypes?: string[];
  subtypes?: string[];
  producedMana?: string[];
  rulings?: { date: string; text: string }[];
  edhrecSaltiness?: number;
  leadershipSkills?: Record<string, boolean>;
  loyalty?: string;
  defense?: string;
  isFunny?: boolean;
  isOnlineOnly?: boolean;
  relatedCards?: { tokens?: string[]; spellbook?: string[] };
}

/** What gets written onto a card document. Deliberately NOT `keywords`, `colors`, `legalities`,
 *  `layout` or anything else Scryfall already gives us — this adds, it does not overwrite. A second
 *  source silently disagreeing with the first is worse than a missing field. */
export interface MtgjsonFields {
  types?: string[];
  supertypes?: string[];
  subtypes?: string[];
  producedMana?: string[];
  rulings?: { date: string; text: string }[];
  edhrecSaltiness?: number;
  leadershipSkills?: Record<string, boolean>;
  loyalty?: string;
  defense?: string;
  isFunny?: boolean;
  isOnlineOnly?: boolean;
  relatedTokens?: string[];
  spellbook?: string[];
}

/** Empty arrays are dropped rather than written. `subtypes: []` on a Sol Ring is not information,
 *  and writing it would make "has no subtypes" indistinguishable from "not yet ingested". */
function nonEmpty<T>(v: T[] | undefined): T[] | undefined {
  return v && v.length > 0 ? v : undefined;
}

export function fieldsFrom(face: AtomicFace): MtgjsonFields {
  const out: MtgjsonFields = {};
  const set = <K extends keyof MtgjsonFields>(k: K, v: MtgjsonFields[K]): void => {
    if (v !== undefined) out[k] = v;
  };
  set("types", nonEmpty(face.types));
  set("supertypes", nonEmpty(face.supertypes));
  set("subtypes", nonEmpty(face.subtypes));
  set("producedMana", nonEmpty(face.producedMana));
  set("rulings", nonEmpty(face.rulings));
  set("edhrecSaltiness", face.edhrecSaltiness);
  set("leadershipSkills", face.leadershipSkills);
  set("loyalty", face.loyalty);
  set("defense", face.defense);
  // Booleans are kept only when TRUE: `isFunny: false` is the overwhelming default and writing it on
  // 34,000 documents buys nothing.
  set("isFunny", face.isFunny === true ? true : undefined);
  set("isOnlineOnly", face.isOnlineOnly === true ? true : undefined);
  set("relatedTokens", nonEmpty(face.relatedCards?.tokens));
  set("spellbook", nonEmpty(face.relatedCards?.spellbook));
  return out;
}

/** oracleId -> fields, across every face of every atomic entry.
 *
 *  A multi-face card (split, transform, meld) has one entry per NAME but a distinct oracle id per
 *  FACE, so faces are walked individually rather than taking the first. A face with no oracle id is
 *  skipped: without the join key there is nothing to attach it to. */
export function buildMerge(
  data: Record<string, AtomicFace[]>,
): Map<string, MtgjsonFields> {
  const out = new Map<string, MtgjsonFields>();
  for (const faces of Object.values(data)) {
    for (const face of faces) {
      const id = face.identifiers?.scryfallOracleId;
      if (!id) continue;
      const fields = fieldsFrom(face);
      if (Object.keys(fields).length === 0) continue;
      const prior = out.get(id);
      out.set(id, prior ? mergeFaces(prior, fields) : fields);
    }
  }
  return out;
}

/** Two faces can SHARE one oracle id — an Adventure or split card is a single Scryfall oracle entry,
 *  and our card document holds the combined type line to match.
 *
 *  Overwriting there loses the front face: Beluna Grandsquall arrived as "Instant — Adventure" with
 *  no supertypes, dropping Legendary outright, and 41 cards disagreed with our own type-line regex
 *  as a result. Arrays are unioned in face order so the combined document describes the whole card;
 *  scalars keep the FIRST face's value, which is the front one. */
function mergeFaces(a: MtgjsonFields, b: MtgjsonFields): MtgjsonFields {
  const out: MtgjsonFields = { ...a };
  for (const [k, v] of Object.entries(b) as [keyof MtgjsonFields, unknown][]) {
    const prior = out[k];
    if (prior === undefined) {
      (out as Record<string, unknown>)[k] = v;
    } else if (Array.isArray(prior) && Array.isArray(v)) {
      (out as Record<string, unknown>)[k] = [...new Set([...prior, ...v])];
    }
    // A scalar already set keeps the front face's value.
  }
  return out;
}
