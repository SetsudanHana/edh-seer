import type { CardTags, GameEvent, SubjectFilter, Verb } from "@edh-seer/tagger";
import { CONSUMER_ONLY } from "@edh-seer/tagger/verb-accounting";
import type { Hierarchy } from "./types.js";
import { COMBAT_VERBS, castSelfSupplied, combatNarrowsByType, combatSelfSupplied, eventMatches, producerEvents, punishesItsActor } from "./edges.js";
import { OTHER_PLAYER_SUFFIX, WILDCARD_SUBJECT, normalizeZoneEvent, zoneEventKeyRaw } from "./zones.js";
import { ALSO_SUPPLIED_BY } from "./suggest-keys.js";

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
 *  Prefixed with `subtype:`/`type:`, or the `*` wildcard, so the two dimensions can never collide: a subject with
 *  `subtype: "creature"` (a tagger mis-extraction) and one with `type: "creature"` are different
 *  shapes and must not roll up into the same row -- one bad subtype-keyed shape merging into 17
 *  correctly self-supplied `type:creature` shapes previously dragged 287 correct listeners into
 *  the SATURATED table. */
function censusSubjectKey(s: SubjectFilter): string {
  const subtypes = list(s.subtype);
  if (subtypes.length > 0) return "subtype:" + [...subtypes].sort().join("+");
  const types = list(s.type);
  if (types.length > 0) return "type:" + [...types].sort().join("+");
  return WILDCARD_SUBJECT;
}

const censusKey = (e: GameEvent): string => zoneEventKeyRaw(e.verb, e.subject.zone, censusSubjectKey(e.subject));

/** A consumer row's key, marked when a combat trigger NARROWS on something the subject key does not
 *  carry.
 *
 *  `censusSubjectKey` encodes only type and subtype, but `combatSelfSupplied` also reads `stats`,
 *  `counter`, `chosenType`, `chosenColor`, `colors` and `token`. So two shapes could share a key while disagreeing
 *  on the very property the tables partition on -- and `rollUp` AND-merges `selfSupplied`, so one
 *  narrowed shape flipped the whole row. On the live corpus that emptied the SELF-SUPPLIED table
 *  outright: all four non-narrowing combat keys had at least one narrowed shape hiding in them, so
 *  `attacks:any` reported 1463 correctly self-supplied listeners as a dense low-information edge
 *  class instead.
 *
 *  Marking the key splits them into two homogeneous rows -- `combat-damage:any` (the game supplies
 *  it) and `combat-damage:any (narrowed)` (payoffs that need real creatures). `attacks` no longer
 *  splits: since #561 every creature supplies it, so nothing on that verb is self-supplied. Applied to
 *  consumer rows only: producers are never self-supplied, so their keys never split. */
function consumerKey(e: GameEvent, selfSupplied: boolean, punisher = false): string {
  // `attacks` never self-supplies since #561 (owner ruling 2026-09-27), so it has no split to mark.
  const marked =
    COMBAT_VERBS.has(e.verb) && e.verb !== "attacks" && !selfSupplied && !combatNarrowsByType(e.subject);
  // A PUNISHER'S ROW IS ITS OWN (#1598): `rollUp` unions the supplier sets of every shape on a key, so False Cure rolled into
  // "whenever you gain life" would be handed back the lifegain its own shape refused. No combat verb is a player's action
  // (`PLAYER_ACTION_VERBS`), so a key carries one mark at most.
  return censusKey(e) + (marked ? " (narrowed)" : "") + (punisher ? OTHER_PLAYER_SUFFIX : "");
}

/** A stand-in for the implied event `impliedEvents` would synthesize for this verb (an attack, a cast), so the
 *  census can ask `combatSelfSupplied` and `castSelfSupplied` the same question the matcher asks: "would a synthetic
 *  implied producer be this consumer's only possible supplier?" The subject content doesn't matter
 *  to that answer -- only `implied: true` and the verb do. */
function impliedProducer(verb: Verb): GameEvent {
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
  /** Consumer rows only: an implied event (every creature can attack, every spell is cast) would be this
   *  trigger's only possible supplier, so zero suppliers is by design, not a gap. See
   *  `combatSelfSupplied` and `castIsDeckLevel`. */
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
  /** Consumer shapes only: the trigger is a symmetric punisher's (`punishesItsActor`), so a `control: you` producer is not its supply. */
  punisher: boolean;
}

