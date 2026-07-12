export type FetchFn = typeof fetch;

const SCRYFALL_HEADERS = {
  "User-Agent": "mtg-synergy-engine/0.1",
  Accept: "application/json",
};

const FLAVOR_SEARCH_URL =
  "https://api.scryfall.com/cards/search?q=has%3Aflavorname&unique=prints";

export interface FlavorPair {
  oracleId: string;
  flavorName: string;
}

interface ScryfallSearchCard {
  oracle_id?: string;
  flavor_name?: string;
}

interface ScryfallSearchPage {
  data?: ScryfallSearchCard[];
  has_more?: boolean;
  next_page?: string;
}

export function extractFlavorPairs(page: ScryfallSearchPage): FlavorPair[] {
  return (page.data ?? [])
    .filter(
      (c): c is { oracle_id: string; flavor_name: string } =>
        typeof c.oracle_id === "string" && typeof c.flavor_name === "string",
    )
    .map((c) => ({ oracleId: c.oracle_id, flavorName: c.flavor_name }));
}

export async function fetchFlavorNames(
  fetchImpl: FetchFn = fetch,
): Promise<FlavorPair[]> {
  const pairs: FlavorPair[] = [];
  let url: string | undefined = FLAVOR_SEARCH_URL;
  while (url) {
    const res = await fetchImpl(url, { headers: SCRYFALL_HEADERS });
    if (!res.ok) throw new Error(`Scryfall flavor-name search failed: ${res.status}`);
    const page = (await res.json()) as ScryfallSearchPage;
    pairs.push(...extractFlavorPairs(page));
    url = page.has_more ? page.next_page : undefined;
  }
  return pairs;
}
