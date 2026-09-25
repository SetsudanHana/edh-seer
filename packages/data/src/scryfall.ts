import { gunzipSync } from "node:zlib";
import type { Card } from "@edh-seer/engine";

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

/** THE ONE SCRYFALL CLIENT (2026-09-25). Five modules each carried their own fetch loop, with three
 *  different User-Agents, pacing between 100 and 130 ms, and retry logic in two of them -- the
 *  token ingest threw on its first 429. Every Scryfall request in the repository now sends these
 *  headers, and every paginated search goes through `scryfallSearch`. Scryfall asks for an accurate
 *  User-Agent, an Accept header, and 50-100 ms between requests. */
export const SCRYFALL_HEADERS: Readonly<Record<string, string>> = {
  "User-Agent": "edh-seer/1.0 (+https://github.com/SetsudanHana/edh-seer)",
  Accept: "application/json",
};

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface ScryfallSearchOptions {
  fetchImpl?: FetchFn;
  /** Tries per page before giving up; a 429 or 5xx and a thrown fetch each use one. */
  attempts?: number;
  /** Between pages. Scryfall asks for 50-100 ms. */
  pageDelayMs?: number;
  /** Before a retry when the answer carries no `Retry-After`. */
  retryDelayMs?: number;
  /** Injectable so a test of the retry path does not wait out real delays. */
  sleep?: (ms: number) => Promise<void>;
}

/** The `/cards/search` URL for a query, with Scryfall's own `unique` and `order` parameters. */
export function scryfallSearchUrl(q: string, params: { unique?: "cards" | "prints" | "art"; order?: string } = {}): string {
  const u = new URL("https://api.scryfall.com/cards/search");
  if (params.unique) u.searchParams.set("unique", params.unique);
  if (params.order) u.searchParams.set("order", params.order);
  u.searchParams.set("q", q);
  return u.toString();
}

/** EVERY CARD A SEARCH MATCHES, one page at a time, following `next_page`.
 *
 *  A 404 is Scryfall's "no cards match", so it ends the search empty rather than failing it, and a
 *  200 carrying `object: "error"` does the same. A 429 or 5xx is Scryfall asking us to slow down: it
 *  is retried after `Retry-After` when sent, else `retryDelayMs`. A page that still fails after
 *  `attempts` THROWS, because a truncated result is worse than none -- it would silently half-fill a
 *  collection (the digital-only filter, the oracle tags) with nothing to say so. */
export async function* scryfallSearch<T = Record<string, unknown>>(
  url: string, opts: ScryfallSearchOptions = {},
): AsyncGenerator<T[]> {
  const { fetchImpl = fetch, attempts = 10, pageDelayMs = 100, retryDelayMs = 2500, sleep = realSleep } = opts;
  let next: string | undefined = url;
  while (next) {
    let page: { data?: T[]; has_more?: boolean; next_page?: string; object?: string } | undefined;
    let last = "no response";
    for (let attempt = 0; attempt < attempts && !page; attempt++) {
      let res: Response;
      try {
        res = await fetchImpl(next, { headers: SCRYFALL_HEADERS });
      } catch (e) {
        last = e instanceof Error ? e.message : String(e);
        await sleep(retryDelayMs);
        continue;
      }
      if (res.status === 404) return;
      if (!res.ok) {
        last = `status ${res.status}`;
        const ra = Number(res.headers.get("retry-after")) * 1000;
        await sleep(Number.isFinite(ra) && ra > 0 ? ra : retryDelayMs);
        continue;
      }
      page = await res.json() as typeof page;
    }
    if (!page) throw new Error(`Scryfall search gave up after ${attempts} attempts (${last}): ${next}`);
    if (page.object === "error") return;
    yield page.data ?? [];
    next = page.has_more && page.next_page ? page.next_page : undefined;
    if (next) await sleep(pageDelayMs);
  }
}

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
  opts: Omit<ScryfallSearchOptions, "fetchImpl"> = {},
): Promise<Set<string>> {
  const out = new Set<string>();
  // Truncation would silently readmit digital cards, which is why `scryfallSearch` throws rather
  // than returning a partial result.
  for await (const page of scryfallSearch<{ oracle_id?: string }>(scryfallSearchUrl("-in:paper", { unique: "cards" }), { ...opts, fetchImpl })) {
    for (const c of page) if (c.oracle_id) out.add(c.oracle_id);
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
  // CEILING: whole file in memory (~24MB gzipped). Stream through createGunzip + readline if it OOMs.
  const buf = Buffer.from(await res.arrayBuffer());
  const text = gunzipSync(buf).toString("utf8");
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as ScryfallCard);
}
