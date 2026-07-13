export interface CatalogSnapshot {
  fetchedAt: string;
  "keyword-ability": string[];
  "keyword-action": string[];
  "ability-word": string[];
}

export interface RawCatalogs {
  abilities: string[];
  actions: string[];
  words: string[];
  fetchedAt: string;
}

const lower = (xs: string[]): string[] => xs.map((x) => x.toLowerCase());

export function buildSnapshot(raw: RawCatalogs): CatalogSnapshot {
  return {
    fetchedAt: raw.fetchedAt,
    "keyword-ability": lower(raw.abilities),
    "keyword-action": lower(raw.actions),
    "ability-word": lower(raw.words),
  };
}
