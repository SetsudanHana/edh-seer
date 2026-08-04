import type { Reason } from "@mtg/engine";
import type { CardTags, GameEvent, SubjectFilter } from "@mtg/tagger";
import type { DeckCard, Hierarchy } from "./types.js";
import { subjectMatches, graveyardFillMatches, counterAddMatches } from "./subject.js";
import { impliedEvents, impliedGraveyardEvents, impliedCounterEvents } from "./implied.js";
import { normalizeZoneEvent, zoneEventKey } from "./zones.js";
import { parseStat } from "./stats.js";

const list = (v: string | string[] | undefined): string[] =>
  v === undefined ? [] : Array.isArray(v) ? v : [v];

/** A short human/grouping key for a subject: its subtype, else its type, else "any". */
export function themeSubjectKey(s: SubjectFilter): string {
  return list(s.subtype)[0] ?? list(s.type)[0] ?? "any";
}

/** A card's set of theme tags (for deck-frequency ranking): one per trigger verb, emit, and
 *  static effect. Mirrors the flat engine's produces∪cares membership. */
export function cardThemeTags(tags: CardTags): Set<string> {
  const out = new Set<string>();
  for (const a of tags.abilities) {
    if (a.trigger) for (const v of a.trigger.verbs) out.add(`${v}:${themeSubjectKey(a.trigger.subject)}`);
    for (const e of a.emits ?? []) out.add(`${e.verb}:${themeSubjectKey(e.subject)}`);
    if (a.kind === "static" && a.effect.subject) out.add(`static:${a.effect.kind}`);
  }
  return out;
}

/** The card's characteristics expressed as a concrete subject, for static-edge matching. */
function characteristicsSubject(tags: CardTags): SubjectFilter {
  const c = tags.characteristics;
  return {
    type: c.types.length ? c.types.map((t) => t.toLowerCase()) : undefined,
    subtype: c.subtypes.length ? c.subtypes.map((t) => t.toLowerCase()) : undefined,
    colors: c.colors.length ? c.colors : undefined,
    control: "you",
    token: c.token,
    power: parseStat(c.power),
    toughness: parseStat(c.toughness),
    manaValue: c.cmc,
  };
}

/** A producer card's canonical events: authored emits + self-implied cast/enters, all zone-
 *  normalized and deduped, then unioned with the graveyard-fill events those emits imply. */
export function producerEvents(tags: CardTags): GameEvent[] {
  const base = [
    ...tags.abilities.flatMap((a) => a.emits ?? []),
    ...impliedEvents(tags.characteristics),
  ].map(normalizeZoneEvent);
  const derived = [...impliedGraveyardEvents(base), ...impliedCounterEvents(base)];
  const withDerived = [...base, ...derived];
  const seen = new Set<string>();
  const out: GameEvent[] = [];
  for (const e of withDerived) {
    const k = JSON.stringify(e);
    if (!seen.has(k)) { seen.add(k); out.push(e); }
  }
  return out;
}

/** Does a combat consumer subject filter on anything beyond "is a creature" -- i.e. does it
 *  narrow which creature satisfies it, rather than accepting any of them? A bare subject, or one
 *  whose only type is `creature` (every attacker is one, so that narrows nothing), does not
 *  narrow. Anything else -- a subtype, a stats predicate ("power 4 or greater"), a counter, a
 *  chosenType, or a colors filter, or a token filter that isn't wildcarded -- is a real typal or
 *  statistical condition and narrows. */
function combatConsumerNarrows(subject: SubjectFilter): boolean {
  return combatNarrowsByType(subject) || combatNarrowsOffType(subject);
}

/** Does this combat consumer narrow via its type line -- a non-creature type, or any subtype?
 *  Exported because the census keys rows on type and subtype, so a shape narrowing THIS way already
 *  lands in its own row and needs no further marking. */
export function combatNarrowsByType(subject: SubjectFilter): boolean {
  const types = list(subject.type);
  if (types.length > 0 && !types.every((t) => t === "creature")) return true;
  return list(subject.subtype).length > 0;
}

/** Does it narrow via a dimension OUTSIDE the type line -- a stats predicate ("power 4 or greater"),
 *  a counter, a chosenType, a colors filter, or a token filter? These are invisible to a
 *  type/subtype key, so two shapes can share a key and disagree about being self-supplied.
 *
 *  `token` narrows only when it demands a TOKEN. `token: false` means "nontoken", which nearly every
 *  creature already is -- treating it as a real condition let 14 triggers draw implied edges from the
 *  whole creature pool, a small copy of the mesh this gate exists to prevent. `token: true` is a
 *  genuine condition (Neyali, Temmet): a deck with no token makers never triggers it, and since
 *  `selfSubject` stamps `token: false` on every implied event, such a consumer correctly ends up with
 *  zero implied supply and surfaces in the census as a real hole -- we do not model a token attacking. */
function combatNarrowsOffType(subject: SubjectFilter): boolean {
  if ((subject.stats?.length ?? 0) > 0) return true;
  if (subject.counter) return true;
  if (subject.chosenType) return true;
  if ((subject.colors?.length ?? 0) > 0) return true;
  return subject.token === true;
}

