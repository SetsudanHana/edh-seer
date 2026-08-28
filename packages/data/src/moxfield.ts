export type FetchFn = typeof fetch;

export function parseMoxfieldId(input: string): string | null {
  const m = input.match(/moxfield\.com\/decks\/([\w-]+)/i);
  if (m) return m[1];
  if (/^[\w-]+$/.test(input)) return input;
  return null;
}

export async function fetchMoxfieldDeck(
  id: string,
  fetchImpl: FetchFn = fetch,
): Promise<string[]> {
  const res = await fetchImpl(`https://api.moxfield.com/v2/decks/all/${id}`, {
    headers: { "User-Agent": "edh-seer" },
  });
  if (!res.ok) throw new Error(`Moxfield fetch failed: ${res.status}`);
  const json = (await res.json()) as {
    commanders?: Record<string, unknown>;
    mainboard?: Record<string, unknown>;
  };
  return [
    ...Object.keys(json.commanders ?? {}),
    ...Object.keys(json.mainboard ?? {}),
  ];
}
