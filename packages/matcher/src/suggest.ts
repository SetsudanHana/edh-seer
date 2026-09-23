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

// ---------------------------------------------------------------------------------------------
// REPLACEMENT PAIRS (spec §3)

/** A cut-list row, as the pairing needs it: its build leaves and how many deck cards it connects to. */
export interface CutSide { name: string; roles: readonly string[]; connections: number }
/** A build group (`buildParents` row) with its cost band. */
export interface GroupState {
  name: string;
  count: number;
  target: number;
  leaves: readonly string[];
  costBand: readonly [number, number];
}
export interface CountChange { group: string; from: number; to: number }
export interface Replacement {
  cut: string;
  add: Candidate;
  rule: "cross-job" | "same-job" | "no-role";
  counts: CountChange[];
}

/** THREE RULES, CROSS-JOB CHECKED FIRST (owner 2026-09-24: "if you have too much ramp and lack
 *  removal you can suggest synergistic removal in replacement of ramp"). Where the cut's group is
 *  over target and another is short, the swap moves a slot across; otherwise it stays inside its
 *  job, and a cut with no role takes a plan card.
 *
 *  AN ADD MUST OUT-CONNECT THE CUT or there is no pair -- a sideways swap is advice with nothing
 *  behind it. Each add is used once, and the running counts move with every cross-job pair, so the
 *  surplus that justified the first swap is not spent twice. */
export function pairReplacements(
  cuts: readonly CutSide[], groups: readonly GroupState[],
  pool: ReadonlyMap<number, Candidate>, plan: readonly Candidate[],
): Replacement[] {
  const count = new Map(groups.map((g) => [g.name, g.count] as const));
  const shortBy = (g: GroupState): number => (g.target - count.get(g.name)!) / g.target;
  const used = new Set<number>();
  const firstBetter = (list: readonly Candidate[], than: number): Candidate | undefined =>
    list.find((c) => !used.has(c.card.pos) && c.connections.length > than);
  const out: Replacement[] = [];
  for (const cut of cuts) {
    // A CUT FILLING TWO GROUPS' LEAVES takes the first in `buildParents` order (Consistency, Ramp,
    // Interaction, Board wipes). A ruling, not a finding: no rule here can say which job a
    // double-duty card is "really" doing, and the order is the report's own.
    const g = groups.find((x) => x.leaves.some((l) => cut.roles.includes(l)));
    let pick: Replacement | undefined;
    if (g && count.get(g.name)! > g.target) {
      const short = groups
        .filter((u) => u !== g && u.target > 0 && count.get(u.name)! < u.target)
        .sort((a, b) => shortBy(b) - shortBy(a))[0];
      const add = short && firstBetter(gapList(pool, short.leaves, short.costBand, Infinity), cut.connections);
      if (short && add) {
        const gFrom = count.get(g.name)!;
        const uFrom = count.get(short.name)!;
        count.set(g.name, gFrom - 1);
        count.set(short.name, uFrom + 1);
        pick = { cut: cut.name, add, rule: "cross-job", counts: [
          { group: g.name, from: gFrom, to: gFrom - 1 }, { group: short.name, from: uFrom, to: uFrom + 1 }] };
      }
    }
    if (!pick && g) {
      const add = firstBetter(gapList(pool, g.leaves, g.costBand, Infinity), cut.connections);
      if (add) pick = { cut: cut.name, add, rule: "same-job", counts: [] };
    }
    if (!pick && !g) {
      const add = firstBetter(plan, cut.connections);
      if (add) pick = { cut: cut.name, add, rule: "no-role", counts: [] };
    }
    if (pick) {
      used.add(pick.add.card.pos);
      out.push(pick);
    }
  }
  return out;
}
