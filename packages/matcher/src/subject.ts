import type { SubjectFilter } from "@mtg/tagger";
import type { Hierarchy } from "./types.js";
import { expandTypes } from "./hierarchy.js";
import { evalStatPredicate } from "./stats.js";

const arr = (v: string | string[] | undefined): string[] =>
  v === undefined ? [] : Array.isArray(v) ? v : [v];

/** Does the concrete producer subject satisfy the consumer filter? Every field the consumer
 *  leaves unset is a wildcard; a field it sets must be satisfied by the producer. */
export function subjectMatches(producer: SubjectFilter, consumer: SubjectFilter, h: Hierarchy): boolean {
  // "Historic" is artifact, legendary or Saga -- a printed fact the matcher stamps on the producer
  // from its type line. Opt-in like every other field: a consumer that does not ask is unaffected,
  // and a consumer that DOES ask is satisfied only by a card that is one.
  if (consumer.historic === true && producer.historic !== true) return false;
  // control: equal, or `any` on either side.
  if (consumer.control !== "any" && producer.control !== "any" && consumer.control !== producer.control) {
    return false;
  }
  // token tri-state, ASYMMETRIC on purpose.
  //
  // A consumer demanding token:true is a token-matters payoff, and `null` on the producer means
  // UNSPECIFIED, not "yes". Imskir Iron-Eater's "Sacrifice an artifact" emits token:null, and
  // reading that as a wildcard made sacrificing a Sol Ring satisfy Nadier's Nightblade's "whenever
  // a TOKEN you control leaves the battlefield". Demand a real token.
  //
  // The other direction stays a wildcard: token:false means "nontoken", which nearly every
  // permanent already is, and treating it as a condition once let 14 triggers draw edges from the
  // whole creature pool.
  if (consumer.token === true && producer.token !== true) return false;
  if (consumer.token !== null && producer.token !== null && consumer.token !== producer.token) {
    return false;
  }
  // counter / zone: if the consumer names one, the producer must equal it.
  if (consumer.counter !== undefined && consumer.counter !== producer.counter) return false;
  if (consumer.zone !== undefined && consumer.zone !== producer.zone) return false;
  // colours: an INTERSECTION, not an equality, because both sides are OR-lists — a Dimir card
  // satisfies "blue spells", and a filter naming two colours accepts a card in either. Unset on
  // the consumer means the filter says nothing about colour and every card passes; a producer with
  // no colours at all (a land, a colourless artifact) satisfies no coloured filter, which is the
  // correct reading of "blue permanent spells".
  const wanted = consumer.colors ?? [];
  if (wanted.length > 0) {
    const has = new Set(producer.colors ?? []);
    if (!wanted.some((c) => has.has(c))) return false;
  }
  // type: expand both sides' type tokens (concrete, pseudo, or subtype-implied) to concrete
  // card-type sets and require they intersect. Reduces to exact/subtype-implied matching for
  // concrete types; lets pseudo-types (permanent/spell/noncreature/nonland) match their members.
  const consumerTypes = arr(consumer.type);
  if (consumerTypes.length > 0) {
    const consumerSet = expandTypes(consumerTypes, [], h);
    const producerSet = expandTypes(arr(producer.type), arr(producer.subtype), h);
    let ok = false;
    for (const t of consumerSet) {
      if (producerSet.has(t)) { ok = true; break; }
    }
    if (!ok) return false;
  }
  // subtype: an array on the consumer means OR — at least one named subtype must be a
  // producer subtype (exact, case-insensitive).
  const consumerSubtypes = arr(consumer.subtype);
  if (consumerSubtypes.length > 0) {
    const ok = consumerSubtypes.some((cs) =>
      arr(producer.subtype).some((ps) => ps.toLowerCase() === cs.toLowerCase()),
    );
    if (!ok) return false;
  }
  // stats: every predicate the consumer sets must hold against the producer's concrete stats
  // (missing producer stat → 0, per the non-numeric rule).
  if (consumer.stats && consumer.stats.length > 0) {
    const s = { power: producer.power ?? 0, toughness: producer.toughness ?? 0, manaValue: producer.manaValue ?? 0 };
    if (!consumer.stats.every((p) => evalStatPredicate(p, s))) return false;
  }
  return true;
}

/** Match a graveyard-fill producer event against a graveyard consumer (an enters@graveyard
 *  trigger, or a graveyard-recursion effect subject). Like subjectMatches, but an UNTYPED fill
 *  (a generic mill/discard with no type and no subtype) is a wildcard on type/subtype because the
 *  filled cards' types are unknown; control/token/zone stay strict. */
export function graveyardFillMatches(producer: SubjectFilter, consumer: SubjectFilter, h: Hierarchy): boolean {
  const untyped = arr(producer.type).length === 0 && arr(producer.subtype).length === 0;
  if (!untyped) return subjectMatches(producer, consumer, h);
  if (consumer.control !== "any" && producer.control !== "any" && consumer.control !== producer.control) return false;
  if (consumer.token !== null && producer.token !== null && consumer.token !== producer.token) return false;
  if (consumer.zone !== undefined && consumer.zone !== producer.zone) return false;
  return true;
}

/** Match a counter-added producer event against a counter-matters consumer trigger. An UNTYPED
 *  counter-added (no type, no subtype, no counter kind — the board-state-dependent counter a
 *  proliferate adds) wildcards type/subtype/counter because the kind is unknown; control/token
 *  stay strict. A counter-TYPED producer (a normal counter placer) delegates to subjectMatches so
 *  its kind must match. */
export function counterAddMatches(producer: SubjectFilter, consumer: SubjectFilter, h: Hierarchy): boolean {
  const untyped =
    arr(producer.type).length === 0 && arr(producer.subtype).length === 0 && producer.counter === undefined;
  if (!untyped) return subjectMatches(producer, consumer, h);
  if (consumer.control !== "any" && producer.control !== "any" && consumer.control !== producer.control) return false;
  if (consumer.token !== null && producer.token !== null && consumer.token !== producer.token) return false;
  return true;
}
