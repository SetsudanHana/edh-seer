import { ComboIndex, type Card, type Combo } from "@mtg/engine";
import { normalizeName } from "./names.js";
import { docToCard, type CardDoc, type ComboDoc } from "./docs.js";

export interface CardLookup {
  findByName(normalized: string): Promise<CardDoc | null>;
  allCombos(): Promise<ComboDoc[]>;
}

export interface ResolveResult {
  cards: Card[];
  combos: Combo[];
  missing: string[];
}

export async function resolveNames(
  names: string[],
  lookup: CardLookup,
): Promise<ResolveResult> {
  const cards: Card[] = [];
  const missing: string[] = [];
  const present = new Set<string>();

  for (const name of names) {
    const doc = await lookup.findByName(normalizeName(name));
    if (!doc) {
      missing.push(name);
      continue;
    }
    cards.push(docToCard(doc));
    present.add(doc.name);
  }

  const comboDocs = await lookup.allCombos();
  const allCombos: Combo[] = comboDocs.map((c) => ({ cards: c.cards, result: c.result }));
  const combos = new ComboIndex(allCombos).combosContainedIn(present);

  return { cards, combos, missing };
}
