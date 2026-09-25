import type { GameState } from "@edh-seer/engine";
import { StaticLookup } from "@edh-seer/matcher/static-lookup";
import { analyzeDecklist, type AnalysisSources } from "@edh-seer/matcher/orchestrate";
import type { AnalyzeResponse } from "./types.js";

/** A decklist analysed in the browser against the `/static` shards: `analyzeDecklist`, with the
 *  cards read from `StaticLookup`. There is no server anywhere on this path (and since 2026-09-25,
 *  no server at all). Node tools call it too, pointed at a `/static` URL -- `fixtures/capture.ts`. */
export async function analyzeDeckStatic(
  decklist: string, commanders: string | undefined, baseUrl: string, fetchImpl: typeof fetch = fetch,
  state?: GameState,
): Promise<AnalyzeResponse> {
  return analyzeDecklist(decklist, commanders, async (names): Promise<AnalysisSources> => {
    // `StaticLookup` binds `fetchImpl` itself (see its constructor) -- the receiver-check defect
    // that fixed lives at the one place every caller routes through, not at each call site.
    const lookup = new StaticLookup(baseUrl, fetchImpl);
    // Every name the list mentions, fetched before anything resolves: a shard per name prefix,
    // loaded once, rather than one round trip per card as resolution walks the list.
    await lookup.prefetch(names);
    return {
      lookup, tagsLookup: lookup,
      tokenTags: await lookup.tokenTags(),
      tokenArt: (ids: string[]) => lookup.tokenArt(ids),
    };
  }, state);
}
