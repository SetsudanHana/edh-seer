import type { Reason } from "@mtg/engine";
import type { CardTags, GameEvent, SubjectFilter } from "@mtg/tagger";
import type { DeckCard, Hierarchy } from "./types.js";
import { subjectMatches, graveyardFillMatches, counterAddMatches } from "./subject.js";
import { impliedEvents, impliedGraveyardEvents, impliedCounterEvents, isHistoric } from "./implied.js";
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
    // No subject requirement here, unlike the static EDGE below. Membership asks "is this card a
    // <kind> card?", which does not depend on knowing WHICH permanents it applies to. Requiring a
    // subject silenced every static whose recipient is unrecoverable -- Rage Reflection's
    // grant-ability records "double strike", the thing granted, not who receives it -- and across
    // the 71 calibration decks that stripped derived decks of their static themes, letting whatever
    // tag had the most raw volume win the axis instead.
    if (a.kind === "static" && a.effect.kind) out.add(`static:${a.effect.kind}`);
  }
  return out;
}

/** The card's characteristics expressed as a concrete subject, for static-edge matching. */
function characteristicsSubject(tags: CardTags): SubjectFilter {
  const c = tags.characteristics;
  const types = c.types.map((t) => t.toLowerCase());
  const subtypes = c.subtypes.map((t) => t.toLowerCase());
  return {
    ...(isHistoric(types, subtypes) ? { historic: true as const } : {}),
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

/** A consumer trigger that watches the card ITSELF, against a producer event that is only the
 *  producer existing. Sol Ring entering does not trigger "when Urza enters"; Lightning Bolt being
 *  cast does not trigger Nulldrifter's "when you cast THIS spell". Before this gate every permanent
 *  in the deck supplied every self-ETB and every spell supplied every self-cast -- 74% of all false
 *  edges in the 2026-08-05 precision measurement, in both tag populations.
 *
 *  Two producer events can never be the consumer entering:
 *    - an IMPLIED one — the producer merely being a permanent that entered. Same scoping as
 *      `combatSelfSupplied`, and for the same reason: an AUTHORED emit is a card that actually puts
 *      something onto the battlefield, and a blink or a reanimation genuinely does make the consumer
 *      re-enter and fire its own ETB, so dropping self-triggers outright would delete real edges.
 *    - a TOKEN one — `create` emits `enters`, but the thing that entered is a new object. However
 *      many tokens are made, none of them is the card watching its own entry. Authored, so the
 *      implied rule alone left 25 of these standing in the measured sample.
 *  Tokens remain real supply for every OTHER consumer: go-wide is the point of them. */
export function selfEtbSelfSupplied(producer: GameEvent, consumer: GameEvent): boolean {
  if (consumer.verb !== "enters" && consumer.verb !== "cast") return false;
  // Only the GRAVEYARD variant is excluded (it has its own matcher). `normalizeZoneEvent` stamps
  // zone "battlefield" on every enters event, so testing for an unset zone here would exclude
  // everything and make the gate dead code.
  if (consumer.subject.zone === "graveyard") return false;
  if (consumer.subject.self !== true) return false;
  return producer.implied === true || producer.subject.token === true;
}

/** Does a cast consumer filter on WHICH spell, or does every card in the deck satisfy it?
 *
 *  Only the bare umbrella counts as unconstrained. `spell` expands (PSEUDO_TYPE_SETS) to every
 *  nonland type, so it narrows nothing — but `permanent` excludes instants and sorceries, a named
 *  type excludes the rest, and a subtype/colour/stat/counter/token filter all narrow for real. */
function castConsumerNarrows(subject: SubjectFilter): boolean {
  if (subject.subtype !== undefined || subject.colors !== undefined) return true;
  if (subject.stats !== undefined || subject.chosenType === true) return true;
  if (subject.historic === true) return true;
  if (subject.token !== null && subject.token !== undefined) return true;
  const types = Array.isArray(subject.type) ? subject.type : subject.type ? [subject.type] : [];
  return types.length > 0 && !(types.length === 1 && types[0] === "spell");
}

/** Is this cast pair satisfied by playing Magic rather than by any card?
 *
 *  Casting spells is what a deck does. "Whenever you cast a spell" (Aetherflux Reservoir, Birgi,
 *  Arjun, Managorger Hydra, Liberator) and "whenever you cast your SECOND spell each turn" (Ledger
 *  Shredder, Taigam, Tomb of Horrors Adventurer, Dreamtide Whale, Rammas Echor) are deck-level state
 *  conditions, not events another card supplies — every nonland card in the deck answers them, so
 *  the claim excludes nothing and carries no information. It is the registered rubric rule ("a claim
 *  that applies to a card merely for being an ordinary card is false") and 27 of the frozen panel's
 *  33 `generic` false claims are this one shape.
 *
 *  The same rule `combatSelfSupplied` applies to attacking, and keyed the same way: on the PRODUCER's
 *  `implied` flag. An AUTHORED cast emit is a card genuinely putting spells on the stack — Bolas's
 *  Citadel, Abstract Performance, Impulsivity — and that is real supply a spell-count payoff should
 *  receive.
 *
 *  A consumer that names WHICH spell keeps every supplier it has: magecraft, storm, a creature-spell
 *  or artifact-spell watcher. Note this also gates Glóin's "historic spell" — the engine cannot
 *  express historic, so its subject really is unconstrained today, and forming an edge with every
 *  spell in the deck was a wrong answer rather than a partial one. */
export function castSelfSupplied(producer: GameEvent, consumer: GameEvent): boolean {
  if (consumer.verb !== "cast") return false;
  if (!producer.implied) return false;
  return !castConsumerNarrows(consumer.subject);
}

/** The verbs `combatSelfSupplied` governs -- the ones a creature performs for free. Exported so the
 *  census can ask "is this row one of the ones that gate applies to" without restating the list. */
export const COMBAT_VERBS: ReadonlySet<string> = new Set(["attacks", "combat-damage"]);

/** Does the producer's event come from where the consumer's trigger demands?
 *
 *  ONE-DIRECTIONAL on purpose. A trigger that names no origin means "however it got there" and must
 *  keep matching everything it matches today — that is most triggers, so stamping origins onto
 *  producer emits costs nothing. A trigger that DOES name one ("enters from a graveyard",
 *  "casts a spell from your hand") is only satisfied by a producer that states the same origin: a
 *  producer that states none is not proof of anything, and admitting it is how River Kelpie ended up
 *  claiming Phantasmal Image and Omni-Changeling, which enter from hand, plus Trade Routes, which
 *  puts nothing onto the battlefield at all. Three of the frozen panel's false claims, one card.
 *
 *  The cost of the strictness is real and accepted: a genuine reanimation whose clause never recorded
 *  a `fromZone` loses its edge to these consumers. A missing answer beats a wrong one. */
function originMatches(producer: SubjectFilter, consumer: SubjectFilter): boolean {
  if (consumer.fromZone === undefined) return true;
  return producer.fromZone === consumer.fromZone;
}

/** Does a normalized producer event satisfy a normalized consumer trigger event? Verb equality
 *  plus the subject test the verb calls for -- graveyard fills and counter adds have their own
 *  matchers, everything else is plain subsumption. Shared by `directedReasons` and the event
 *  census so the two cannot drift: a census that counted supply differently from the matcher
 *  would report holes the engine does not actually have. */
export function eventMatches(producer: GameEvent, consumer: GameEvent, h: Hierarchy): boolean {
  if (producer.verb !== consumer.verb) return false;
  if (!originMatches(producer.subject, consumer.subject)) return false;
  if (combatSelfSupplied(producer, consumer)) return false;
  if (castSelfSupplied(producer, consumer)) return false;
  if (selfEtbSelfSupplied(producer, consumer)) return false;
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
      return subj === "any" ? "an attack" : `${art(subj)} ${subj} attacking`;
    // Subject-aware for the same reason `enters` is. A `dies` event is any permanent LEAVING THE
    // BATTLEFIELD (see zoneEventKey), not only a creature, and hardcoding "a creature dying" both
    // told the reader an artifact was a creature and rendered two genuinely different reasons --
    // Scrap Trawler's dies:creature and dies:artifact -- as identical lines.
    case "dies":
      return subj === "any" ? "a permanent dying" : `${art(subj)} ${subj} dying`;
    // zoneEventKey turns leaves@battlefield into `dies`, so a bare `leaves` is a permanent going
    // somewhere the graveyard is not — exile, hand, library. Without a case it fell through to the
    // de-slugify default and shipped "triggers on leaves any" to the web UI as English.
    case "leaves":
      return subj === "any"
        ? "a permanent leaving the battlefield"
        : `${art(subj)} ${subj} leaving the battlefield`;
    // Same defect as `leaves`: no case, so the de-slugify default shipped "triggers on taps
    // creature" to the web UI as English. "Becoming tapped" rather than "being tapped", because the
    // event is the state change — a permanent that ARRIVES tapped never becomes tapped and emits
    // nothing (see ARRIVES_TAPPED in tagger's derive.ts).
    case "taps":
      return subj === "any" ? "a permanent becoming tapped" : `${art(subj)} ${subj} becoming tapped`;
    case "untaps":
      return subj === "any" ? "a permanent untapping" : `${art(subj)} ${subj} untapping`;
    case "counter-added":
      return "a counter being added";
    case "proliferate":
      return "proliferate";
    default:
      return key.replace(/[:-]/g, " ");
  }
}

/** Drop reasons identical in every field a reader or a score can see. `impliedProducer` is excluded
 *  from the key because it is provenance rather than content — two reasons that say the same thing
 *  are one reason whether or not one of them came from an implied event.
 *
 *  Needed in BOTH entry points, not just `pairReasons`: the card-synergy view calls
 *  `directedReasons` directly, so a producer with two graveyard-fill events feeding a consumer with
 *  two recursion abilities printed the same line four times. It also stops those repeats inflating
 *  `reasons.length`, which is the edge score. */
export function dedupeReasons(reasons: Reason[]): Reason[] {
  const seen = new Set<string>();
  const out: Reason[] = [];
  for (const r of reasons) {
    const k = JSON.stringify({ ...r, impliedProducer: undefined });
    if (!seen.has(k)) { seen.add(k); out.push(r); }
  }
  return out;
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
        // A SELF trigger watches ONE permanent — its own. `selfEtbSelfSupplied` excludes implied and
        // token producers, but an AUTHORED emit that puts some OTHER object onto the battlefield
        // survived it, because a self subject names no type and so checks nothing: Windswept Heath
        // fetching a Forest "triggered" The Grey Havens' own ETB.
        //
        // The test is whether the producer's event could BE this card, not whether it was authored —
        // Bloodstained Mire really does fetch Raucous Theater (Land — Swamp Mountain) and fire its
        // ETB, and a rule that deleted that would be the mistake the taps work already caught once.
        // `zone` is dropped for the same reason as in the reanimator gate below: printed
        // characteristics sit in no zone.
        if (t.subject.self === true) {
          const { zone: _eventZone, ...identity } = e.subject;
          // The producer re-entering ITSELF (Reassembling Skeleton, Drownyard Temple) is a real
          // entry for anything watching creatures, but it is never the CONSUMER entering, which is
          // the only event a self trigger watches.
          if (identity.self === true) continue;
          // An UNTYPED producer subject is left alone deliberately, and it is the residual this gate
          // cannot close. Refusing it looks right -- "something entered" is not evidence that THIS
          // card entered -- but the suite already holds the counterexample: Bolas's Citadel's
          // authored cast emit names nothing and genuinely does cast Nulldrifter off the top. The
          // same argument holds for enters. An untyped emit is a DERIVATION gap to fix upstream
          // (see the pronoun antecedent in tagger's derive.ts), not something to paper over here.
          if (!subjectMatches(characteristicsSubject(c.tags), identity, h)) continue;
        }
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
          impliedProducer: e.implied || undefined,
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
      // A SELF-scoped recursion returns the card ITSELF ("return this card from your graveyard"), so
      // a fill enables it only if that fill could contain THAT card. Reassembling Skeleton is a real
      // payoff for a sacrifice outlet that can eat it; Metalwork Colossus is not a payoff for Buried
      // Ruin sacrificing itself, because a land in the graveyard is not the Colossus.
      //
      // Without this, every one of the 160 graveyard-recursion effects in the corpus was enabled by
      // every graveyard fill in the deck: the recursion subject of a self-recursion names no type,
      // and `graveyardFillMatches` wildcards an untyped subject on purpose.
      //
      // `zone` is dropped from the fill before the test: a card's printed characteristics sit in no
      // zone, so keeping it would fail every card and silently delete the whole family.
      if (a.effect.subject.self === true) {
        const { zone: _fillZone, ...fillIdentity } = e.subject;
        if (!subjectMatches(characteristicsSubject(c.tags), fillIdentity, h)) continue;
      }
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
  // state. Tagged into the existing counter-added family so the tag pays off where it's actually
  // read: buildAxis/maxAxisWeight (axis.ts) do exact-tag lookup against the deck's axis, so a
  // `counter-added:*` Reason here counts on-axis alongside the event-edge ones. It does NOT
  // change deckFreq/themes/rankThemes/cohesion — those come from cardThemeTags (analyze.ts),
  // which reads triggers/emits/static kinds and never sees a Reason tag.
  //
  // Walks producerEvents(p.tags), not raw pa.emits: producerEvents adds proliferate-derived
  // counter events on top of authored ones, and its dedup means two abilities that emit the
  // identical event don't each spawn their own (byte-identical) Reason here.
  for (const emit of pEvents) {
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

  return dedupeReasons(reasons);
}

/** All reasons for the unordered pair {a,b}: union of a→b and b→a directional reasons, deduped
 *  by byte-identical shape modulo `impliedProducer` (e.g. an authored counter-added emit and a
 *  proliferate-derived counter-added emit can independently satisfy the same consumer trigger,
 *  producing two Reason objects that differ only in provenance — collapse those since dedup must
 *  not change edge score). `impliedProducer` is excluded from the key so a baseline-supplied match
 *  of the same tag/producer/consumer collapses into its authored counterpart instead of doubling
 *  the score. This relies on `producerEvents` (edges.ts) ordering authored emits before implied
 *  ones: keep-first here means the surviving copy has `impliedProducer: undefined`, which is also
 *  the copy `themeMembership` (themes.ts) wants for surplus credit. If that ordering ever changes,
 *  this dedup silently starts keeping the implied copy instead. */
export function pairReasons(a: DeckCard, b: DeckCard, h: Hierarchy): Reason[] {
  return dedupeReasons([...directedReasons(a, b, h), ...directedReasons(b, a, h)]);
}
