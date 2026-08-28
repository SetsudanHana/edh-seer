import type { CardTags, GameEvent, SubjectFilter, Verb } from "@edh-seer/tagger";
import type { Hierarchy } from "./types.js";
import { COMBAT_VERBS, combatNarrowsByType, combatSelfSupplied, eventMatches, producerEvents } from "./edges.js";
import { normalizeZoneEvent, zoneEventKey } from "./zones.js";

const list = (v: string | string[] | undefined): string[] =>
  v === undefined ? [] : Array.isArray(v) ? v : [v];

/** The census groups by the subject's FULL breadth, unlike `themeSubjectKey`, which takes only
 *  the first type because a reason tag wants one short noun.
 *
 *  Rolling up on the first type merges shapes of wildly different breadth into one row and unions
 *  their counterpart sets: 16 distinct consumer shapes key to `cast:instant` under
 *  `themeSubjectKey`, one of them `[instant, sorcery, artifact, enchantment, planeswalker]`
 *  matching 10096 cards, which inflated that row to 19277 suppliers. Sorted so member order
 *  cannot split a row.
 *
 *  Prefixed with `subtype:`/`type:`/`any` so the two dimensions can never collide: a subject with
 *  `subtype: "creature"` (a tagger mis-extraction) and one with `type: "creature"` are different
 *  shapes and must not roll up into the same row -- one bad subtype-keyed shape merging into 17
 *  correctly self-supplied `type:creature` shapes previously dragged 287 correct listeners into
 *  the SATURATED table. */
function censusSubjectKey(s: SubjectFilter): string {
  const subtypes = list(s.subtype);
  if (subtypes.length > 0) return "subtype:" + [...subtypes].sort().join("+");
  const types = list(s.type);
  if (types.length > 0) return "type:" + [...types].sort().join("+");
  return "any";
}

const censusKey = (e: GameEvent): string => zoneEventKey(e.verb, e.subject.zone, censusSubjectKey(e.subject));

/** A consumer row's key, marked when a combat trigger NARROWS on something the subject key does not
 *  carry.
 *
 *  `censusSubjectKey` encodes only type and subtype, but `combatSelfSupplied` also reads `stats`,
 *  `counter`, `chosenType`, `colors` and `token`. So two shapes could share a key while disagreeing
 *  on the very property the tables partition on -- and `rollUp` AND-merges `selfSupplied`, so one
 *  narrowed shape flipped the whole row. On the live corpus that emptied the SELF-SUPPLIED table
 *  outright: all four non-narrowing combat keys had at least one narrowed shape hiding in them, so
 *  `attacks:any` reported 1463 correctly self-supplied listeners as a dense low-information edge
 *  class instead.
 *
 *  Marking the key splits them into two homogeneous rows -- `attacks:any` (the game supplies it) and
 *  `attacks:any (narrowed)` (Garruk's Uprising and friends, which need real creatures). Applied to
 *  consumer rows only: producers are never self-supplied, so their keys never split. */
function consumerKey(e: GameEvent, selfSupplied: boolean): string {
  const marked =
    COMBAT_VERBS.has(e.verb) && !selfSupplied && !combatNarrowsByType(e.subject);
  return censusKey(e) + (marked ? " (narrowed)" : "");
}

/** A stand-in for the implied combat event `impliedEvents` would synthesize for this verb, so the
 *  census can ask `combatSelfSupplied` the same question the matcher asks: "would a synthetic
 *  implied producer be this consumer's only possible supplier?" The subject content doesn't matter
 *  to that answer -- only `implied: true` and the verb do. */
function impliedCombatProducer(verb: Verb): GameEvent {
  return { verb, subject: { control: "any", token: null }, implied: true };
}

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
  /** How many distinct event shapes rolled up into this row. Rows above 1 still merge shapes that
   *  differ in control/token/zone/stats, so a high count is a hint to look at the shapes before
   *  trusting the row. */
  shapes: number;
  /** Consumer rows only: an implied combat event (every creature can attack) would be this
   *  trigger's only possible supplier, so zero suppliers is by design, not a gap. See
   *  `combatSelfSupplied`. */
  selfSupplied: boolean;
  /** Producer rows only: at least one card reaches this key through an emit the tagger actually
   *  authored, rather than only through an event `producerEvents` derives (implied cast/enters/
   *  combat, graveyard fills, proliferate counters).
   *
   *  Only authored rows can indicate an extraction problem. A derived row with no listener just
   *  means no card in the corpus happens to care -- `attacks:spirit` has 158 emitters and no
   *  listener because every Spirit creature implies an attack and no card pays off Spirits
   *  attacking specifically. That is a fact about Magic, not a bug in the pipeline. */
  authored: boolean;
  /** Only when `buildCensus` is called with `{ members: true }`: which input cards, by their
   *  ordinal in the iteration, are counted in `cards` and `counterpart`.
   *
   *  Off by default because the corpus census runs over ~34k cards and would retain an index array
   *  per row for a caller that only ever prints the counts. Deck-scoped callers need identity --
   *  "is the supplier the COMMANDER" is not a question a count can answer. */
  cardIndices?: readonly number[];
  counterpartIndices?: readonly number[];
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
  authored: boolean;
}

