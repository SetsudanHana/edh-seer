import { gunzipSync } from "node:zlib";
import type { Card } from "@mtg/engine";

export interface RelatedPart {
  /** "token" | "combo_piece" | "meld_part". */
  component: string;
  name: string;
  typeLine: string;
  /** PRINTING id, from `all_parts[].id`. Join this against `TokenDoc.printingIds`
   *  (`ingest-tokens-core.ts`) to resolve exactly one token row — (name, typeLine) alone is
   *  ambiguous (four "Wizard" / "Token Creature — Wizard" rows differ only in oracle text).
   *  Carried for every component; only the `token` join is built today, `combo_piece`/`meld_part`
   *  targets still resolve by name against `cards`. */
  printingId?: string;
}

export interface CardFace {
  name: string;
  typeLine: string;
  oracleText: string;
  manaCost?: string;
  power?: string;
  toughness?: string;
  colors: string[];
  /** Present on faces with no mana cost, where colour cannot be read off the cost. */
  colorIndicator?: string[];
  artCrop?: string;
}

export interface ScryfallCard {
  oracle_id?: string;
  /** PRINTING id, not an oracle id. Used only to drop the self-reference from all_parts. */
  id?: string;
  name?: string;
  type_line?: string;
  layout?: string;
  oracle_text?: string;
  keywords?: string[];
  colors?: string[];
  cmc?: number;
  mana_cost?: string;
  produced_mana?: string[];
  legalities?: Record<string, string>;
  released_at?: string;
  game_changer?: boolean;
  reserved?: boolean;
  all_parts?: Array<{ id?: string; component?: string; name?: string; type_line?: string }>;
  card_faces?: Array<{
    name?: string;
    type_line?: string;
    oracle_text?: string;
    mana_cost?: string;
    power?: string;
    toughness?: string;
    colors?: string[];
    color_indicator?: string[];
    image_uris?: { art_crop?: string };
  }>;
  color_identity?: string[];
  power?: string;
  toughness?: string;
  edhrec_rank?: number;
  image_uris?: { art_crop?: string };
}

export interface NormalizedCard {
  oracleId: string;
  card: Card;
  faceNames: string[];
  edhrecRank?: number;
  manaCost?: string;
  producedMana?: string[];
  layout?: string;
  legalities?: Record<string, string>;
  releasedAt?: string;
  gameChanger?: boolean;
  reserved?: boolean;
  allParts?: RelatedPart[];
  faces?: CardFace[];
  artCrop?: string;
}

/** Scryfall layouts that are not real gameplay cards (art cards, tokens, emblems,
 *  reversible/art-series printings). These carry a valid oracle_id but no gameplay
 *  text and must never enter the corpus. Reject-list, so any future gameplay layout
 *  keeps flowing. */
export const NON_GAMEPLAY_LAYOUTS: ReadonlySet<string> = new Set([
  "art_series",
  "double_faced_token",
  "token",
  "emblem",
  "reversible_card",
]);

export function normalizeScryfallCard(raw: ScryfallCard): NormalizedCard | null {
  if (!raw.oracle_id || !raw.name || !raw.type_line) return null;
  if (raw.layout !== undefined && NON_GAMEPLAY_LAYOUTS.has(raw.layout)) return null;

  const faces = raw.card_faces ?? [];

  const oracleText =
    raw.oracle_text ??
    (faces.length > 0
      ? faces.map((f) => f.oracle_text ?? "").join("\n//\n")
      : "");

  let colors = raw.colors ?? [];
  if (colors.length === 0 && faces.length > 0) {
    colors = Array.from(new Set(faces.flatMap((f) => f.colors ?? [])));
  }

  const faceNames =
    raw.name.includes(" // ") ? raw.name.split(" // ").map((s) => s.trim()) : [];

  const card: Card = {
    name: raw.name,
    typeLine: raw.type_line,
    oracleText,
    keywords: raw.keywords ?? [],
    colors,
    manaValue: raw.cmc ?? 0,
    colorIdentity: raw.color_identity ?? [],
    power: raw.power ?? null,
    toughness: raw.toughness ?? null,
  };

  /** Scryfall lists the card itself among its own related parts; drop it. `all_parts[].id` IS a
   *  PRINTING id, and it cannot be joined against `cards` (keyed on oracle_id) -- but it CAN be
   *  joined against `tokens.printingIds` (`ingest-tokens-core.ts`), which is built from exactly
   *  these ids, so it is kept as `printingId` for the token half of the join. combo_piece/meld_part
   *  targets still resolve by name against `cards`. */
  const allParts: RelatedPart[] | undefined = raw.all_parts
    ?.filter((p) => p.id !== raw.id && p.component && p.name && p.type_line)
    .map((p) => ({
      component: p.component!,
      name: p.name!,
      typeLine: p.type_line!,
      ...(p.id !== undefined ? { printingId: p.id } : {}),
    }));

  const cardFaces: CardFace[] | undefined = raw.card_faces?.map((f) => ({
    name: f.name ?? "",
    typeLine: f.type_line ?? "",
    oracleText: f.oracle_text ?? "",
    colors: f.colors ?? [],
    ...(f.mana_cost !== undefined ? { manaCost: f.mana_cost } : {}),
    ...(f.power !== undefined ? { power: f.power } : {}),
    ...(f.toughness !== undefined ? { toughness: f.toughness } : {}),
    ...(f.color_indicator !== undefined ? { colorIndicator: f.color_indicator } : {}),
    ...(f.image_uris?.art_crop !== undefined ? { artCrop: f.image_uris.art_crop } : {}),
  }));

  return {
    oracleId: raw.oracle_id,
    card,
    faceNames,
    edhrecRank: raw.edhrec_rank,
    ...(raw.mana_cost !== undefined ? { manaCost: raw.mana_cost } : {}),
    ...(raw.produced_mana !== undefined ? { producedMana: raw.produced_mana } : {}),
    ...(raw.layout !== undefined ? { layout: raw.layout } : {}),
    ...(raw.legalities !== undefined ? { legalities: raw.legalities } : {}),
    ...(raw.released_at !== undefined ? { releasedAt: raw.released_at } : {}),
    ...(raw.game_changer !== undefined ? { gameChanger: raw.game_changer } : {}),
    ...(raw.reserved !== undefined ? { reserved: raw.reserved } : {}),
    ...(allParts !== undefined && allParts.length > 0 ? { allParts } : {}),
    ...(cardFaces !== undefined && cardFaces.length > 0 ? { faces: cardFaces } : {}),
    ...(raw.image_uris?.art_crop !== undefined ? { artCrop: raw.image_uris.art_crop } : {}),
  };
}

