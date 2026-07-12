import { Readable } from "node:stream";
import { createRequire } from "node:module";
import type { Combo } from "@mtg/engine";

// stream-json is CommonJS; Node's native ESM loader (used by tsx at runtime)
// cannot statically resolve its named exports, so load it via createRequire.
const require = createRequire(import.meta.url);
const { parser } = require("stream-json");
const { pick } = require("stream-json/filters/Pick");
const { streamArray } = require("stream-json/streamers/StreamArray");

export interface SpellbookVariant {
  id?: string;
  uses?: Array<{ card?: { name?: string } }>;
  produces?: Array<{ feature?: { name?: string } }>;
}

export interface NormalizedCombo {
  id: string;
  combo: Combo;
}

export function normalizeVariant(raw: SpellbookVariant): NormalizedCombo | null {
  if (!raw.id) return null;

  const cards = (raw.uses ?? [])
    .map((u) => u.card?.name)
    .filter((n): n is string => typeof n === "string" && n.length > 0);

  const results = (raw.produces ?? [])
    .map((p) => p.feature?.name)
    .filter((n): n is string => typeof n === "string" && n.length > 0);

  if (cards.length === 0 || results.length === 0) return null;

  return { id: raw.id, combo: { cards, result: results.join(", ") } };
}

export type FetchFn = typeof fetch;

const SPELLBOOK_HEADERS = {
  "User-Agent": "mtg-synergy-engine/0.1",
  Accept: "application/json",
};

/**
 * Streams the Commander Spellbook variants.json (~577MB) instead of
 * buffering it whole: `await res.json()` on a body this large throws
 * `ERR_STRING_TOO_LONG` because it exceeds Node's ~512MB max string length.
 */
export async function* streamVariants(
  fetchImpl: FetchFn = fetch,
): AsyncGenerator<SpellbookVariant> {
  const res = await fetchImpl("https://json.commanderspellbook.com/variants.json", {
    headers: SPELLBOOK_HEADERS,
  });
  if (!res.ok) throw new Error(`Spellbook fetch failed: ${res.status}`);
  if (!res.body) throw new Error("Spellbook response has no body");
  const nodeStream = Readable.fromWeb(res.body as any);
  const pipeline = nodeStream.pipe(parser()).pipe(pick({ filter: "variants" })).pipe(streamArray());
  for await (const { value } of pipeline) {
    yield value as SpellbookVariant;
  }
}
