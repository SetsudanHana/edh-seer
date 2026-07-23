import type { Card } from "@mtg/engine";

export interface ScryfallCard {
  oracle_id?: string;
  name?: string;
  type_line?: string;
  layout?: string;
  oracle_text?: string;
  keywords?: string[];
  colors?: string[];
  cmc?: number;
  card_faces?: Array<{ oracle_text?: string; colors?: string[] }>;
  color_identity?: string[];
  power?: string;
  toughness?: string;
  edhrec_rank?: number;
}

export interface NormalizedCard {
  oracleId: string;
  card: Card;
  faceNames: string[];
  edhrecRank?: number;
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

  return { oracleId: raw.oracle_id, card, faceNames, edhrecRank: raw.edhrec_rank };
}

export type FetchFn = typeof fetch;

const SCRYFALL_HEADERS = {
  "User-Agent": "mtg-synergy-engine/0.1",
  Accept: "application/json",
};

export async function fetchOracleCards(
  fetchImpl: FetchFn = fetch,
): Promise<ScryfallCard[]> {
  const meta = await fetchImpl("https://api.scryfall.com/bulk-data", {
    headers: SCRYFALL_HEADERS,
  });
  if (!meta.ok) throw new Error(`Scryfall bulk-data request failed: ${meta.status}`);
  const metaJson = (await meta.json()) as {
    data: Array<{ type: string; download_uri: string }>;
  };
  if (!Array.isArray(metaJson.data)) {
    throw new Error("Scryfall bulk-data request failed: unexpected response");
  }
  const entry = metaJson.data.find((d) => d.type === "oracle_cards");
  if (!entry) throw new Error("Scryfall oracle_cards bulk entry not found");
  const res = await fetchImpl(entry.download_uri, { headers: SCRYFALL_HEADERS });
  if (!res.ok) throw new Error(`Scryfall bulk download failed: ${res.status}`);
  return (await res.json()) as ScryfallCard[];
}
