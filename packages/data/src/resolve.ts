import { ComboIndex, type Card, type Combo } from "@edh-seer/engine";
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
  // SORTED, NOT LEFT IN `allCombos()`'S OWN ORDER. That order is an accident of the lookup's
  // storage: Mongo's is natural document-insertion order, `StaticLookup`'s is the order combos
  // were ACCUMULATED across the deck's own fetched cards (found 2026-08-30, static-parity.ts) --
  // neither is a fact about the combos themselves, and the two disagreed on 13 of the 71
  // calibration decks despite finding the exact same SET every time. A combo has no other
  // identity to sort by; its own two fields, joined, are deterministic regardless of which
  // `CardLookup` answered.
  const combos = new ComboIndex(allCombos).combosContainedIn(present)
    .sort((a, b) => {
      const ka = `${[...a.cards].sort().join("|")}::${a.result}`;
      const kb = `${[...b.cards].sort().join("|")}::${b.result}`;
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });

  return { cards, combos, missing };
}
