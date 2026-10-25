import { compareCards, identityOf, OUTCOME_LOSS_LABEL, type Chip, type SimilarCard, type SimilarHit, type SimilarTier } from "./similar.js";

export interface RedundancyCandidate {
  card: SimilarCard;
  inDeck: boolean;
  /** Deck cards (physical names) this candidate connects to that the seed ALSO connects to. */
  sharedPartners: readonly string[];
}
export interface RedundancyInput {
  seed: SimilarCard;
  /** Deck cards the seed has an edge with (the "of N" count). */
  seedPartners: readonly string[];
  candidates: readonly RedundancyCandidate[];
  /** Deck cards whose REPLACEMENT ability improves the seed's damage (e.g. Fiery Emancipation). */
  amplifiers: readonly string[];
  /** Commander colour identity; a candidate outside it is dropped. Empty = no filter. */
  identity: readonly string[];
}
export interface DeckChip { dim: "deck" | "shared" | "amplifier"; label: string }
export interface RedundancyHit extends SimilarHit { inDeck: boolean; sharedPartners: string[]; deckChips: DeckChip[] }

const TIERS: SimilarTier[] = ["same", "close", "output", "outcome"];
const DEFAULT_CAPS: Record<SimilarTier, number> = { same: 12, close: 12, output: 8, outcome: 8 };

function amplifierLabel(names: readonly string[]): string {
  return names.length > 2 ? `loses ${names[0]} and ${names.length - 1} others synergy` : `loses ${names.join(", ")} synergy`;
}

export function findRedundancy(input: RedundancyInput, opts: { perTier?: Partial<Record<SimilarTier, number>> } = {}): RedundancyHit[] {
  const caps = { ...DEFAULT_CAPS, ...opts.perTier };
  const allowed = input.identity.length > 0 ? new Set(input.identity) : null;
  const byName = new Map<string, RedundancyCandidate>();
  for (const c of input.candidates) {
    if (c.card.name === input.seed.name) continue;
    const prev = byName.get(c.card.name);
    byName.set(c.card.name, prev ? { card: prev.card, inDeck: prev.inDeck || c.inDeck, sharedPartners: [...new Set([...prev.sharedPartners, ...c.sharedPartners])] } : c);
  }
  const hits: RedundancyHit[] = [];
  for (const c of byName.values()) {
    if (allowed && !c.inDeck && !identityOf(c.card).every((x) => allowed.has(x))) continue;
    const cmp = compareCards(input.seed, c.card, { drainIsDamage: true });
    if (!cmp) continue;
    const deckChips: DeckChip[] = [];
    if (c.inDeck) deckChips.push({ dim: "deck", label: "in your deck" });
    if (c.sharedPartners.length > 0) deckChips.push({ dim: "shared", label: `shares ${c.sharedPartners.length} of ${input.seedPartners.length} partners` });
    // CEILING: only the seed's own amplifiers are read; a life-loss seed with a damage candidate that GAINS an amplifier is not credited.
    if (input.amplifiers.length > 0 && cmp.tier === "outcome" && cmp.chips.some((k: Chip) => k.dim === "outcome" && k.label === OUTCOME_LOSS_LABEL)) {
      deckChips.push({ dim: "amplifier", label: amplifierLabel(input.amplifiers) });
    }
    hits.push({ ...cmp, id: c.card.id, name: c.card.name, inDeck: c.inDeck, sharedPartners: [...c.sharedPartners], deckChips });
  }
  hits.sort((a, b) =>
    TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier) || b.sharedPartners.length - a.sharedPartners.length || a.score - b.score || a.name.localeCompare(b.name));
  const used: Record<SimilarTier, number> = { same: 0, close: 0, output: 0, outcome: 0 };
  return hits.filter((h) => h.inDeck || ++used[h.tier] <= caps[h.tier]);
}
