import type { CardTags, GameEvent } from "@mtg/tagger";
import type { Hierarchy } from "./types.js";
import { eventMatches, producerEvents, themeSubjectKey } from "./edges.js";
import { normalizeZoneEvent, zoneEventKey } from "./zones.js";

/** One side of the corpus event census.
 *
 *  CONSUMER rows answer "what do cards listen for, and does anything supply it": `cards` is how
 *  many cards carry a trigger normalizing to this key, `counterpart` is how many DISTINCT cards
 *  emit an event that actually matches one of those triggers. `counterpart === 0` is a supply
 *  hole -- cards waiting on an event the corpus never produces.
 *
 *  PRODUCER rows are the mirror: `cards` emit this key, `counterpart` is how many distinct cards
 *  have a trigger those emits satisfy. `counterpart === 0` is a dead emission -- an event we
 *  extract that nothing in the corpus cares about.
 *
 *  Both counterpart counts run through `eventMatches`, so subsumption is respected: a producer
 *  emitting `enters:creature:you` counts as supply for a consumer listening on
 *  `enters:permanent:any`. Counting on exact key equality instead would invent holes that the
 *  matcher does not have -- most consumers are general and most producers are specific. */
export interface CensusRow {
  key: string;
  cards: number;
  counterpart: number;
}

export interface Census {
  /** Cards examined (every card with tags, whether or not it emits or listens for anything). */
  cards: number;
  consumers: CensusRow[];
  producers: CensusRow[];
}

/** A distinct normalized event shape, with the set of cards carrying it. Card identity is the
 *  ordinal of the card in the input iteration -- the census only ever needs set sizes, never the
 *  cards themselves, so an index is enough and keeps the sets cheap. */
interface Shape {
  event: GameEvent;
  cards: Set<number>;
}

function collect(shapes: Map<string, Shape>, event: GameEvent, cardIndex: number): void {
  const k = JSON.stringify(event);
  const s = shapes.get(k) ?? { event, cards: new Set<number>() };
  s.cards.add(cardIndex);
  shapes.set(k, s);
}

/** Group distinct event shapes by verb, so matching only ever compares same-verb shapes. */
function byVerb(shapes: Map<string, Shape>): Map<string, Shape[]> {
  const out = new Map<string, Shape[]>();
  for (const s of shapes.values()) {
    const list = out.get(s.event.verb) ?? [];
    list.push(s);
    out.set(s.event.verb, list);
  }
  return out;
}

/** Roll distinct shapes up into rows keyed by `zoneEventKey`, unioning both the card sets and
 *  the matched counterpart sets. Several shapes can share one reader-facing key (e.g. two
 *  differently-stat-predicated `enters:creature` triggers), and they must not be double counted. */
function rollUp(rows: Array<{ key: string; cards: Set<number>; counterpart: Set<number> }>): CensusRow[] {
  const merged = new Map<string, { cards: Set<number>; counterpart: Set<number> }>();
  for (const r of rows) {
    const m = merged.get(r.key) ?? { cards: new Set<number>(), counterpart: new Set<number>() };
    for (const c of r.cards) m.cards.add(c);
    for (const c of r.counterpart) m.counterpart.add(c);
    merged.set(r.key, m);
  }
  return [...merged]
    .map(([key, m]) => ({ key, cards: m.cards.size, counterpart: m.counterpart.size }))
    .sort((a, b) => b.cards - a.cards || a.key.localeCompare(b.key));
}

/** Census the whole corpus: for every event key, how many cards are on each side of it and how
 *  much of the other side actually matches under the engine's own matching rules. */
export function buildCensus(cards: Iterable<CardTags>, h: Hierarchy): Census {
  const prodShapes = new Map<string, Shape>();
  const consShapes = new Map<string, Shape>();
  let n = 0;

  for (const tags of cards) {
    const i = n++;
    // Dedupe per card: a card emitting the same event from two abilities is one supplier, and a
    // card with two triggers on the same event is one consumer.
    for (const e of producerEvents(tags)) collect(prodShapes, e, i);
    for (const a of tags.abilities ?? []) {
      if (!a.trigger) continue;
      for (const v of a.trigger.verbs) collect(consShapes, normalizeZoneEvent({ verb: v, subject: a.trigger.subject }), i);
    }
  }

  const prodByVerb = byVerb(prodShapes);
  const consByVerb = byVerb(consShapes);

  const consumerRows = [...consShapes.values()].map((c) => {
    const counterpart = new Set<number>();
    for (const p of prodByVerb.get(c.event.verb) ?? []) {
      if (eventMatches(p.event, c.event, h)) for (const card of p.cards) counterpart.add(card);
    }
    return { key: zoneEventKey(c.event.verb, c.event.subject.zone, themeSubjectKey(c.event.subject)), cards: c.cards, counterpart };
  });

  const producerRows = [...prodShapes.values()].map((p) => {
    const counterpart = new Set<number>();
    for (const c of consByVerb.get(p.event.verb) ?? []) {
      if (eventMatches(p.event, c.event, h)) for (const card of c.cards) counterpart.add(card);
    }
    return { key: zoneEventKey(p.event.verb, p.event.subject.zone, themeSubjectKey(p.event.subject)), cards: p.cards, counterpart };
  });

  return { cards: n, consumers: rollUp(consumerRows), producers: rollUp(producerRows) };
}
