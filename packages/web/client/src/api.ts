import type { GameState } from "@edh-seer/engine";
import type { AnalyzeResponse } from "./types.js";

/** Analyses a deck in the browser, against the `/static` shards. The one path since 2026-09-25,
 *  when the NestJS API that used to sit behind `/api/analyze` was removed. */
export async function analyzeDeck(
  decklist: string,
  commanders?: string,
  fetchImpl: typeof fetch = fetch,
  /** A game state the owner set (roadmap W18): `?speed=4` on the report. */
  state?: GameState,
): Promise<AnalyzeResponse> {
  // IMPORTED HERE, NOT AT THE TOP, AND IT IS 20% OF THE BUNDLE. `api.static.ts` value-imports
  // `@edh-seer/matcher/orchestrate`, which pulls the whole analysis engine into the browser --
  // matcher's `build.ts` and `rules.ts`, the tagger's `derive/subject.ts` and `derive/subtypes.ts`,
  // `engine/mechanics.ts`, `StaticLookup`. Loaded on demand, it stays out of the first paint of
  // every page that never analyses anything: the landing, the card pages, How it works.
  //
  // A DYNAMIC IMPORT COSTS NOTHING HERE because this function is already async and the engine is
  // only reachable after a paste: the work it does cannot start before the user asks for it.
  const { analyzeDeckStatic } = await import("./api.static.js");
  return analyzeDeckStatic(decklist, commanders, "/static", fetchImpl, state);
}