/** Is this combat producer/consumer pair satisfied by the game itself rather than by any card?
 *
 *  Attacking and dealing combat damage are normal game actions -- every creature does them, for
 *  free, in any deck that runs creatures. "Whenever a creature you control attacks" therefore
 *  needs no supplier: it is a deck-level state condition, not an event some other card provides.
 *  Supplying those consumers from every creature in the corpus would be a multi-million-edge mesh
 *  carrying no information -- the same failure `bea8dcd` removed for `cast:any`.
 *
 *  That only holds for the IMPLIED combat events `impliedEvents` synthesizes ("any creature can
 *  attack"), never for an AUTHORED attacks/combat-damage emit -- goad, Mage Slayer, Saskia and
 *  similar cards genuinely force or supply combat, and that is real information a generic combat
 *  consumer should receive. So the gate is keyed on the PRODUCER's `implied` flag, not just the
 *  consumer's shape.
 *
 *  A consumer that filters on WHICH creature attacks is a different thing: "whenever a Samurai or
 *  Warrior you control attacks" is a real typal payoff, and the creatures satisfying it are a real
 *  edge -- so is "whenever a creature with power 4 or greater attacks" (Garruk's Uprising). Note
 *  `type: creature` does NOT count as a filter here -- only creatures attack, so on a combat
 *  trigger it narrows nothing. */
export function combatSelfSupplied(producer: GameEvent, consumer: GameEvent): boolean {
  if (!COMBAT_VERBS.has(consumer.verb)) return false;
  if (!producer.implied) return false;
  return !combatConsumerNarrows(consumer.subject);
}

/** The verbs `combatSelfSupplied` governs -- the ones a creature performs for free. Exported so the
 *  census can ask "is this row one of the ones that gate applies to" without restating the list. */
export const COMBAT_VERBS: ReadonlySet<string> = new Set(["attacks", "combat-damage"]);

/** Does a normalized producer event satisfy a normalized consumer trigger event? Verb equality
 *  plus the subject test the verb calls for -- graveyard fills and counter adds have their own
 *  matchers, everything else is plain subsumption. Shared by `directedReasons` and the event
 *  census so the two cannot drift: a census that counted supply differently from the matcher
 *  would report holes the engine does not actually have. */
export function eventMatches(producer: GameEvent, consumer: GameEvent, h: Hierarchy): boolean {
  if (producer.verb !== consumer.verb) return false;
  if (combatSelfSupplied(producer, consumer)) return false;
  if (producer.verb === "enters" && producer.subject.zone === "graveyard") {
    return graveyardFillMatches(producer.subject, consumer.subject, h);
  }
  if (producer.verb === "counter-added") return counterAddMatches(producer.subject, consumer.subject, h);
  return subjectMatches(producer.subject, consumer.subject, h);
}

/** Repeatability of a triggered CONSUMER: a bare self-ETB (trigger names neither a type nor a
 *  subtype — "when this enters") is only satisfied by its own single entry, so it is one-time; any
 *  typed/subtyped trigger fires each time such a permanent recurs, so it is a repeatable engine. */
function triggerRepeatability(subject: SubjectFilter): "triggered" | "oneshot" {
  const bare = list(subject.type).length === 0 && list(subject.subtype).length === 0;
  return bare ? "oneshot" : "triggered";
}

/** Turn an internal zone-event key ("enters:creature", "cast:instant") into a reader-facing
 *  noun phrase. Fallback de-slugifies anything unmapped so no ":"/"-" token ever reaches the UI. */
function humanizeEvent(key: string): string {
  const [verb, subjRaw = ""] = key.split(":");
  const subj = subjRaw.replace(/-/g, " ");
  const art = (w: string) => (/^[aeiou]/i.test(w) ? "an" : "a");
  switch (verb) {
    case "enters":
      return subj === "any" ? "a permanent entering" : `${art(subj)} ${subj} entering`;
    case "enters-graveyard":
      return subj === "any" ? "a card hitting the graveyard" : `${art(subj)} ${subj} hitting the graveyard`;
    case "cast":
      return `${art(subj)} ${subj} being cast`;
    case "attacks":
      return "an attack";
    case "dies":
      return "a creature dying";
    case "counter-added":
      return "a counter being added";
    case "proliferate":
      return "proliferate";
    default:
      return key.replace(/[:-]/g, " ");
  }
}

/** Directional reasons from producer P to consumer C: event edges (P.emits ↔ C.triggers) and
 *  static edges (P.static effect ↔ C.characteristics). */
