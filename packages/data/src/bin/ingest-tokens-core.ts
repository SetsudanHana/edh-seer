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
  oracle_id?: string;
  colors?: string[];
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
  // A `reversible_card` token (Secret Lair Mechtitan) has NO top-level oracle_id, type line, text,
  // P/T or colours: they live on `card_faces`, and both faces name the same token. Top level wins
  // where present; face 0 is the fallback for every characteristic, so such a printing id joins its
  // token's doc through `mergeTokenDocs` instead of being dropped (#1709 review).
  const f0 = t.card_faces?.[0];
  const oracleId = t.oracle_id ?? f0?.oracle_id;
  // No oracle id means no stable key. Scryfall gives every token one; a payload without it is
  // malformed rather than interesting.
  if (!oracleId) return null;
  const typeLine = t.type_line ?? f0?.type_line;
  const oracleText = t.oracle_text ?? f0?.oracle_text;
  const power = t.power ?? f0?.power;
  const toughness = t.toughness ?? f0?.toughness;
  const colors = t.colors?.length ? t.colors : f0?.colors;
  return {
    _id: oracleId,
    name: t.name,
    printingIds: t.id ? [t.id] : [],
    ...(typeLine !== undefined ? { typeLine } : {}),
    ...(oracleText ? { oracleText } : {}),
    ...(power !== undefined ? { power } : {}),
    ...(toughness !== undefined ? { toughness } : {}),
    ...(colors?.length ? { colors } : {}),
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

/** Printing ids a card's `allParts` token parts name that no token doc holds in `printingIds` — the
 *  coverage the EXACT join actually has (#1709). `tokenKey` coverage is by name and type line and read
 *  100% while 27 ids (451 makers) resolved nothing: the cards were ingested after a new printing of an
 *  existing token (Beast, TTRC 2026-11-13) and the token ingest had not seen it. Cure: re-run
 *  `ingest-tokens`. Emblem parts (`combo_piece` with an "Emblem" type line) join the same way. */
export function unresolvedPrintingIds(
  parts: { component?: string; typeLine?: string; printingId?: string }[],
  docs: { printingIds: string[] }[],
): string[] {
  const known = new Set(docs.flatMap((d) => d.printingIds));
  const out = new Set<string>();
  for (const p of parts) {
    // Mirrors packages/tagger/src/emblem.ts `isEmblemPart`, copied because data cannot import tagger.
    const isToken = p.component === "token" || (p.component === "combo_piece" && /^Emblem\b/.test(p.typeLine ?? ""));
    if (isToken && p.printingId !== undefined && !known.has(p.printingId)) out.add(p.printingId);
  }
  return [...out];
}

export interface TokenGap { printingId: string; makers: string[] }

/** The same check as `unresolvedPrintingIds`, with the card names that name each unresolved id. This is
 *  where stale tokens bite: `ingest-tokens` fetches fresh and sees none, but a `cards` ingest (or a
 *  static build) run against an OLDER `tokens` collection names printings no token holds (#1709). */
export function unresolvedTokenMakers(
  cards: { name: string; allParts?: { component?: string; typeLine?: string; printingId?: string }[] }[],
  docs: { printingIds: string[] }[],
): TokenGap[] {
  const out = new Map<string, string[]>();
  for (const c of cards) {
    for (const id of unresolvedPrintingIds(c.allParts ?? [], docs)) {
      const m = out.get(id) ?? [];
      m.push(c.name);
      out.set(id, m);
    }
  }
  return [...out].map(([printingId, makers]) => ({ printingId, makers }));
}

/** The message a build or ingest prints for a gap, or null when there is none. Up to 5 examples. */
export function tokenGapMessage(gaps: TokenGap[]): string | null {
  if (gaps.length === 0) return null;
  const makers = new Set(gaps.flatMap((g) => g.makers)).size;
  const ex = gaps.slice(0, 5).map((g) => `  ${g.printingId} (${g.makers.slice(0, 3).join(", ")})`).join("\n");
  return `${gaps.length} token printing id(s) named by ${makers} card(s) resolve to no token doc, so those makers get no token node (#1709). Examples:\n${ex}\n`
    + "Re-run packages/data/src/bin/ingest-tokens.ts (the tokens collection is older than the cards).";
}
