import type { EdgeMagnitude, Reason } from "@edh-seer/engine";
import type { SubjectFilter } from "@edh-seer/tagger";
import type { DeckCard } from "./types.js";
import { emitSubjectNoun } from "./sentence.js";

/** EDGE MAGNITUDE (spec 2026-09-29): consumer firings per use of the producer, as an interval.
 *  Display data -- nothing here adds, removes or weighs a claim.
 *
 *  THE TAG FAMILIES THAT ARE EVENT COUNTS. An ALLOW-LIST, the `MAGNITUDE_VERBS` precedent: a family
 *  added later is silently left without a magnitude (honest) rather than silently read as one.
 *  Everything else -- static, scales, tutor, recursion-target, ramp-target, fodder, threshold,
 *  copies, land-condition, reuse, doubles, cheat, keyword-grant, pump, clone -- is a RELATION, and
 *  a count of 1 would be a false statement about it. CEILING: a per-unit relation magnitude (an
 *  anthem per creature) is a separate design. */
export const MAGNITUDE_EVENT_FAMILIES: ReadonlySet<string> = new Set([
  "enters", "cast", "dies", "attacks", "counter-added", "counter-removed", "prowess", "draw", "creates",
  "create-token", "enters-graveyard", "graveyard-recursion", "leaves", "leaves-graveyard", "damaged",
  "non-combat-damage", "combat-damage", "sacrifice", "copy", "proliferate", "lose-life", "gain-life",
  "discard", "exiled", "scry", "surveil", "mill", "untaps", "taps", "search", "loses-game",
]);

/** The display noun for what an open ceiling grows with. */
export function scalesNoun(s: "mana" | SubjectFilter | undefined): string | undefined {
  if (s === undefined) return undefined;
  if (s === "mana") return "mana";
  const noun = (emitSubjectNoun(s) ?? "a permanent").replace(/^an? /, "");
  return s.control === "you" ? `${noun} you control` : s.control === "opp" ? `${noun} an opponent controls` : noun;
}

const isDefault = (m: EdgeMagnitude): boolean =>
  m.floor === 1 && m.ceiling === 1 && !m.instant && !m.batched && !m.unknown && m.scalesWith === undefined;

const castsAtInstantSpeed = (dc: DeckCard): boolean => {
  const ch = dc.tags?.characteristics;
  return (ch?.types ?? []).some((t) => t.toLowerCase() === "instant")
    || (ch?.keywords ?? []).some((k) => k.toLowerCase() === "flash");
};

/** One reason's magnitude. `p` and `c` are the nodes the reason was made between -- a face node
 *  carries its own face's ability list, which is what `producerAbility` indexes. */
export function magnitudeOf(r: Reason, p: DeckCard, c: DeckCard): EdgeMagnitude | undefined {
  if (!MAGNITUDE_EVENT_FAMILIES.has(r.tag.split(":")[0]!)) return undefined;
  const pa = r.producerAbility !== undefined ? p.tags?.abilities[r.producerAbility] : undefined;
  const ca = r.consumerAbility !== undefined ? c.tags?.abilities[r.consumerAbility] : undefined;
  let m: EdgeMagnitude;
  if (!pa) {
    // The card's own cast, entry or death: one event, as fast as the card is cast.
    m = { floor: 1, ceiling: 1, ...(castsAtInstantSpeed(p) ? { instant: true as const } : {}) };
  } else {
    // A replacement that repeats the improved count reads the IMPROVED ability's own count.
    const count = pa.count?.sameAsImproved ? ca?.count : pa.count;
    const noun = scalesNoun(count?.scalesWith);
    m = count && !count.sameAsImproved
      ? { floor: count.floor, ceiling: count.ceiling, ...(noun ? { scalesWith: noun } : {}) }
      : { floor: 1, ceiling: 1, unknown: true };
    if ((pa.emits ?? []).some((e) => e.instantSpeed === true)) m.instant = true;
  }
  // "ONE OR MORE": the consumer hears the whole batch once (CR 603.2c).
  if (ca?.trigger?.batched) {
    const { scalesWith: _s, ...rest } = m;
    m = { ...rest, floor: Math.min(m.floor, 1), ceiling: 1, batched: true };
  }
  return isDefault(m) ? undefined : m;
}

const DEFAULT: EdgeMagnitude = { floor: 1, ceiling: 1 };

/** Two readings of one claim: keep the larger ceiling (unbounded wins), then the larger floor;
 *  instant if either is. Undefined is the 1–1 default. */
export function mergeMagnitude(a: EdgeMagnitude | undefined, b: EdgeMagnitude | undefined): EdgeMagnitude | undefined {
  if (!a) return b;
  if (!b) return a;
  const ceil = (m: EdgeMagnitude) => (m.ceiling === null ? Infinity : m.ceiling);
  const win = ceil(b) > ceil(a) || (ceil(b) === ceil(a) && b.floor > a.floor) ? b : a;
  return a.instant || b.instant ? { ...win, instant: true } : win;
}

/** A route's magnitude: the product along its hops. Unbounded absorbs; a batched hop caps the
 *  whole route at one, since the payoff hears everything the chain made as one batch. Only the
 *  FIRST hop's timing is the player's action -- a later hop is a trigger. */
export function routeMagnitude(hops: readonly (EdgeMagnitude | undefined)[]): EdgeMagnitude | undefined {
  if (hops.every((h) => h === undefined)) return undefined;
  let floor = 1;
  let ceiling: number | null = 1;
  let scalesWith: string | undefined;
  let batched = false;
  let unknown = false;
  for (const h of hops.map((x) => x ?? DEFAULT)) {
    floor *= h.floor;
    ceiling = ceiling === 0 || h.ceiling === 0 ? 0 : ceiling === null || h.ceiling === null ? null : ceiling * h.ceiling;
    scalesWith ??= h.scalesWith;
    batched ||= h.batched === true;
    unknown ||= h.unknown === true;
  }
  const m: EdgeMagnitude = batched
    ? { floor: Math.min(floor, 1), ceiling: 1, batched: true }
    : { floor, ceiling, ...(scalesWith ? { scalesWith } : {}) };
  if (hops[0]?.instant) m.instant = true;
  if (unknown) m.unknown = true;
  return isDefault(m) ? undefined : m;
}
