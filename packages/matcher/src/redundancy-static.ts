/** REDUNDANCY FOR ONE SEED CARD, IN THE BROWSER (#1342, owner ruling 2026-10-25: similar.ts only, candidates computed LIVE from static
 *  data, no new artifact). Gathers what `findRedundancy` (pure) needs: the seed's deck partners, the amplifiers, and a candidate pool of
 *  (a) off-deck cards in the EVENT BUCKETS of the seed's outputs (`events/` shards, measured 2026-10-25: `pi` is the wrong source, it is each
 *  card's corpus-wide top 200 and lists neither the seed's job-mates nor this deck), (b) the seed's own precomputed similar rows,
 *  (c) every other deck card.
 *
 *  SHARED PARTNERS ARE REAL ENGINE EDGES, face by face, with `impliedProducer` reasons dropped (a link true of every creature that enters,
 *  owner 2026-10-02). Report edges are filtered the same way, so the "of N" denominator matches the numerator.
 *
 *  PHYSICAL NAMES throughout: report edges and reasons name the FACE that does the work, `report.cards` maps it back (`cardName ?? name`). */
import type { DeckReport, Reason } from "@edh-seer/engine";
import { normalizeName } from "@edh-seer/data/names";
import { StaticLookup, shardOf } from "./static-lookup.js";
import { decodeIndex, deckCards } from "./suggest-static.js";
import { faceDeckCards } from "./faces.js";
import { directedReasons } from "./edges.js";
import { loadHierarchy } from "./hierarchy.js";
import { eventKey, splitKey, supplyForms, type EventMembers } from "./partners-core.js";
import type { GameEvent } from "@edh-seer/tagger";
import { findRedundancy, type RedundancyCandidate, type RedundancyHit } from "./redundancy.js";
import { compareCards, seedBuckets, type SimilarCard, type SimilarTier } from "./similar.js";
import { isUnjudgedFact, unpackFact } from "./member-facts.js";
import type { DeckCard } from "./types.js";

const DEFAULT_POOL_CAP = 150;
const DAMAGE_TAG = /^(?:non-)?combat-damage(?:[:|]|$)/;
/** A member with no judged fact sorts after any member whose facts we can compare. */
const UNKNOWN_DISTANCE = 6;
/** Added to a member that does not ask for the seed's trigger event: larger than any fact distance, so trigger match ranks first. */
const TRIGGER_MISS = 100;

export interface RedundancyStats {
  buckets: string[]; bucketSizes: number[]; poolSize: number; fetched: number;
  /** A seed key with no shard entry that was answered from a coarser key. */
  fallbacks: { key: string; usedKey: string }[];
  /** Seed keys with no entry even after falling back. */
  missing: string[];
  /** False when the seed has nothing the search can compare (no tags, no output buckets, or none readable): an empty `hits` then means "cannot say", not "no card does this". */
  comparable: boolean;
  /** Output or trigger keys whose events shard could not be READ (a network error, not an absent key). */
  errors: string[];
}
/** `slug` is the card page, from the decoded index; absent for a deck card the index does not carry (no link to offer). */
export type RedundancyRow = RedundancyHit & { slug?: string };
export interface RedundancyResult { hits: RedundancyRow[]; poolSize: number; seedPartners: string[]; amplifiers: string[]; stats: RedundancyStats }

type SeedFact = ReturnType<typeof seedBuckets>[number]["facts"][number];
/** How far a member's ability is from the seed's: kind, then how often, then size. 0 = the same job at the same rate. */
function factDistance(n: number, seed: readonly SeedFact[]): number {
  if (isUnjudgedFact(n)) return UNKNOWN_DISTANCE;
  const m = unpackFact(n);
  let best = UNKNOWN_DISTANCE;
  for (const f of seed) {
    let d = m.kind === f.kind ? 0 : 4;
    if (m.repeats !== f.repeats) d += m.repeats === undefined || f.repeats === undefined ? 1 : 2;
    const ma = m.amount, fa = f.amount;
    if (ma.kind !== fa.kind || ("value" in ma && "value" in fa && ma.value !== fa.value)) d += 1;
    best = Math.min(best, d);
  }
  return best;
}

