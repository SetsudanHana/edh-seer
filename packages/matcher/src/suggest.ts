/** DECK SUGGESTIONS, THE PURE HALF (spec docs/superpowers/specs/2026-09-24-deck-suggestions-design.md,
 *  roadmap AO3). The browser orchestrator (`suggest-static.ts`) feeds these from the static
 *  artifacts; nothing here fetches or reads the engine.
 *
 *  NO POPULARITY, NO QUALITY JUDGEMENT. Order is how many of THIS deck's cards connect to a
 *  candidate, then the sum of those edges' scores, then the cheaper card. Nothing here says one
 *  removal spell is better than another; it says which one this deck is more connected to -- the
 *  same line `cut-list.ts` holds ("nothing here ranks two ramp cards against each other"). */

/** One name-index row, decoded: `roles` from `r`, `answers` from `a`, `isLand` from `t`. */
export interface IndexCard {
  pos: number;
  name: string;
  slug: string;
  identity: string[];
  isLand: boolean;
  mv: number;
  roles: string[];
  answers: string[];
}

export interface DeckSide {
  /** Physical names in the deck (`cardName ?? name`), for "already in the deck". */
  names: ReadonlySet<string>;
  /** The commander identity, already the union for a partner pair. Empty = colourless. */
  identity: ReadonlySet<string>;
  /** Nonland deck card -> its `pi`. A card with no `pi` is simply absent. */
  pi: ReadonlyMap<string, readonly (readonly [number, number])[]>;
}

export interface Connection { deckCard: string; score: number }
export interface Candidate { card: IndexCard; connections: Connection[]; score: number }

/** THE POOL: every card some deck card lists as a partner, minus lands, cards already in the deck
 *  and cards outside the commander's identity. Legality is the name index itself -- it ships no
 *  banned card (measured 2026-09-24) -- so a position it lacks is skipped, never guessed at. */
export function candidatePool(deck: DeckSide, index: readonly IndexCard[]): Map<number, Candidate> {
  const pool = new Map<number, Candidate>();
  for (const [deckCard, ids] of deck.pi) {
    for (const [pos, score] of ids) {
      const card = index[pos];
      if (!card || card.isLand || deck.names.has(card.name)) continue;
      if (!card.identity.every((c) => deck.identity.has(c))) continue;
      const c = pool.get(pos) ?? { card, connections: [], score: 0 };
      if (c.connections.some((x) => x.deckCard === deckCard)) continue;
      c.connections.push({ deckCard, score });
      c.score += score;
      pool.set(pos, c);
    }
  }
  for (const c of pool.values()) c.connections.sort((a, b) => b.score - a.score);
  return pool;
}

/** Distinct deck connections, then total score, then the cheaper card, then the name so the order
 *  is stable across runs. */
export function byConnection(a: Candidate, b: Candidate): number {
  return b.connections.length - a.connections.length || b.score - a.score || a.card.mv - b.card.mv
    || a.card.name.localeCompare(b.card.name, "en");
}

/** "STRENGTHEN WHAT WORKS": two connections at least -- one is a pair, not a plan. */
export function planList(pool: ReadonlyMap<number, Candidate>, limit = 8): Candidate[] {
  return [...pool.values()].filter((c) => c.connections.length >= 2).sort(byConnection).slice(0, limit);
}

const inBand = (c: Candidate, [lo, hi]: readonly [number, number]): boolean => c.card.mv >= lo && c.card.mv <= hi;
const bandFirst = (band: readonly [number, number]) => (a: Candidate, b: Candidate): number =>
  Number(inBand(b, band)) - Number(inBand(a, band)) || byConnection(a, b);

/** A SHORT BUILD GROUP'S CARDS: those filling one of its leaves, the group's cost band first. An
 *  empty answer is an answer -- the caller says so in words rather than padding the list. */
export function gapList(
  pool: ReadonlyMap<number, Candidate>, leaves: readonly string[], costBand: readonly [number, number],
  limit: number, exclude: ReadonlySet<number> = new Set(),
): Candidate[] {
  return [...pool.values()]
    .filter((c) => !exclude.has(c.card.pos) && c.card.roles.some((r) => leaves.includes(r)))
    .sort(bandFirst(costBand)).slice(0, limit);
}

/** A MISSING ANSWER CLASS'S CARDS: those that answer it, ranked as a gap. */
export function answerList(
  pool: ReadonlyMap<number, Candidate>, cls: string, costBand: readonly [number, number],
  limit: number, exclude: ReadonlySet<number> = new Set(),
): Candidate[] {
  return [...pool.values()]
    .filter((c) => !exclude.has(c.card.pos) && c.card.answers.includes(cls))
    .sort(bandFirst(costBand)).slice(0, limit);
}
