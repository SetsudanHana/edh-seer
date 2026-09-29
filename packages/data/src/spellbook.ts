import { Readable } from "node:stream";
import type { Combo } from "@edh-seer/engine";
// stream-json 3.x is pure ESM and ships its own types, so the `createRequire` dance 1.x needed --
// and the `@types/stream-json` package -- are both gone. THREE THINGS MOVED in the major:
// the subpaths are kebab-case (`filters/pick.js`, not `filters/Pick`) and carry their extension,
// because the package's `exports` map is `"./*": "./src/*"` with no extension resolution; the
// index's stream maker is `parserStream`, since `parser` is now the generator underneath it; and
// the filter and streamer default exports are generators too, whose `.asStream()` is the Duplex
// this pipe chain wants. The emitted `{key, value}` items are unchanged.
import { parserStream } from "stream-json";
import pick from "stream-json/filters/pick.js";
import streamArray from "stream-json/streamers/stream-array.js";

export interface SpellbookVariant {
  id?: string;
  uses?: Array<{ card?: { name?: string } }>;
  produces?: Array<{ feature?: { name?: string } }>;
  /** Pieces named by a TEMPLATE rather than a card ("Creature with undying"), with how many. */
  requires?: Array<{ template?: { name?: string }; quantity?: number }>;
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

  // THE UNNAMED PIECES (#568). Dropping them made Goblin Bombardment + Metallic Mimic read as a
  // two-card combo when the line needs a third creature too, and the bracket counts two-card combos.
  const requires = (raw.requires ?? []).flatMap((r) => {
    const name = r.template?.name;
    return typeof name === "string" && name.length > 0 ? Array.from({ length: Math.max(1, r.quantity ?? 1) }, () => name) : [];
  });

  return { id: raw.id, combo: { cards, result: results.join(", "), ...(requires.length > 0 ? { requires } : {}) } };
}

export type FetchFn = typeof fetch;

const SPELLBOOK_HEADERS = {
  "User-Agent": "edh-seer/0.1",
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
  const pipeline = nodeStream.pipe(parserStream())
    .pipe(pick.asStream({ filter: "variants" }))
    .pipe(streamArray.asStream());
  for await (const { value } of pipeline) {
    yield value as SpellbookVariant;
  }
}
