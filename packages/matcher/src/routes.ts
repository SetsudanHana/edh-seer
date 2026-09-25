import type { Reason } from "@edh-seer/engine";

/** One step of a route: the engine's own reason, and the abilities it leaves and lands on. */
export interface RouteHop { from: string; to: string; fromAbility?: number; toAbility?: number; tag: string; text: string }
/** A card reaching another, hop by hop. */
export interface Route { from: string; to: string; hops: RouteHop[] }

/** THE REASONS A ROUTE CAN USE, by producer card: a search scans only the hops leaving the card it is
 *  at. Built once and extended per candidate by the suggestion check, which asks many questions of
 *  one deck (final review of ability routes, PR 2). */
export type RouteIndex = ReadonlyMap<string, readonly Reason[]>;

/** Keeps only reasons that can be a hop -- two different cards, landing on a real triggered ability
 *  or on a token node -- grouped by producer. */
export function indexRoutes(reasons: readonly Reason[]): RouteIndex {
  return extendRoutes(new Map(), reasons);
}

const isRouteIndex = (x: readonly Reason[] | RouteIndex): x is RouteIndex => x instanceof Map;

/** A new index: `base` plus `more`. `base` is never mutated. */
export function extendRoutes(base: RouteIndex, more: readonly Reason[]): RouteIndex {
  const out = new Map(base);
  for (const r of more) {
    if (r.producer === undefined || r.consumer === undefined || r.producer === r.consumer) continue;
    if (r.consumerAbility === undefined && r.consumerIsToken !== true) continue;
    out.set(r.producer, [...(out.get(r.producer) ?? []), r]);
  }
  return out;
}

/** A stop in the search: which card (a token node is its own stop), which face, and which ability
 *  the chain arrived at. `ability` is "made" when the hop created a token node: its implied events
 *  are what that hop caused. */
interface Stop { card: string; token: boolean; face: number; ability: number | "made" | "any" }
const stopKey = (s: Stop): string => `${s.token ? "t" : "c"}\u0000${s.card}\u0000${s.face}\u0000${s.ability}`;

/** WHOLE ROUTES FROM A TO B (spec 2026-09-25), CONTINUOUS AT THE LEVEL OF THE ABILITY. Breadth-first
 *  over (card, face, ability) stops: from A any hop leaves (A may act by merely existing); from a
 *  stop (X, f, k) only a hop whose producer is X on face f with `producerAbility === k` leaves; a hop
 *  into a token node may be followed by the token's own implied events. Every hop but one into a
 *  token must land on a real triggered ability. A stop is visited once, so every route is a simple
 *  path -- loops are W16's, refused here by construction. Returns every shortest route. */
export function findRoutes(reasons: readonly Reason[] | RouteIndex, from: string, to: string, opts: { maxHops?: number } = {}): Route[] {
  const maxHops = opts.maxHops ?? 4;
  const index = isRouteIndex(reasons) ? reasons : indexRoutes(reasons);
  const leaves = (s: Stop, r: Reason): boolean => {
    if (r.producer !== s.card || (r.producerIsToken === true) !== s.token) return false;
    if (s.ability === "any") return true;
    if (s.ability === "made") return r.producerAbility === undefined;
    return (r.producerFace ?? 0) === s.face && r.producerAbility === s.ability;
  };
  const start: Stop = { card: from, token: false, face: 0, ability: "any" };
  let frontier: { stop: Stop; path: RouteHop[] }[] = [{ stop: start, path: [] }];
  const seen = new Set([stopKey(start)]);
  const found: Route[] = [];
  for (let depth = 1; depth <= maxHops && found.length === 0 && frontier.length > 0; depth++) {
    const next: { stop: Stop; path: RouteHop[] }[] = [];
    const reachedThisDepth = new Set<string>();
    for (const { stop, path } of frontier) {
      for (const r of index.get(stop.card) ?? []) {
        if (!leaves(stop, r)) continue;
        const hop: RouteHop = {
          from: r.producer!, to: r.consumer!, tag: r.tag, text: r.text,
          ...(r.producerAbility !== undefined ? { fromAbility: r.producerAbility } : {}),
          ...(r.consumerAbility !== undefined ? { toAbility: r.consumerAbility } : {}),
        };
        const token = r.consumerIsToken === true;
        if (!token && r.consumer === to) { found.push({ from, to, hops: [...path, hop] }); continue; }
        const stop2: Stop = token
          ? { card: r.consumer!, token: true, face: 0, ability: "made" }
          : { card: r.consumer!, token: false, face: r.consumerFace ?? 0, ability: r.consumerAbility! };
        const k = stopKey(stop2);
        if (seen.has(k)) continue;
        reachedThisDepth.add(k);
        next.push({ stop: stop2, path: [...path, hop] });
      }
    }
    for (const k of reachedThisDepth) seen.add(k);
    frontier = next;
  }
  return found;
}