function collect(shapes: Map<string, Shape>, event: GameEvent, cardIndex: number, authored = false): void {
  const k = JSON.stringify(event);
  const s = shapes.get(k) ?? { event, cards: new Set<number>(), authored: false };
  s.cards.add(cardIndex);
  s.authored ||= authored;
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
type RawRow = { key: string; cards: Set<number>; counterpart: Set<number>; selfSupplied: boolean; authored: boolean };

function rollUp(rows: RawRow[], members = false): CensusRow[] {
  const merged = new Map<string, { cards: Set<number>; counterpart: Set<number>; shapes: number; selfSupplied: boolean; authored: boolean }>();
  for (const r of rows) {
    const m = merged.get(r.key) ?? { cards: new Set<number>(), counterpart: new Set<number>(), shapes: 0, selfSupplied: r.selfSupplied, authored: false };
    for (const c of r.cards) m.cards.add(c);
    for (const c of r.counterpart) m.counterpart.add(c);
    m.shapes++;
    // A row is only by-design unsupplied if EVERY shape in it is; a mixed row is a real gap.
    m.selfSupplied &&= r.selfSupplied;
    // ...but one authored shape is enough to make the row worth reading as extraction output.
    m.authored ||= r.authored;
    merged.set(r.key, m);
  }
  return [...merged]
    .map(([key, m]) => ({
      key, cards: m.cards.size, counterpart: m.counterpart.size, shapes: m.shapes,
      selfSupplied: m.selfSupplied, authored: m.authored,
      ...(members ? { cardIndices: [...m.cards], counterpartIndices: [...m.counterpart] } : {}),
    }))
    .sort((a, b) => b.cards - a.cards || a.key.localeCompare(b.key));
}

/** Census the whole corpus: for every event key, how many cards are on each side of it and how
 *  much of the other side actually matches under the engine's own matching rules. */
export function buildCensus(
  cards: Iterable<CardTags>,
  h: Hierarchy,
  opts: { members?: boolean } = {},
): Census {
  const prodShapes = new Map<string, Shape>();
  const consShapes = new Map<string, Shape>();
  let n = 0;

  for (const tags of cards) {
    const i = n++;
    // Dedupe per card: a card emitting the same event from two abilities is one supplier, and a
    // card with two triggers on the same event is one consumer.
    const authored = new Set(
      (tags.abilities ?? []).flatMap((a) => a.emits ?? []).map((e) => JSON.stringify(normalizeZoneEvent(e))),
    );
    for (const e of producerEvents(tags)) collect(prodShapes, e, i, authored.has(JSON.stringify(e)));
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
    // A SELF TRIGGER IS SELF-SUPPLIED, for the same reason combat and phases are: there is no card
    // to draw. "When THIS creature enters, draw a card" fires when you play the card; nothing else
    // in the deck has to supply it, and counting it as an unmet demand is a false alarm.
    //
    // MEASURED ON THE PRECON: the availability panel printed "a creature entering the battlefield —
    // 4 want · 0 supply" over a deck the tool's own graph counts as 51 creatures, and the skeptic
    // persona checked it against that legend and called it broken (2026-08-27). All four consumers
    // were `enters {type: creature, self: true}` — Dire Fleet Ravager, Irregular Cohort and
    // Puppeteer Clique twice, every one a card whose OWN entry triggers. The count was right and the
    // sentence around it was wrong: 0 was the number of external suppliers such a trigger needs.
    //
    // `consumerKey` marks only COMBAT verbs, so no key moves here — the flag changes what the row
    // MEANS to `deckAvailability` (`available: null`, a refusal rather than a probability), not
    // which row it is.
    const selfSupplied = c.event.subject.self === true
      || combatSelfSupplied(impliedCombatProducer(c.event.verb), c.event);
    return { key: consumerKey(c.event, selfSupplied), cards: c.cards, counterpart, selfSupplied, authored: true };
  });

  const producerRows = [...prodShapes.values()].map((p) => {
    const counterpart = new Set<number>();
    for (const c of consByVerb.get(p.event.verb) ?? []) {
      if (eventMatches(p.event, c.event, h)) for (const card of c.cards) counterpart.add(card);
    }
    return { key: censusKey(p.event), cards: p.cards, counterpart, selfSupplied: false, authored: p.authored };
  });

  return {
    cards: n,
    consumers: rollUp(consumerRows, opts.members),
    producers: rollUp(producerRows, opts.members),
  };
}
