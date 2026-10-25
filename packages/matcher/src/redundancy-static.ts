/** REDUNDANCY FOR ONE SEED CARD, IN THE BROWSER (#1342, owner ruling 2026-10-25: similar.ts only, candidates computed LIVE from static
 *  data, no new artifact). Gathers what `findRedundancy` (pure) needs: the seed's deck partners, the amplifiers, and a candidate pool of
 *  (a) off-deck cards the seed's partners list in their `pi`, (b) the seed's own precomputed similar rows, (c) every other deck card.
 *
 *  PHYSICAL NAMES throughout: report edges and reasons name the FACE that does the work, `report.cards` maps it back (`cardName ?? name`). */
import type { DeckReport, Reason } from "@edh-seer/engine";
import { normalizeName } from "@edh-seer/data/names";
import { StaticLookup } from "./static-lookup.js";
import { decodeIndex, deckCards } from "./suggest-static.js";
import { byConnection, candidatePool, type DeckSide } from "./suggest.js";
import { faceDeckCards } from "./faces.js";
import { findRedundancy, type RedundancyCandidate, type RedundancyHit } from "./redundancy.js";
import type { SimilarCard } from "./similar.js";

const DEFAULT_POOL_CAP = 150;

export interface RedundancyResult { hits: RedundancyHit[]; poolSize: number; seedPartners: string[]; amplifiers: string[] }

export async function redundancyFor(input: {
  report: DeckReport; seed: string; commanderColorIdentity: string[]; baseUrl: string; fetchImpl?: typeof fetch;
  poolCap?: number; lookup?: StaticLookup;
}): Promise<RedundancyResult> {
  const { report, seed } = input;
  const empty: RedundancyResult = { hits: [], poolSize: 0, seedPartners: [], amplifiers: [] };
  const lookup = input.lookup ?? new StaticLookup(input.baseUrl, input.fetchImpl);

  // FACE NAME -> PHYSICAL CARD.
  const physicalOf = new Map<string, string>();
  for (const c of report.cards) if (!c.isCompanion) { const p = c.cardName ?? c.name; physicalOf.set(c.name, p); physicalOf.set(p, p); }
  const physical = [...new Set(physicalOf.values())];
  if (!physical.includes(seed)) return empty;
  await lookup.prefetch(physical.map(normalizeName));
  const index = await decodeIndex(lookup);
  const atName = new Map(index.map((c) => [c.name, c] as const));
  const raw = deckCards(lookup);

  // DECK PARTNERS: every deck card an edge joins to each deck card (token nodes are not in `physicalOf`).
  const partnersOf = new Map<string, Set<string>>();
  for (const e of report.edges) {
    const a = physicalOf.get(e.a), b = physicalOf.get(e.b);
    if (!a || !b || a === b) continue;
    (partnersOf.get(a) ?? partnersOf.set(a, new Set()).get(a)!).add(b);
    (partnersOf.get(b) ?? partnersOf.set(b, new Set()).get(b)!).add(a);
  }
  const seedPartners = [...(partnersOf.get(seed) ?? [])].sort();
  const seedSet = new Set(seedPartners);

  // AMPLIFIERS: a reason P -> seed whose producer ability is a REPLACEMENT (Fiery Emancipation -> Impact Tremors). The swap in `edges.ts`
  // writes `producerAbility` as an index into the producer's FACE abilities, so the tags are read per face.
  const amps = new Set<string>();
  for (const e of report.edges) for (const r of e.reasons as Reason[]) {
    if (!r.consumer || !r.producer || r.producerAbility === undefined) continue;
    const consumer = physicalOf.get(r.consumer), producer = physicalOf.get(r.producer);
    if (consumer !== seed || !producer || producer === seed || amps.has(producer)) continue;
    const dc = await raw(producer);
    if (!dc) continue;
    const faces = faceDeckCards(dc);
    const face = (r.producerFace !== undefined ? faces[r.producerFace] : undefined) ?? faces.find((f) => f.card.name === r.producer) ?? faces[0];
    if (face?.tags?.abilities[r.producerAbility]?.replacement === true) amps.add(producer);
  }
  const amplifiers = [...amps].sort();

  // OFF-DECK POOL from the seed partners' `pi` (non-land), as the suggestions build it.
  const pi = new Map<string, readonly (readonly [number, number, ...number[]])[]>();
  for (const name of seedPartners) {
    if (atName.get(name)?.isLand) continue;
    const ids = lookup.partnerIds(normalizeName(name));
    if (ids && ids.length > 0) pi.set(name, ids);
  }
  const deck: DeckSide = { names: new Set(physical), identity: new Set(input.commanderColorIdentity), pi };
  const pool = [...candidatePool(deck, index).values()].sort(byConnection).slice(0, input.poolCap ?? DEFAULT_POOL_CAP);
  const offDeck = new Map<string, { pos: number; shared: string[] }>();
  for (const c of pool) offDeck.set(c.card.name, { pos: c.card.pos, shared: c.connections.map((x) => x.deckCard) });

  // THE SEED'S OWN PRECOMPUTED SIMILAR ROWS. Absent record or rows = nothing.
  const seedEntry = atName.get(seed);
  if (seedEntry) {
    const rec = await lookup.cardPage(seedEntry.slug).catch(() => null);
    const similar = rec ? (await lookup.similarOf(rec)).similar : [];
    for (const s of similar) {
      if (physicalOf.has(s.name) || offDeck.has(s.name)) continue;
      const at = atName.get(s.name);
      if (at) offDeck.set(s.name, { pos: at.pos, shared: [] });
    }
  }

  await lookup.prefetch([...offDeck.keys()].map(normalizeName));
  let spare = index.length;
  const idOf = new Map<string, number>();
  const cardOf = async (name: string, pos?: number): Promise<SimilarCard | null> => {
    const dc = await raw(name);
    if (!dc?.tags) return null;
    const id = pos ?? atName.get(name)?.pos ?? idOf.get(name) ?? (idOf.set(name, spare++), idOf.get(name)!);
    return { id, name, tags: dc.tags };
  };
  const seedCard = await cardOf(seed);
  if (!seedCard) return empty;

  const candidates: RedundancyCandidate[] = [];
  for (const name of physical) {
    if (name === seed) continue;
    const card = await cardOf(name);
    if (card) candidates.push({ card, inDeck: true, sharedPartners: [...(partnersOf.get(name) ?? [])].filter((p) => seedSet.has(p)).sort() });
  }
  let poolSize = 0;
  for (const [name, v] of offDeck) {
    const card = await cardOf(name, v.pos);
    if (!card) continue;
    poolSize++;
    candidates.push({ card, inDeck: false, sharedPartners: v.shared });
  }
  const hits = findRedundancy({ seed: seedCard, seedPartners, candidates, amplifiers, identity: input.commanderColorIdentity });
  return { hits, poolSize, seedPartners, amplifiers };
}
