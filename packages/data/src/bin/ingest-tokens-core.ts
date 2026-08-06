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

/** The key a deck's `allParts` entry can be looked up by.
 *
 *  `RelatedPart` keeps only `component`, `name` and `typeLine` — the Scryfall id it came with is a
 *  PRINTING id, deliberately dropped. So the join is name + type line, which distinguishes the
 *  several different tokens sharing a name: a 1/1 white Soldier is not a 2/2 black Soldier. */
export function tokenKey(name: string, typeLine?: string): string {
  return `${name.toLowerCase()}|${(typeLine ?? "").toLowerCase()}`;
}
