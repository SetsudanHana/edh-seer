import type { AnalyzeResponse } from "./types.js";

export async function analyzeDeck(
  decklist: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AnalyzeResponse> {
  const res = await fetchImpl("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decklist }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(err.message ?? `Request failed: ${res.status}`);
  }
  return (await res.json()) as AnalyzeResponse;
}
