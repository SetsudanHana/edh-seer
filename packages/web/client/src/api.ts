import type { AnalyzeResponse } from "./types.js";

export async function analyzeDeck(
  decklist: string,
  commanders?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AnalyzeResponse> {
  // A FLAG, NOT A REPLACEMENT: both paths stay reachable so the static one can be A/B'd against
  // the known-good server path in a live browser, the same reason the Nest server survives.
  if (import.meta.env.VITE_STATIC_DATA === "1") {
    // IMPORTED HERE, NOT AT THE TOP, AND IT IS 20% OF THE BUNDLE. `api.static.ts` value-imports
    // `@edh-seer/matcher/orchestrate`, which pulls the whole analysis engine into the browser --
    // matcher's `build.ts` and `rules.ts`, the tagger's `derive/subject.ts` and `derive/subtypes.ts`,
    // `engine/mechanics.ts`, `StaticLookup`. Measured off the build's own sourcemap, those are
    // ~125kB of the 2.4MB of mapped source, and every one of them shipped to every visitor even
    // with `VITE_STATIC_DATA` unset, behind a branch that could never run.
    //
    // A DYNAMIC IMPORT COSTS NOTHING HERE because this function is already async and the engine is
    // only reachable after a paste: the work it does cannot start before the user asks for it.
    const { analyzeDeckStatic } = await import("./api.static.js");
    return analyzeDeckStatic(decklist, commanders, "/static", fetchImpl);
  }
  const res = await fetchImpl("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decklist, commanders }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(err.message ?? `Request failed: ${res.status}`);
  }
  return (await res.json()) as AnalyzeResponse;
}
