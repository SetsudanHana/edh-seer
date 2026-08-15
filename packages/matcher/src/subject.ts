import type { SubjectFilter } from "@mtg/tagger";
import type { Hierarchy } from "./types.js";
import { expandTypes, PSEUDO_TYPE_SETS } from "./hierarchy.js";
import { evalStatPredicate } from "./stats.js";

const arr = (v: string | string[] | undefined): string[] =>
  v === undefined ? [] : Array.isArray(v) ? v : [v];

/** Does the concrete producer subject satisfy the consumer filter? Every field the consumer
 *  leaves unset is a wildcard; a field it sets must be satisfied by the producer. */
export function subjectMatches(producer: SubjectFilter, consumer: SubjectFilter, h: Hierarchy): boolean {
  // A DISJUNCTION: satisfied by any branch, with the shared fields outside still binding. Checked
  // first so the outer subject is tested without its branches, then each branch on its own.
  if (consumer.anyOf !== undefined && consumer.anyOf.length > 0) {
    const { anyOf, ...shared } = consumer;
    // Shared fields are merged INTO each branch rather than checked separately: a branch carries
    // only its type/subtype, and an absent `control` is not a wildcard here — it would fail the
    // equality check below against a producer that states one.
    return anyOf.some((b) => subjectMatches(producer, { ...shared, ...b }, h));
  }
  // "Historic" is artifact, legendary or Saga -- a printed fact the matcher stamps on the producer
  // from its type line. Opt-in like every other field: a consumer that does not ask is unaffected,
  // and a consumer that DOES ask is satisfied only by a card that is one.
  if (consumer.historic === true && producer.historic !== true) return false;
  // Same shape as historic: a legendary-matters anthem reaches only legendary permanents.
  if (consumer.legendary === true && producer.legendary !== true) return false;
  // A DECK fact, not a printed one — see commander.ts. Same asymmetry as the two supertypes above:
  // a consumer that does not ask is unaffected, one that does is satisfied only by a designated
  // commander. Kediss, Emberclaw Familiar is why: its "a commander you control" derived untyped and
  // matched anything its controller had.
  if (consumer.commander === true && producer.commander !== true) return false;
  // And the second supertype. This one matters most where the emit is the FILTER (the authored-emit
  // identity check in edges.ts): "search for a basic land card" was satisfied by every nonbasic land.
  if (consumer.basic === true && producer.basic !== true) return false;
  // A CARD NAME. Same asymmetry as every qualifier above: a consumer that does not ask is unaffected,
  // one that DOES ask is satisfied only by the card bearing that name. Compared lowercased, because
  // the demand is parsed from lowercased clause text while the supply is the printed name.
  if (consumer.named !== undefined
    && consumer.named.toLowerCase() !== (producer.named ?? "").toLowerCase()) return false;
  // Printed keyword abilities, ALL of them — "creatures you control with flying". Not a type, so no
  // other field could hold it and the narrowing used to vanish: Favorable Winds anthemed every
  // creature. The producer side is its printed `keywords` array, stamped by `characteristicsSubject`
  // and `selfSubject`, so a Bird token with flying satisfies it and a Llanowar Elf does not.
  if (consumer.keyword !== undefined && consumer.keyword.length > 0) {
    const has = new Set(arr(producer.keyword).map((k) => k.toLowerCase()));
    if (!consumer.keyword.every((k) => has.has(k.toLowerCase()))) return false;
  }
  // And the negation — "a creature you control WITHOUT flying". An absent producer keyword list
  // satisfies it: printed keywords arrive free on every card, so "none recorded" really is "has
  // none". Luminous Broodmoth returns what dies, and a flying creature is not what it returns.
  if (consumer.notKeyword !== undefined && consumer.notKeyword.length > 0) {
    const has = new Set(arr(producer.keyword).map((k) => k.toLowerCase()));
    if (consumer.notKeyword.some((k) => has.has(k.toLowerCase()))) return false;
  }
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
    // COLORLESS is spelled differently on the two sides: a colourless card carries `colors: []`
    // (Scryfall gives it none), while a filter saying "colorless spell" parses to ["C"]. An
    // intersection of those is empty, so Echoes of Eternity's "whenever you cast a colorless spell"
    // matched nothing at all. C is satisfied by having NO colour, and by nothing else. 83 corpus
    // subjects demand it.
    const satisfied = (wanted.includes("C") && has.size === 0)
      || wanted.some((c) => c !== "C" && has.has(c));
    if (!satisfied) return false;
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
  // ...and then the EXCLUSION, which the positive list cannot express. "Noncreature spell" resolves
  // to six types INCLUDING artifact, and an artifact creature spell carries both, so intersection
  // alone matched a card the text plainly excludes -- Valley Floodcaller does not trigger on casting
  // Solemn Simulacrum. The positive list says what MAY satisfy the subject; `notType` says what may
  // not, and both have to be tested.
  //
  // Abstains when the producer's own type is an UMBRELLA ("a spell", "a permanent"): we genuinely do
  // not know whether the thing cast was a creature, and rejecting on a guess would delete real edges
  // (Bolas's Citadel casts "a spell"). Supertypes in a type line are not umbrellas -- "Legendary
  // Artifact Creature" is fully known -- so they must not trigger the abstention.
  // A CONJUNCTION the type array cannot express: "artifact creature" demands both, while
  // `type: ["creature","artifact"]` means either. Strict rather than abstaining, unlike `notType`
  // below: the producer side of a static edge is `characteristicsSubject`, built from a printed type
  // line and therefore always concrete, so there is no unknowable case to protect.
  const all = consumer.allTypes ?? [];
  if (all.length > 0) {
    const has = expandTypes(arr(producer.type), arr(producer.subtype), h);
    if (!all.every((t) => has.has(t.toLowerCase()))) return false;
  }
  const negated = consumer.notType ?? [];
  if (negated.length > 0) {
    const producerTokens = arr(producer.type);
    const unknowable = producerTokens.some((t) => PSEUDO_TYPE_SETS[t.toLowerCase()] !== undefined);
    if (!unknowable) {
      const has = expandTypes(producerTokens, arr(producer.subtype), h);
      if (negated.some((t) => has.has(t.toLowerCase()))) return false;
    }
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
  // A kind MISMATCH is real information on either path: a +1/+1 placer is not a poison enabler.
  if (consumer.counter !== undefined && producer.counter !== undefined
    && consumer.counter !== producer.counter) return false;
  // `counter` is deliberately NOT part of this test. An add-counter's subject is parsed from its
  // object -- "+1/+1" -- which describes the COUNTER, never the permanent receiving it, so knowing
  // the kind tells us nothing about the recipient's type. Including it flipped every counter placer
  // into the strict path it cannot satisfy, and The Great Henge stopped feeding its own +1/+1
  // payoffs the moment the kind was recorded.
  const untyped = arr(producer.type).length === 0 && arr(producer.subtype).length === 0;
  if (!untyped) return subjectMatches(producer, consumer, h);
  if (consumer.control !== "any" && producer.control !== "any" && consumer.control !== producer.control) return false;
  if (consumer.token !== null && producer.token !== null && consumer.token !== producer.token) return false;
  return true;
}