export type FetchFn = typeof fetch;

const SCRYFALL_HEADERS = {
  "User-Agent": "mtg-synergy-engine/0.1",
  Accept: "application/json",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Oracle IDs of cards with no paper printing (Alchemy rebalances, Arena-only cards).
 *
 * Uses `-in:paper`, which is CARD-level. The printing-level predicates `is:alchemy` and
 * `-game:paper` match a card when a SINGLE printing matches, so they sweep in paper
 * staples that merely have an Arena rebalance (Kindred Discovery, Blur) -- never use
 * those to decide what to exclude or delete.
 *
 * We ask Scryfall rather than reading `games`/`digital` off the oracle_cards bulk entry:
 * that entry is one representative printing per card, and which printing Scryfall picks
 * is not a documented guarantee, so a card with both paper and Arena printings could be
 * represented by the Arena one and wrongly dropped.
 */
export async function fetchDigitalOnlyOracleIds(
  fetchImpl: FetchFn = fetch,
): Promise<Set<string>> {
  const out = new Set<string>();
  let url = `https://api.scryfall.com/cards/search?unique=cards&q=${encodeURIComponent("-in:paper")}`;
  while (url) {
    let ok = false;
    for (let attempt = 0; attempt < 10 && !ok; attempt++) {
      const res = await fetchImpl(url, { headers: SCRYFALL_HEADERS });
      if (res.status === 404) return out; // no matches
      if (!res.ok) {
        const ra = Number(res.headers.get("retry-after")) * 1000;
        await sleep(Number.isFinite(ra) && ra > 0 ? ra : 2500);
        continue;
      }
      const j = (await res.json()) as {
        data?: Array<{ oracle_id?: string }>;
        has_more?: boolean;
        next_page?: string;
        object?: string;
      };
      if (j.object === "error") return out;
      for (const c of j.data ?? []) if (c.oracle_id) out.add(c.oracle_id);
      url = j.has_more && j.next_page ? j.next_page : "";
      ok = true;
    }
    // Truncation would silently readmit digital cards, so fail instead of half-filtering.
    if (!ok) throw new Error("digital-only oracle_id fetch gave up after retries");
    await sleep(130);
  }
  return out;
}

export async function fetchOracleCards(
  fetchImpl: FetchFn = fetch,
): Promise<ScryfallCard[]> {
  const meta = await fetchImpl("https://api.scryfall.com/bulk-data", {
    headers: SCRYFALL_HEADERS,
  });
  if (!meta.ok) throw new Error(`Scryfall bulk-data request failed: ${meta.status}`);
  const metaJson = (await meta.json()) as {
    data: Array<{ type: string; jsonl_download_uri?: string }>;
  };
  if (!Array.isArray(metaJson.data)) {
    throw new Error("Scryfall bulk-data request failed: unexpected response");
  }
  const entry = metaJson.data.find((d) => d.type === "oracle_cards");
  if (!entry?.jsonl_download_uri) {
    throw new Error("Scryfall oracle_cards bulk entry not found");
  }
  const res = await fetchImpl(entry.jsonl_download_uri, { headers: SCRYFALL_HEADERS });
  if (!res.ok) throw new Error(`Scryfall bulk download failed: ${res.status}`);
  // ponytail: whole file in memory (~24MB gzipped). Stream through createGunzip + readline if it OOMs.
  const buf = Buffer.from(await res.arrayBuffer());
  const text = gunzipSync(buf).toString("utf8");
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as ScryfallCard);
}