function collect(shapes: Map<string, Shape>, event: GameEvent, cardIndex: number, authored = false, punisher = false): void {
  const k = JSON.stringify(event) + (punisher ? OTHER_PLAYER_SUFFIX : "");
  const s = shapes.get(k) ?? { event, cards: new Set<number>(), authored: false, punisher };
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
/** `ALSO_SUPPLIED_BY` turned round: the consumer verbs a producer verb can also satisfy. */
const SUPPLIES: Record<string, string[]> = {};
for (const [consumer, producers] of Object.entries(ALSO_SUPPLIED_BY)) {
  for (const p of producers) (SUPPLIES[p] ??= []).push(consumer);
}

/** YOUR OWN PRODUCER IS NOT SUPPLY FOR A SYMMETRIC PUNISHER (#1598, after #1591). The matcher refuses the edge from a
 *  `control: you` producer into "whenever a player gains life, that player loses ..." (False Cure); the census asks the same
 *  predicate, `punishesItsActor`, so its supplier set for such a trigger is the cards the graph draws an edge from. Measured on
 *  the issue's decks: False Cure + three cards that gain you life read `gain-life:*` 1 want / 3 supply over 0 edges, now 1 / 0.
 *  The predicate needs the card's PRINTED text ("that player" / "they"), which `CardTags` does not carry: `opts.oracleTexts`
 *  supplies it, aligned with `cards` by ordinal.
 *  CEILING: a caller that passes no `oracleTexts` gets the count from the trigger alone: no row is marked and your own producers
 *  still count as supply for a punisher. Both callers pass it today (`deckAvailability`, `research/matcher/event-census.ts`). */
/** ANOTHER PLAYER'S ROUTINE ACTION HAPPENS ON ITS OWN (owner ruling 2026-11-11, #1598). A demand only another player can satisfy
 *  by casting a spell, drawing a card, or a land or other permanent entering the battlefield (playing a land included) needs no
 *  card of yours: opponents do those every turn. Such a row is `selfSupplied` (`available: null` in `deckAvailability`, never the
 *  unmet-demand finding). Two shapes are only another player's: a symmetric punisher's after the you-refusal above (Eidolon of
 *  the Great Revel, Phyrexian Tyranny, Nature's Wrath), and a trigger that watches only opponents, `control: "opp"` (Kaervek the
 *  Merciless, Underworld Dreams). An `any` trigger that is no punisher is unchanged: the deck can supply it. The supplier counts
 *  are untouched; a card that makes an opponent draw is still counted (Howling Mine beside Phyrexian Tyranny).
 *  What opponents do NOT do unaided keeps its demand and can be unmet: gaining life (False Cure), discarding, sacrificing, losing
 *  life, being dealt damage. `enters` is the battlefield only: a card entering an opponent's graveyard is not on the list.
 *  Measured on the 12 decks in packages/cli/decks (stored rows, DERIVE 495): Eidolon swapped in read `cast:type:spell (another
 *  player's)` 1/0 in all 12 and raised "a spell being cast (by another player) -- and nothing in the deck does it" in the 5 where
 *  the row is inside `DEMAND_ROWS`, now 0; unmodified, Mystic Remora's opponent-only row raised it in 2 (gogo, hidetsugu), now 0.
 *  `rollUp` keeps a row a demand unless EVERY shape on its key is self-supplied, so an opponent-only trigger sharing a key with
 *  a demand of your own stays priced. (Kaervek beside Sunbird's Invocation, "whenever you cast a spell from your hand", was the
 *  measured case; since #1602 that trigger is self-supplied too, see `castIsDeckLevel`.)
 *  CEILING: every subject on these verbs counts as routine, however narrow: "whenever an opponent casts a spell from
 *  anywhere other than their hand" (Ghostly Pilferer), "a player puts a Swamp onto the battlefield" (Thelon's Chant) or "lands enter under an opponent's
 *  control without being played" (Deep Gnome Terramancer) is read as something opponents do unaided, like "casts a spell". The
 *  ruling names the action, not how often a table meets it. */
const ROUTINE_FOR_ANOTHER_PLAYER: ReadonlySet<string> = new Set(["cast", "draw", "enters", "land-play"]);
function anotherPlayersRoutine(c: Shape): boolean {
  if (!c.punisher && c.event.subject.control !== "opp") return false;
  if (!ROUTINE_FOR_ANOTHER_PLAYER.has(c.event.verb)) return false;
  // `normalizeZoneEvent` has put the zone on every `enters`: "enters a graveyard" is `enters` too.
  return c.event.verb !== "enters" || c.event.subject.zone === "battlefield";
}

/** "WHENEVER YOU CAST A SPELL" IS A DECK-LEVEL CONDITION, NOT A DEMAND (#1602). The graph refuses every implied cast into a cast
 *  trigger that names no spell (`castSelfSupplied`): every nonland card answers it, so no card supplies it. The census priced
 *  the row all the same: Manaplasm beside Lightning Bolt and Llanowar Elves read `cast:type:spell` 1 want / 0 supply, available
 *  0, and raised the unmet-demand finding. Such a row is `selfSupplied`, as an unnarrowed combat row is. A trigger that names
 *  which spell keeps its demand and its suppliers (Monastery Mentor's noncreature spell, Beast Whisperer's creature spell).
 *  The supplier counts are untouched: an authored cast emit is still counted on a self-supplied row.
 *  STRICTER THAN THE GRAPH'S TEST, on purpose. `castConsumerNarrows` reads type, subtype, colour, stats and a few flags; it
 *  has no test for where the spell is cast from or what was paid, so "whenever you cast a spell from exile" (Quintorius Kand),
 *  "from your graveyard" (Burning Vengeance), "a kicked spell" (Vine Gecko) or "a multicolored spell" (General Ferrous Rokiric)
 *  are the bare umbrella to it. For the graph that only refuses the implied cast. Here it would declare the demand met by any
 *  deck, which those are not. So a row is deck-level only when its subject carries nothing but the fields below: casting from
 *  your hand (Sunbird's Invocation) and "other than your first spell each turn" / "during your turn" (Arcbound Tracker, Chakram
 *  Retriever) are what a deck does anyway. Any field not listed keeps the demand, so a new subject field starts as a demand.
 */
const DECK_LEVEL_CAST_FIELDS: ReadonlySet<string> = new Set(["control", "token", "type", "self", "fromZone", "history"]);
const DECK_LEVEL_CAST_HISTORY: ReadonlySet<string> = new Set(["not-first-spell-this-turn", "cast-during-your-turn"]);
function castIsDeckLevel(e: GameEvent): boolean {
  if (!castSelfSupplied(impliedProducer(e.verb), e)) return false;
  const s = e.subject;
  if (Object.entries(s).some(([k, v]) => v !== undefined && !DECK_LEVEL_CAST_FIELDS.has(k))) return false;
  if (s.fromZone !== undefined && s.fromZone !== "hand") return false;
  return (s.history ?? []).every((x) => DECK_LEVEL_CAST_HISTORY.has(x));
}

export function buildCensus(
  cards: Iterable<CardTags>,
  h: Hierarchy,
  opts: { members?: boolean; oracleTexts?: readonly (string | undefined)[] } = {},
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
      for (const v of a.trigger.verbs) {
        const punisher = opts.oracleTexts !== undefined && punishesItsActor(a, v, opts.oracleTexts[i]);
        collect(consShapes, normalizeZoneEvent({ verb: v, subject: a.trigger.subject }), i, false, punisher);
      }
    }
  }

  const prodByVerb = byVerb(prodShapes);
  const consByVerb = byVerb(consShapes);

  const consumerRows = [...consShapes.values()].map((c) => {
    const counterpart = new Set<number>();
    // THE CROSS-VERB BRIDGES TOO (issue #562): `eventMatches` accepts a damage emit for "a creature is
    // dealt damage" and for life loss, and a death for a leave, but only if it is ever asked. Same-verb
    // lookup alone read Brash Taunter's fight as "0 cause it" beside the edge the engine drew from it.
    for (const p of [c.event.verb, ...(ALSO_SUPPLIED_BY[c.event.verb] ?? [])].flatMap((v) => prodByVerb.get(v) ?? [])) {
      // The matcher's own gate (`eventEdges`): a punisher hears an opponent's or any player's action, never one that is only yours.
      if (c.punisher && p.event.subject.control === "you") continue;
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
    // A CONSUMER-ONLY ENGINE VERB has no producer by owner ruling (`becomes-blocked`, CR 509.1h, #1375): the game or an opponent's blockers supply it, so a payoff is never an unmet demand.
    const selfSupplied = c.event.subject.self === true
      || CONSUMER_ONLY.includes(c.event.verb)
      || combatSelfSupplied(impliedProducer(c.event.verb), c.event)
      || castIsDeckLevel(c.event)
      || anotherPlayersRoutine(c);
    return { key: consumerKey(c.event, selfSupplied, c.punisher), cards: c.cards, counterpart, selfSupplied, authored: true };
  });

  const producerRows = [...prodShapes.values()].map((p) => {
    const counterpart = new Set<number>();
    for (const c of [p.event.verb, ...(SUPPLIES[p.event.verb] ?? [])].flatMap((v) => consByVerb.get(v) ?? [])) {
      if (c.punisher && p.event.subject.control === "you") continue;
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
