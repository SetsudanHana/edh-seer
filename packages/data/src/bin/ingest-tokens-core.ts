/** Token cards, for the "what tokens does this deck need" list.
 *
 *  This is a UI concern, not a graph one. Every deckbuilding site shows the tokens a deck produces
 *  so you can sleeve them, and that needs a NAME, a TYPE LINE and an IMAGE — none of which the
 *  creating card carries. `Aragorn, the Uniter` says only "Human Soldier"; the picture lives on the
 *  token.
 *
 *  The LINK already exists: `scryfall.ts` parses `all_parts` into `allParts`, so 5,640 corpus cards
 *  already reference 440 distinct token names with `component: "token"`. Only the token cards
 *  themselves were missing, because the non-gameplay layout filter (correctly) keeps them out of the
 *  gameplay corpus. They go in their own collection instead.
 *
 *  (name, typeLine) does NOT identify a token: several distinct oracle_ids share both (four "Wizard"
 *  / "Token Creature — Wizard" rows differing only in oracle text). The exact join is a card's
 *  `allParts[].id` — a PRINTING id — against `TokenDoc.printingIds`, the set of printing ids Scryfall
 *  collapses onto one oracle_id. Verified against live Scryfall data before building on it: Kuja,
 *  Genome Sorcerer's Wizard part carries printing id `04ae24bf-...`, one of three prints under
 *  oracle_id `27a141bd-...` — the group whose oracle text is the noncreature-cast trigger, not the
 *  other three Wizard oracle_ids that happen to share its name and type line.
 *
 *  Pure, so the shaping is testable without the network.
 */

export interface ScryfallTokenFace {
  image_uris?: Record<string, string>;
  oracle_text?: string;
  power?: string;
  toughness?: string;
  type_line?: string;
}
export interface ScryfallToken {
  /** PRINTING id. Scryfall's `is:token` search returns one row per PRINTING under `unique=prints` —
   *  several rows sharing an oracle_id are reprints of the same token and get merged by
   *  `mergeTokenDocs`. */
  id?: string;
  oracle_id?: string;
  name: string;
  type_line?: string;
  oracle_text?: string;
  power?: string;
  toughness?: string;
  colors?: string[];
  color_identity?: string[];
  keywords?: string[];
  layout?: string;
  image_uris?: Record<string, string>;
  card_faces?: ScryfallTokenFace[];
}

export interface TokenDoc {
  _id: string;
  name: string;
  typeLine?: string;
  oracleText?: string;
  power?: string;
  toughness?: string;
  colors?: string[];
  colorIdentity?: string[];
  keywords?: string[];
  layout?: string;
  /** Normal-size image, the one a deck list renders. */
  image?: string;
  artCrop?: string;
  /** Every PRINTING id Scryfall collapsed into this oracle_id. This is the exact join target for a
   *  card's `allParts[].printingId` — see the module comment. */
  printingIds: string[];
}

/** A double-faced token keeps its images on `card_faces`, not at the top level, so a naive read of
 *  `image_uris` returns nothing for 20 of every 175 tokens. The front face is the one a token list
 *  shows. */
function imagesOf(t: ScryfallToken): { image?: string; artCrop?: string } {
  const src = t.image_uris ?? t.card_faces?.[0]?.image_uris;
  return {
    ...(src?.normal !== undefined ? { image: src.normal } : {}),
    ...(src?.art_crop !== undefined ? { artCrop: src.art_crop } : {}),
  };
}

export function tokenDoc(t: ScryfallToken): TokenDoc | null {
  // No oracle id means no stable key. Scryfall gives every token one; a payload without it is
  // malformed rather than interesting.
  if (!t.oracle_id) return null;
  return {
    _id: t.oracle_id,
    name: t.name,
    printingIds: t.id ? [t.id] : [],
    ...(t.type_line !== undefined ? { typeLine: t.type_line } : {}),
    ...(t.oracle_text ? { oracleText: t.oracle_text } : {}),
    ...(t.power !== undefined ? { power: t.power } : {}),
    ...(t.toughness !== undefined ? { toughness: t.toughness } : {}),
    ...(t.colors?.length ? { colors: t.colors } : {}),
    ...(t.color_identity?.length ? { colorIdentity: t.color_identity } : {}),
    ...(t.keywords?.length ? { keywords: t.keywords } : {}),
    ...(t.layout !== undefined ? { layout: t.layout } : {}),
    ...imagesOf(t),
  };
}

/** Scryfall's `is:token` search has to run with `unique=prints` to see every printing id (995 rows
 *  under `unique=cards`, 3,114 under `unique=prints`, verified live) — `unique=cards` silently picks
 *  ONE representative printing per oracle_id, and that representative is not guaranteed to be the
 *  printing id any given card's `allParts` entry points at. `tokenDoc` shapes one payload into one
 *  doc per printing; this merges the printings that share an oracle_id back into one row, unioning
 *  their printing ids rather than letting the last write win. First-seen payload's fields win for
 *  everything else — reprints of a token do not change its rules text. */
export function mergeTokenDocs(docs: TokenDoc[]): TokenDoc[] {
  const byId = new Map<string, TokenDoc>();
  for (const d of docs) {
    const existing = byId.get(d._id);
    if (!existing) {
      byId.set(d._id, d);
    } else {
      const printingIds = [...new Set([...existing.printingIds, ...d.printingIds])];
      byId.set(d._id, { ...existing, printingIds });
    }
  }
  return [...byId.values()];
}

/** The key a deck's `allParts` entry can be looked up by, on (name, typeLine) alone.
 *
 *  KNOWN AMBIGUOUS — kept only as a coverage/reporting aid, never the join a graph edge should trust.
 *  Several distinct oracle_ids share both name and type line (four "Wizard" / "Token Creature —
 *  Wizard" rows with different oracle text); the exact join is `RelatedPart.printingId` against
 *  `TokenDoc.printingIds`, see the module comment. */
export function tokenKey(name: string, typeLine?: string): string {
  return `${name.toLowerCase()}|${(typeLine ?? "").toLowerCase()}`;
}
