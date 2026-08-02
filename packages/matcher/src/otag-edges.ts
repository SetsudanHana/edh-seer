import { OTAG_EVENT_TO_VERB, type SlugSemantics } from "@mtg/tagger";

/** A directed otag edge: `a` produces `verb`, `b` triggers on it. */
export interface OtagEdge {
  a: string;
  b: string;
  verb: string;
}

/** Order-independent key for an unordered pair of card names. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Verbs a card produces and consumes, from its slugs. Only edge-bearing slugs count, and
 *  only events with a real engine Verb -- a null-Verb event can never pair with anything.
 *  Returns Sets, so this is per-verb PRESENCE, not per-slug multiplicity: if two edge-bearing
 *  slugs on the same card both produce "dies", that's one Set entry, and buildOtagEdges emits
 *  exactly one (a, b, "dies") edge regardless. A future task counting raw edges per verb needs
 *  a different data structure here -- this one collapses that count away by design. */
function verbsFor(
  slugs: string[],
  semantics: Map<string, SlugSemantics>,
): { produces: Set<string>; consumes: Set<string> } {
  const produces = new Set<string>();
  const consumes = new Set<string>();
  for (const slug of slugs) {
    const s = semantics.get(slug);
    if (!s || !s.uses.includes("edge")) continue;
    for (const ev of s.events) {
      const verb = OTAG_EVENT_TO_VERB[ev.event];
      if (!verb) continue;
      (ev.role === "producer" ? produces : consumes).add(verb);
    }
  }
  return { produces, consumes };
}

/**
 * oTag-derived edges for one deck. Both sides must carry a classified, edge-bearing slug --
 * there are deliberately no structural producers, so "any creature dies" contributes nothing.
 * Matching is on verb equality alone: SlugSemantics carries no subject filter, so a
 * sacrifice-outlet-artifact will pair with a creature-death payoff. That imprecision is
 * measured rather than papered over (see the subject-blindness attribution in otag-measure).
 */
export function buildOtagEdges(
  names: string[],
  otagsByCard: Map<string, string[]>,
  semantics: Map<string, SlugSemantics>,
): OtagEdge[] {
  const verbs = new Map(names.map((n) => [n, verbsFor(otagsByCard.get(n) ?? [], semantics)]));
  const edges: OtagEdge[] = [];
  for (const a of names) {
    for (const b of names) {
      if (a === b) continue;
      const pa = verbs.get(a)!.produces;
      const cb = verbs.get(b)!.consumes;
      for (const verb of pa) if (cb.has(verb)) edges.push({ a, b, verb });
    }
  }
  return edges;
}

/** Distinct unordered pairs touched by any edge. */
export function undirectedPairs(edges: OtagEdge[]): Set<string> {
  return new Set(edges.map((e) => pairKey(e.a, e.b)));
}
