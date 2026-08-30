import type { AnalyzeResponse } from "./types.js";
import { analyzeDeckStatic } from "./api.static.js";

export async function analyzeDeck(
  decklist: string,
  commanders?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AnalyzeResponse> {
  // A FLAG, NOT A REPLACEMENT: both paths stay reachable so the static one can be A/B'd against
  // the known-good server path in a live browser, the same reason the Nest server survives.
  if (import.meta.env.VITE_STATIC_DATA === "1") {
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