export function directedReasons(p: DeckCard, c: DeckCard, h: Hierarchy): Reason[] {
  if (!p.tags || !c.tags) return [];
  const reasons: Reason[] = [];
  const pEvents = producerEvents(p.tags);

  // Event edges: normalized producer event ↔ normalized consumer trigger.
  for (const e of pEvents) {
    for (const a of c.tags.abilities) {
      if (!a.trigger) continue;
      for (const rawVerb of a.trigger.verbs) {
        const t = normalizeZoneEvent({ verb: rawVerb, subject: a.trigger.subject });
        if (!eventMatches(e, t, h)) continue;
        const key = zoneEventKey(t.verb, t.subject.zone, themeSubjectKey(t.subject));
        reasons.push({
          tag: key,
          text: `${c.card.name} triggers on ${humanizeEvent(key)}; ${p.card.name} supplies it`,
          effectKind: a.effect.kind,
          repeatability: triggerRepeatability(t.subject),
          scaling: a.effect.scaling,
          hasStatPredicate: (t.subject.stats?.length ?? 0) > 0 || undefined,
          consumer: c.card.name,
          producer: p.card.name,
        });
      }
    }
  }

  // Reanimator-consumer edge: a producer graveyard fill enables C's graveyard-recursion effect.
  for (const e of pEvents) {
    if (!(e.verb === "enters" && e.subject.zone === "graveyard")) continue;
    for (const a of c.tags.abilities) {
      if (a.effect.kind !== "graveyard-recursion" || a.effect.subject?.zone !== "graveyard") continue;
      // Skip if the event-edge loop already credited this fill via a graveyard-entry trigger on the same ability.
      if (a.trigger && a.trigger.verbs.some((v) => {
        const t = normalizeZoneEvent({ verb: v, subject: a.trigger!.subject });
        return t.verb === "enters" && t.subject.zone === "graveyard" && graveyardFillMatches(e.subject, t.subject, h);
      })) continue;
      if (!graveyardFillMatches(e.subject, a.effect.subject, h)) continue;
      const repeatability =
        a.kind === "static" ? "static" : a.kind === "activated" ? "activated" : a.kind === "on-cast" ? "oneshot" : "triggered";
      reasons.push({
        tag: `graveyard-recursion:${themeSubjectKey(a.effect.subject)}`,
        text: `${p.card.name} fills the graveyard, enabling ${c.card.name}'s recursion`,
        effectKind: a.effect.kind,
        repeatability,
        scaling: a.effect.scaling,
        consumer: c.card.name,
        producer: p.card.name,
      });
    }
  }

  // Static edges: P is a lord whose effect subject C's characteristics satisfy. (UNCHANGED)
  for (const a of p.tags.abilities) {
    if (a.kind !== "static" || !a.effect.subject) continue;
    if (!subjectMatches(characteristicsSubject(c.tags), a.effect.subject, h)) continue;
    reasons.push({
      tag: `static:${a.effect.kind}`,
      text: `${p.card.name}'s ${a.effect.kind.replace(/-/g, " ")} applies to ${c.card.name}`,
      effectKind: a.effect.kind,
      repeatability: "static",
      scaling: a.effect.scaling,
      hasStatPredicate: (a.effect.subject?.stats?.length ?? 0) > 0 || undefined,
      consumer: c.card.name,
      producer: p.card.name,
    });
  }
  // Counter-presence edges: C has an ability whose effect subject is filtered on a counter kind
  // ("creatures you control WITH a +1/+1 counter"), which is a cares-signal with no emit behind
  // it — the card benefits from a board state rather than reacting to an event. P supplies that
  // state. Tagged into the existing counter-added family on purpose, so these cards join the
  // counters theme instead of forming a parallel one.
  for (const pa of p.tags.abilities) {
    for (const emit of pa.emits ?? []) {
      if (emit.verb !== "counter-added" || !emit.subject.counter) continue;
      for (const ca of c.tags.abilities) {
        const want = ca.effect.subject;
        if (!want?.counter || want.counter !== emit.subject.counter) continue;
        // an ability that emits the same event is already covered by the event-edge pass above
        if ((ca.emits ?? []).some((e) => e.verb === "counter-added")) continue;
        if (ca.trigger?.verbs.includes("counter-added")) continue;
        if (!subjectMatches(emit.subject, want, h)) continue;
        reasons.push({
          tag: `counter-added:${themeSubjectKey(want)}`,
          text: `${c.card.name} benefits from ${want.counter} counters being on the board; ${p.card.name} puts them there`,
          effectKind: ca.effect.kind,
          repeatability: ca.kind === "static" ? "static" : ca.kind === "activated" ? "activated" : ca.kind === "on-cast" ? "oneshot" : "triggered",
          scaling: ca.effect.scaling,
          consumer: c.card.name,
          producer: p.card.name,
        });
      }
    }
  }

  return reasons;
}

/** All reasons for the unordered pair {a,b}: union of a→b and b→a directional reasons, deduped
 *  by byte-identical shape (e.g. an authored counter-added emit and a proliferate-derived
 *  counter-added emit can independently satisfy the same consumer trigger, producing two
 *  Reason objects with identical fields — collapse those since they carry no extra information). */
export function pairReasons(a: DeckCard, b: DeckCard, h: Hierarchy): Reason[] {
  const all = [...directedReasons(a, b, h), ...directedReasons(b, a, h)];
  const seen = new Set<string>();
  const out: Reason[] = [];
  for (const r of all) {
    const k = JSON.stringify(r);
    if (!seen.has(k)) { seen.add(k); out.push(r); }
  }
  return out;
}