export async function redundancyFor(input: {
  report: DeckReport; seed: string; commanderColorIdentity: string[]; baseUrl: string; fetchImpl?: typeof fetch;
  poolCap?: number; lookup?: StaticLookup; perTier?: Partial<Record<SimilarTier, number>>;
}): Promise<RedundancyResult> {
  const { report, seed } = input;
  const stats: RedundancyStats = { buckets: [], bucketSizes: [], poolSize: 0, fetched: 0, fallbacks: [], missing: [], comparable: true, errors: [] };
  const empty: RedundancyResult = { hits: [], poolSize: 0, seedPartners: [], amplifiers: [], stats };
  const lookup = input.lookup ?? new StaticLookup(input.baseUrl, input.fetchImpl);

  // FACE NAME -> PHYSICAL CARD.
  const physicalOf = new Map<string, string>();
  for (const c of report.cards) if (!c.isCompanion) { const p = c.cardName ?? c.name; physicalOf.set(c.name, p); physicalOf.set(p, p); }
  const physical = [...new Set(physicalOf.values())];
  if (!physical.includes(seed)) { stats.comparable = false; return empty; }
  // The DECK's own prefetch may throw: with no deck there is nothing to show. Every later read is per card or per shard and drops only that.
  await lookup.prefetch(physical.map(normalizeName));
  const index = await decodeIndex(lookup);
  const atName = new Map(index.map((c) => [c.name, c] as const));
  const raw = deckCards(lookup);

  // DECK PARTNERS: every deck card an edge joins to each deck card, by a reason that is not merely "a card enters". Token nodes are not in `physicalOf`.
  // A TOKEN MAKER REACHES A PAYOFF THROUGH ITS TOKEN NODE (maker -> Goblin token -> Impact Tremors): the direct reason is `impliedProducer` and the report
  // follows the two hops instead, so a token node's edge to a card links that card to every maker of the token. The token's own enters is implied
  // (`producerIsToken`) but the maker authored it (`analyze.ts` `addHop`), so it counts here.
  const makersOf = new Map((report.tokenNodes ?? []).filter((t) => !physicalOf.has(t.name))
    .map((t) => [t.name, (t.madeBy ?? []).map((m) => physicalOf.get(m) ?? m).filter((m) => physical.includes(m))] as const));
  const partnersOf = new Map<string, Set<string>>();
  const link = (a: string, b: string): void => {
    if (a === b) return;
    (partnersOf.get(a) ?? partnersOf.set(a, new Set()).get(a)!).add(b);
    (partnersOf.get(b) ?? partnersOf.set(b, new Set()).get(b)!).add(a);
  };
  for (const e of report.edges) {
    const a = physicalOf.get(e.a), b = physicalOf.get(e.b);
    if (a && b) {
      if (e.reasons.length > 0 && !e.reasons.every((r) => r.impliedProducer)) link(a, b);
      continue;
    }
    const tokenName = a ? e.b : b ? e.a : undefined, card = a ?? b;
    const makers = tokenName === undefined ? undefined : makersOf.get(tokenName);
    // CEILING: a card that itself makes the token is skipped on its token edge (that edge also carries the `creates` reason, which would link every
    // maker of one token to each other); a maker that is also the token's payoff is joined only by a direct reason.
    if (!card || !makers || makers.includes(card)) continue;
    if (e.reasons.some((r) => !r.impliedProducer || r.producerIsToken)) for (const m of makers) link(m, card);
  }
  const seedPartners = [...(partnersOf.get(seed) ?? [])].sort();
  const seedSet = new Set(seedPartners);

  // AMPLIFIERS: a reason P -> seed whose producer ability is a REPLACEMENT (Fiery Emancipation -> Impact Tremors). The swap in `edges.ts`
  // writes `producerAbility` as an index into the producer's FACE abilities, so the tags are read per face.
  const amps = new Set<string>();
  for (const e of report.edges) for (const r of e.reasons as Reason[]) {
    // ONLY A DAMAGE REPLACEMENT: the chip is about damage vs life loss, so a token doubler or a draw doubler into the seed is no amplifier of it (the engine
    // already says what that one does). Combat and non-combat damage both count: a damage amplifier boosts either (reason tags `non-combat-damage:any` / `combat-damage:any`).
    if (!r.consumer || !r.producer || r.producerAbility === undefined || !DAMAGE_TAG.test(r.tag)) continue;
    const consumer = physicalOf.get(r.consumer), producer = physicalOf.get(r.producer);
    if (consumer !== seed || !producer || producer === seed || amps.has(producer)) continue;
    const dc = await raw(producer);
    if (!dc) continue;
    const faces = faceDeckCards(dc);
    const face = (r.producerFace !== undefined ? faces[r.producerFace] : undefined) ?? faces.find((f) => f.card.name === r.producer) ?? faces[0];
    if (face?.tags?.abilities[r.producerAbility]?.replacement === true) amps.add(producer);
  }
  const amplifiers = [...amps].sort();

  const seedDc = await raw(seed);
  if (!seedDc?.tags) { stats.comparable = false; return empty; }
  const seedCard: SimilarCard = { id: atName.get(seed)?.pos ?? index.length, name: seed, tags: seedDc.tags };

  // OFF-DECK POOL: members of the seed's output buckets (and their drain counterparts), identity-filtered on the DECODED INDEX before any card is
  // fetched, pre-ranked by how close the member's ability facts are to the seed's, capped.
  const allowed = new Set(input.commanderColorIdentity);
  const deckNames = new Set(physical);
  const best = new Map<number, number>();
  // SAME TRIGGER FIRST: in a 3,000-card output bucket hundreds tie on kind/repeats/size, and the cap would fall in name order. A member that also
  // ASKS for the event the seed triggers on is "same trigger, same result" by construction (Warstorm Surge, Terror of the Peaks for Impact Tremors).
  // The trigger keys are `demandKeysOf`'s own reading (a card's own `self` trigger is no demand); the askers are the `c` list of that key's shard.
  const triggerKeys = [...new Set((seedDc.tags.abilities ?? []).flatMap((a) =>
    !a.trigger || a.trigger.subject?.self === true ? []
      : a.trigger.verbs.flatMap((v) => splitKey(eventKey({ verb: v, subject: a.trigger!.subject } as GameEvent)))))];
  const buckets = seedBuckets(seedCard, { drainIsDamage: true });
  // ONE UNREADABLE SHARD DROPS THAT BUCKET, not the result. A READ ERROR IS NOT AN ABSENT KEY: it is tracked apart (`failed`), because "no such key" is a
  // claim about the card and a network error is not.
  const failed = new Set<string>();
  const members = (key: string): Promise<EventMembers | null> => lookup.eventMembers(key).catch(() => { failed.add(key); return null; });
  // THE SHIPPED EVENTS INDEX IS KEYED BY DEMANDED EVENTS ONLY (`supplyBuckets`), so a seed's exact output key is often absent (measured 2026-10-25:
  // 35% of seed buckets, 17% of seeds with none). Fall back to the nearest coarser key of the same verb that exists, most specific first
  // (`supplyForms` is the widening the index is built from). CEILING: the fallback bucket does not discriminate the subtype or token, so the pool cap
  // can cut exact matches; `compareCards` still gates on the exact key. A supply-keyed index would fix it, which is new static data (out of scope, owner 2026-10-25).
  const specificity = (k: string): number => k.split("|").slice(1).filter((x) => x !== "-").length;
  const resolveBucket = async (key: string): Promise<{ m: EventMembers | null; used: string; error: boolean }> => {
    const exact = await members(key);
    if (exact) return { m: exact, used: key, error: false };
    if (failed.has(key)) return { m: null, used: key, error: true };
    const verb = key.split("|")[0];
    let error = false;
    for (const f of [...supplyForms(key)].filter((f) => f !== key && f.split("|")[0] === verb).sort((x, y) => specificity(y) - specificity(x))) {
      const m = await members(f);
      if (m) return { m, used: f, error: false };
      if (failed.has(f)) error = true;
    }
    return { m: null, used: key, error };
  };
  if (buckets.length === 0) stats.comparable = false;
  const [outputs, triggers] = await Promise.all([
    Promise.all(buckets.map((b) => resolveBucket(b.key))),
    Promise.all(triggerKeys.map((k) => members(k))),
  ]);
  for (const k of triggerKeys) if (failed.has(k)) stats.errors.push(k);
  const asks = new Set<number>();
  for (const t of triggers) for (const pos of t?.c ?? []) asks.add(pos);
  buckets.forEach((b, bi) => {
    const { m, used } = outputs[bi]!;
    stats.buckets.push(b.key);
    stats.bucketSizes.push(m?.p.length ?? 0);
    if (!m) { (outputs[bi]!.error ? stats.errors : stats.missing).push(b.key); return; }
    if (used !== b.key) stats.fallbacks.push({ key: b.key, usedKey: used });
    m.p.forEach((pos, i) => {
      const c = index[pos];
      if (!c || c.isLand || deckNames.has(c.name) || !c.identity.every((x) => allowed.has(x))) return;
      const facts = m.pf?.[i] ?? [];
      const d = (facts.length === 0 ? UNKNOWN_DISTANCE : Math.min(...facts.map((n) => factDistance(n, b.facts)))) + (b.swapped ? 1 : 0) + (asks.has(pos) ? 0 : TRIGGER_MISS);
      if (d < (best.get(pos) ?? Infinity)) best.set(pos, d);
    });
  });
  const offDeck = new Map<string, number>();
  [...best].sort((x, y) => x[1] - y[1] || index[x[0]]!.name.localeCompare(index[y[0]]!.name, "en"))
    .slice(0, input.poolCap ?? DEFAULT_POOL_CAP).forEach(([pos]) => offDeck.set(index[pos]!.name, pos));

  // THE SEED'S OWN PRECOMPUTED SIMILAR ROWS. Absent record or rows = nothing.
  const seedEntry = atName.get(seed);
  if (seedEntry) {
    try {
      const rec = await lookup.cardPage(seedEntry.slug);
      const similar = rec ? (await lookup.similarOf(rec)).similar : [];
      for (const s of similar) {
        const at = atName.get(s.name);
        // The same admission as the buckets, BEFORE any card is fetched.
        if (!at || at.isLand || deckNames.has(s.name) || offDeck.has(s.name) || !at.identity.every((x) => allowed.has(x))) continue;
        offDeck.set(s.name, at.pos);
      }
    } catch (e) { console.warn("redundancy: the seed's similar rows were unreadable", e); }
  }

  // EVERY BUCKET LOST TO A READ ERROR and nothing else produced a candidate: REJECT, so the caller shows its error and retries rather than caching
  // "cannot compare" (a claim about the card) for what was the network.
  if (buckets.length > 0 && outputs.every((o) => o.error) && offDeck.size === 0) throw new Error(`redundancy: the event index could not be read (${stats.errors.join(", ")})`);
  if (buckets.length > 0 && stats.missing.length === buckets.length) stats.comparable = false;
  stats.fetched = offDeck.size;
  // ONE PREFETCH PER SHARD, ALL SETTLED BEFORE ANY READ: `prefetch` is a Promise.all over shards, so a rejecting shard would end it while the others are
  // still in flight, and `findByName` (memory only) would read null for them -- cached by `deckCards`. Run each shard's names alone instead.
  const byShard = new Map<string, string[]>();
  for (const n of [...offDeck.keys()].map(normalizeName)) { const k = shardOf(n); byShard.set(k, [...(byShard.get(k) ?? []), n]); }
  await Promise.all([...byShard.values()].map((g) => lookup.prefetch(g).catch((e) => console.warn("redundancy: a candidate shard failed", e))));
  const cardOf = async (name: string, pos: number): Promise<{ card: SimilarCard; dc: DeckCard } | null> => {
    try {
      const dc = await raw(name);
      return dc?.tags ? { card: { id: pos, name, tags: dc.tags }, dc } : null;
    } catch (e) { console.warn(`redundancy: ${name} is unreadable`, e); return null; }
  };

  const candidates: RedundancyCandidate[] = [];
  for (const name of physical) {
    if (name === seed) continue;
    const c = await cardOf(name, atName.get(name)?.pos ?? -1);
    if (c) candidates.push({ card: c.card, inDeck: true, sharedPartners: [...(partnersOf.get(name) ?? [])].filter((p) => seedSet.has(p)).sort() });
  }

  // SHARED PARTNERS FOR AN OFF-DECK CANDIDATE: the engine, only for those `compareCards` keeps. CEILING: the deck's chosen types, commander mark and
  // land types are not threaded (as `suggestForDeck` does), so a partner that needs them reads as not shared.
  const h = loadHierarchy();
  const partnerFaces = (await Promise.all(seedPartners.map(async (n) => [n, await raw(n)] as const)))
    .filter((x): x is readonly [string, DeckCard] => x[1] !== null).map(([n, d]) => [n, faceDeckCards(d)] as const);
  const sharedOf = (dc: DeckCard): string[] => {
    const mine = faceDeckCards(dc);
    return partnerFaces.filter(([, faces]) => faces.some((pf) => mine.some((cf) =>
      [...directedReasons(cf, pf, h, { tokensMediate: false }), ...directedReasons(pf, cf, h, { tokensMediate: false })].some((r) => !r.impliedProducer)))).map(([n]) => n);
  };
  let poolSize = 0;
  for (const [name, pos] of offDeck) {
    const c = await cardOf(name, pos);
    if (!c) continue;
    poolSize++;
    try {
      if (!compareCards(seedCard, c.card, { drainIsDamage: true })) continue;
      candidates.push({ card: c.card, inDeck: false, sharedPartners: sharedOf(c.dc) });
    } catch (e) { console.warn(`redundancy: ${name} could not be compared`, e); }
  }
  stats.poolSize = poolSize;
  const hits = findRedundancy({ seed: seedCard, seedPartners, candidates, amplifiers, identity: input.commanderColorIdentity }, input.perTier ? { perTier: input.perTier } : {});
  const rows: RedundancyRow[] = hits.map((h) => { const slug = atName.get(h.name)?.slug; return slug ? { ...h, slug } : h; });
  return { hits: rows, poolSize, seedPartners, amplifiers, stats };
}
