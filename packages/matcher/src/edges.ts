import type { Reason } from "@mtg/engine";
import type { CardTags, GameEvent, SubjectFilter } from "@mtg/tagger";
import { LAND_SUBTYPES } from "@mtg/tagger";
import type { DeckCard, Hierarchy } from "./types.js";
import { subjectMatches, graveyardFillMatches, counterAddMatches } from "./subject.js";
import { impliedEvents, impliedGraveyardEvents, impliedCounterEvents, isHistoric, keywordAbilities, selfFillTypes } from "./implied.js";
import { normalizeZoneEvent, zoneEventKey } from "./zones.js";
import { parseStat } from "./stats.js";
import { hasMediatingToken } from "./tokens.js";

const list = (v: string | string[] | undefined): string[] =>
  v === undefined ? [] : Array.isArray(v) ? v : [v];

/** A short human/grouping key for a subject: its subtype, else its type, else "any". */
export function themeSubjectKey(s: Partial<SubjectFilter>): string {
  // A NEGATION outranks the list it resolves to. `type` holds the six types "noncreature spell"
  // leaves, and taking the first of them keyed Valley Floodcaller as `cast:artifact` -- which
  // humanizeEvent then rendered, to the user, as "an artifact being cast" about an instant, and
  // which cardThemeTags grouped with artifact-cast decks. A subtype is more specific still, so it
  // keeps priority over both.
  // A NAME outranks everything below it — it identifies ONE card, which is as specific as a subject
  // gets. Only 10 clauses in the derived corpus carry one, so the theme fragmentation this could
  // cause is bounded, and a name really is its own theme where it appears.
  if (s.named !== undefined) return s.named;
  const negated = s.notType ?? [];
  // A DISJUNCTION holds its type/subtype in the branches, so a subject with `anyOf` has neither on
  // the outside and would key as "any" — turning Prowl's `enters:creature` into `enters:any` and
  // regrouping it with every untyped trigger. The first branch is the one the text names first.
  const first = s.anyOf?.[0];
  if (first !== undefined) return themeSubjectKey(first);
  // An UMBRELLA outranks the list it resolves to, for the same reason a negation does: "permanent
  // spell" resolves to five concrete types, and taking the first keyed Hylda's Crown of Winter --
  // an Artifact -- as `cast:creature`, which humanizeEvent renders as "a creature being cast". It
  // ranks BELOW the negation, because "nonland permanent" is more precisely named by what it
  // excludes, and that is the key the panel's verdicts already carry.
  return list(s.subtype)[0]
    ?? (negated.length ? `-${negated[0]}` : undefined)
    ?? s.umbrella
    ?? list(s.type)[0]
    ?? "any";
}

/** A card's set of theme tags (for deck-frequency ranking): one per trigger verb, emit, and
 *  static effect. Mirrors the flat engine's produces∪cares membership. */
/** The theme tags a card earns just by BEING a permanent that enters the battlefield.
 *
 *  `cardThemeTags` read a card's ABILITIES only, so a permanent's own entry contributed nothing:
 *  measured on `braids-mono-black-enchantress`, 36 of 75 nonlands ARE enchantments and only 8
 *  carried `enters:enchantment`, which is why that deck's cohesion read 0.14 once the fold stopped
 *  summing unrelated families into it.
 *
 *  Built off `impliedEvents` rather than re-derived, so the tag says exactly what the matcher
 *  claims -- one face at a time, no `cast` for a token (CR 111.7), a transform card's back face
 *  excluded. ENTRY ONLY: `impliedEvents` also pushes `cast` for every nonland and
 *  `attacks`/`combat-damage` for every creature, and adding those would make every nonland a
 *  `cast:` theme card and every creature an `attacks:` one -- a different and much larger claim.
 *
 *  Supply, never demand, so `cardCaresTags` does NOT get these and they enter `rankFreq` at
 *  `PRODUCER_SHARE` rather than at full weight.
 *
 *  KEYED AT THE SUBTYPE, not the card type, and the alternative was BUILT AND MEASURED rather than
 *  argued (spec §3). A type-level key LOST two subtype-level primaries -- `magar-spellslinger`
 *  `enters:treasure` and `rocket-the-mechanist` `enters:vehicle` both collapsing into
 *  `enters:artifact`, which is the exact collapse the family-ranking design was refused for -- and
 *  took distinct headlines to 20, under the incumbent 21. The subtype key loses none and takes
 *  distinct headlines to 29. Fragmentation is not a hazard here because `computeCohesion` FOLDS
 *  (`theme-fold.ts`), so a deck's Dragons are counted inside the creature family regardless. */
function impliedEntryThemeTags(tags: CardTags): string[] {
  // Absent characteristics (partial fixtures, and any caller holding a hand-built CardTags) yield
  // NO entry tags rather than throwing -- a missing answer, never a crash.
  if (!tags.characteristics) return [];
  // A LAND'S OWN ENTRY IS THE MANA BASE, NEVER A THEME -- the same ruling that keeps a fetchland
  // naming Swamp out of synergy, and that puts ramp and tax in `ROLE_NOT_SYNERGY`. MEASURED, not
  // assumed: without this the first cut of this function themed **38 of 71 decks** on a basic land
  // type -- "islands entering" on 13, "swamps entering" on 8, "mountains entering" on 5 -- because
  // ~35 basics per deck out-count every real theme. A landfall deck still themes `enters:land`
  // through the payoffs that TRIGGER on it and the ramp that AUTHORS it; what is excluded is a
  // Island claiming to be a theme by existing.
  if ((tags.characteristics.types ?? []).some((t) => t.toLowerCase() === "land")) return [];
  return impliedEvents(tags.characteristics)
    .filter((e) => e.verb === "enters")
    .flatMap((e) => {
      const n = normalizeZoneEvent(e);
      // ONE TAG PER SUBTYPE, not one keyed on the first (roadmap A9). `themeSubjectKey` returns a
      // single key and resolves subtypes with `list(subtype)[0]` -- the first as PRINTED -- so a
      // "Human Wizard" keyed `enters:human` and never `enters:wizard`, and printed order decided
      // which. Measured: `inalla`, a WIZARD deck, counted `enters:human` 15 against `enters:wizard`
      // 9, and `marchesa-legends-matter`, a LEGENDS deck, read the headline "humans entering".
      //
      // `themeSubjectKey` ITSELF IS NOT TOUCHED and must not be: it keys REASON tags, and the frozen
      // panel keys its cached verdicts on `producer|consumer|tag` -- the last attempt to compose
      // extra facts into that key cost 22 judging debt while changing no theme. Only the IMPLIED
      // entry fans out, and it has no Reason of its own. A card's AUTHORED emits keep first-subtype
      // keying above, so they stay consistent with the reason tags their edges carry.
      // A CHANGELING IS EVERY CREATURE TYPE, and fanning out over that is ~350 tags for one card.
      // `extractCharacteristics` replaces a changeling's subtypes with the whole CREATURE_SUBTYPES
      // list (printed ones FIRST), which is right for MATCHING -- a changeling really does satisfy
      // every typal payoff -- and nonsense as a THEME: measured, `tribal-tribal` went
      // "shapeshifters entering" -> "bears entering" and the corpus census nearly doubled,
      // 4,500 deck-tags -> 8,706. A changeling advertises its PRINTED type, which is subtypes[0].
      const changeling = (tags.characteristics.keywords ?? []).some((k) => k.toLowerCase() === "changeling");
      const subtypes = changeling
        ? [n.subject.subtype ?? []].flat().slice(0, 1).map((x) => String(x).toLowerCase())
        : [n.subject.subtype ?? []].flat().map((x) => String(x).toLowerCase());
      const keys = subtypes.length > 0
        ? subtypes.map((sub) => themeSubjectKey({ ...n.subject, subtype: sub }))
        : [themeSubjectKey(n.subject)];
      return [...new Set(keys)].map((k) => zoneEventKey(n.verb, n.subject.zone, k));
    });
}

export function cardThemeTags(tags: CardTags): Set<string> {
  const out = new Set<string>();
  for (const t of impliedEntryThemeTags(tags)) out.add(t);
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

/** The subset of `cardThemeTags` a card CARES about — its triggers, and nothing it merely does.
 *
 *  A deck's theme is what its payoffs watch for, not what its cards happen to emit. Measured on the
 *  owner's Sorin list: 20 cards emit life loss (mostly removal spells that drain incidentally)
 *  against 7 that trigger on casting a noncreature spell, so `cardThemeTags` — which counts triggers,
 *  emits and static effects indistinguishably — ranked the deck "lose life" while Charitable Levy,
 *  Sedgemoor Witch and Primal Amulet were the actual engine.
 *
 *  Deliberately a SEPARATE function rather than a flag on `cardThemeTags`: membership ("is this a
 *  lifegain card?") and identity ("is this a lifegain DECK?") are different questions, and the
 *  edge/theme-membership callers want the union. */
export function cardCaresTags(tags: CardTags): Set<string> {
  const out = new Set<string>();
  for (const a of tags.abilities) {
    if (a.trigger) for (const v of a.trigger.verbs) out.add(`${v}:${themeSubjectKey(a.trigger.subject)}`);
  }
  return out;
}

/** The card's characteristics expressed as a concrete subject, for static-edge matching. */
function characteristicsSubject(tags: CardTags, name?: string): SubjectFilter {
  const c = tags.characteristics;
  const types = c.types.map((t) => t.toLowerCase());
  const subtypes = c.subtypes.map((t) => t.toLowerCase());
  return {
    // The deck fact, on BOTH sides. `characteristicsSubject` is the CONSUMER argument in the
    // self-trigger identity gate below, so a commander's own emit — which carries `commander` after
    // markCommander — was tested against a printed subject that lacked it and failed, dropping the
    // card's self-triggers. The same both-sides lesson `legendary` records at 09ce98d: a one-sided
    // stamp deletes real edges instead of narrowing false ones.
    ...(c.commander === true ? { commander: true as const } : {}),
    // The card's own NAME, so a subject demanding one can be satisfied. Threaded from the DeckCard
    // rather than read off the tags, because `CardTags` carries an oracleId and characteristics and
    // has never carried the printed name. Only the callers that judge a card's identity pass it.
    ...(name !== undefined ? { named: name } : {}),
    ...(isHistoric(types, subtypes) ? { historic: true as const } : {}),
    // The supertype is already in `types`, but `type` is an OR list on a consumer subject, so a
    // legendary demand cannot be expressed there. Lifted to its own flag, as historic is.
    ...(types.includes("legendary") ? { legendary: true as const } : {}),
    ...(types.includes("basic") ? { basic: true as const } : {}),
    // Printed keywords, for the static pass — this is the side a "creatures you control with flying"
    // anthem is matched AGAINST, so without it every such anthem either reaches everything (before
    // the filter existed) or nothing (after, if only one side were done).
    ...(c.keywords?.length ? { keyword: c.keywords.map((k) => k.toLowerCase()) } : {}),
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
  const derived = [
    ...selfFillTypes(impliedGraveyardEvents(base), tags.characteristics),
    ...impliedCounterEvents(base),
  ];
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
  // A COMMANDER IS ONE OR TWO CARDS, so a combat consumer naming one is the narrowest shape there
  // is — the opposite of the deck-level state condition this gate exists to refuse. Without it
  // Kediss, Emberclaw Familiar's "whenever a commander you control deals combat damage" read as
  // generic combat, was judged self-supplied, and formed no edge at all — even to the commander.
  if (subject.commander === true) return true;
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
/** Effect kinds that describe what the DECK does rather than how two cards relate. A pairwise edge
 *  makes the same claim in every deck, which is exactly wrong for these: Sapphire Medallion in
 *  mono-red does nothing, and Ghostly Prison protects you the same however the other 99 are chosen.
 *  See the applies-to pass for the measured cost of leaving them in. */
// `win-game`, `extra-turn` and `extra-phase` join cost-reduction and tax for the same reason those
// two are here: they are deck ROLES, not pairwise claims. "This card wins the game" says the
// identical thing next to every other card in the deck, and an extra turn helps all 99 equally.
export const ROLE_NOT_SYNERGY: ReadonlySet<string> = new Set([
  "tax", "win-game", "extra-turn", "extra-phase",
]);

/** A SELF cost reduction reduces the card ITSELF, and its subject is the MEASURING STICK.
 *
 *  The Great Henge reads "This spell costs {X} less to cast, where X is the greatest power among
 *  creatures you control" and derives `cost-reduction` with subject `{type: creature, control:
 *  you}` — the creatures whose power sets X, NOT a set of cards it makes cheaper. Read as an
 *  ordinary reducer it claimed to discount 45 creatures in one deck and became that deck's
 *  top-rated card. Owner caught it the day the family was admitted; measured at **129 false
 *  reasons across the 71 decks, all of them The Great Henge**, out of 5,596 cost-reduction reasons.
 *
 *  Corpus-wide the family is **11 of 64 cards deriving a cost reduction (17%)** — Blasphemous Act,
 *  Bolt Bend, Sunderflock, Rowdy Research, Valiant Changeling, Excalibur, Furygale Flocking, Blood
 *  for the Blood God!, The Capitoline Triad, Mutated Cultist and the Henge. Ten of the eleven match
 *  this cue; the eleventh (Mutated Cultist, "the NEXT SPELL you cast this turn costs {1} less") is
 *  genuinely other-reducing and must keep its edges, which is why the looser "costs {1} less to
 *  cast for each" phrasing is NOT a cue — it appears on both shapes.
 *
 *  THE RELATION IS REAL IN REVERSE and this guard does not capture it: big creatures make the Henge
 *  cheaper, so the Henge is a `scales:`-family CONSUMER of power, not a producer of discounts.
 *  Refusing the wrong direction beats stating it backwards; the reverse edge is its own item.
 *
 *  ponytail: card-scoped cue, so a card printing BOTH a self reduction and a real other-reduction
 *  loses the real one. None of the 64 does today. Clause scoping would need the clause text at
 *  match time, which the matcher does not carry. */
const reducesItself = (oracleText: string | undefined): boolean =>
  /\bthis spell costs\b|\bthis ability costs\b/i.test(oracleText ?? "");

/** Card types that are PLAYED, never cast (CR 305.1) — a land can never be the consumer of a cost
 *  reduction, however broadly the reducer is worded. Checked against the card's whole type union so
 *  an Instant // Land modal DFC, which really is castable as its instant face, keeps its edge. */
const isLandOnly = (tags: CardTags): boolean =>
  tags.characteristics.types.length > 0 && tags.characteristics.types.every((t) => t === "land");

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

/** How a SELF trigger reads. `themeSubjectKey` ignores `subject.self`, so a card watching only its
 *  own entry keys `enters:any` and used to render as "a permanent entering" — a false sentence about
 *  a card that watches nothing but itself, and the one that sent defect A's diagnosis to
 *  `SubjectFilter.self` (which had covered "this land" since 2e27af4) instead of to the supertype and
 *  umbrella gaps actually forming the edges.
 *
 *  The TAG is deliberately not changed to match. It is the panel's join key, and re-keying it would
 *  detach every cached verdict on these pairs to fix prose — the trade DERIVE_VERSION 31 already
 *  refused once, keeping judging debt at 0 through the umbrella work. */
const SELF_EVENT: Record<string, string> = {
  enters: "its own entry",
  dies: "its own death",
  leaves: "its own departure",
  "enters-graveyard": "its own trip to the graveyard",
  cast: "being cast",
  attacks: "its own attack",
  taps: "becoming tapped",
  untaps: "untapping",
  // The generic `its own ${verb}` reads as "its own counter added", which is not English.
  "counter-added": "a counter being put on it",
};

/** Turn an internal zone-event key ("enters:creature", "cast:instant") into a reader-facing
 *  noun phrase. Fallback de-slugifies anything unmapped so no ":"/"-" token ever reaches the UI. */
function humanizeEvent(key: string, self = false): string {
  const [verb, subjRaw = ""] = key.split(":");
  // A self trigger names no class, whatever the key says — the subject IS the consumer.
  if (self) return SELF_EVENT[verb] ?? `its own ${verb.replace(/-/g, " ")}`;
  // A leading "-" is a NEGATED type (`cast:-creature`), which reads as the card writes it. Stripped
  // before the general dash-to-space rule, which would otherwise turn "-creature" into " creature"
  // and say the opposite of what the subject means.
  const negated = subjRaw.startsWith("-");
  const subj = negated ? `non${subjRaw.slice(1)} spell` : subjRaw.replace(/-/g, " ");
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
    // These fell through to the de-slugify default and shipped "triggers on gain life any" to the
    // UI as English. Latent before the keyword channel (2026-08-14) and unmissable after it, since
    // lifelink and extort make gain-life a common event where it was nearly absent.
    case "gain-life":
      return "life being gained";
    case "lose-life":
      return "life being lost";
    case "sacrifice":
      return subj === "any" ? "a permanent being sacrificed" : `${art(subj)} ${subj} being sacrificed`;
    case "create-token":
      return subj === "any" ? "a token being created" : `${art(subj)} ${subj} token being created`;
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

/** How many DISTINCT CLAIMS a reason set makes — the edge score, and not `reasons.length`.
 *
 *  ONE TRIGGER WITH A CHAIN OF EFFECTS IS ONE CLAIM. Archon of Cruelty's single entry trigger
 *  ("target opponent sacrifices a creature, discards a card and loses 3 life; you draw a card and
 *  gain 3 life") derives SIX reasons that are byte-identical in tag and text and differ only in
 *  `effectKind` — forced-sacrifice, (none), player-life-loss, draw-card, lifegain, drain — so every
 *  reanimation spell in the deck scored 6 against it while a one-payoff creature off the identical
 *  trigger scored 1. Measured across the 71 decks: **9,268 of 40,563 reasons (22.8%) sit in a
 *  duplicate (tag, text) group**, 4,010 groups over 3,985 edges (12.4%), sized 2x 3,012 · 3x 808 ·
 *  4x 160 · 6x 30 — and **64 of 71 decks re-order their top ten edges** when the duplicates stop
 *  counting. That is chain LENGTH driving the ranking, which is the magnitude axis wearing a
 *  disguise; magnitude belongs to `impactEdgeWeight` (max per distinct tag, already immune to this)
 *  and to the open edge-magnitude work, not to how many sentences one trigger generates.
 *
 *  THE REASONS THEMSELVES ARE NOT COLLAPSED, deliberately — `dedupeReasons` cannot merge them
 *  because `effectKind` is LOAD-BEARING for archetype detection: `mechanisms.ts` matches an
 *  archetype on a reason's kind, and Archon's six carry aristocrats' `forced-sacrifice`, `drain` and
 *  `player-life-loss` alongside `draw-card` and `lifegain`. Dropping five of six would silently
 *  narrow every detector that reads them. So the objects stay and only the COUNT collapses. */
export function claimCount(reasons: Reason[]): number {
  return new Set(reasons.map((r) => `${r.tag} ${r.text}`)).size;
}

/** Records which SIDE of a reason is a token node. A NAME IS NOT AN IDENTITY: 92 of the corpus's
 *  661 distinct token names are also a real card (Llanowar Elves, Mutavault, Sacred Cat), and a card
 *  that makes a token copy of itself puts both names in one deck. Every downstream reader keys on
 *  `producer`/`consumer` strings, so without this the two collapse into a single node and the
 *  token's relations are attributed to the card.
 *
 *  Stamped at the three CHOKE POINTS where the sides are still known objects -- this function's
 *  callers are `directedReasons`, `createsReasons` and `meldReason` -- rather than at each of the
 *  fifteen places a reason literal is built. Doing it later, off the names alone, is exactly the
 *  ambiguity this exists to remove.
 *
 *  The strings themselves are deliberately UNCHANGED: `pairs.json` keys the whole judged panel on
 *  `producer|consumer|tag`, so decorating a name would invalidate every cached verdict. */
function stampSides(r: Reason, producer: DeckCard, consumer: DeckCard): Reason {
  return {
    ...r,
    ...(producer.isToken ? { producerIsToken: true } : {}),
    ...(consumer.isToken ? { consumerIsToken: true } : {}),
  };
}

/** Directional reasons from producer P to consumer C: event edges (P.emits ↔ C.triggers) and
 *  static edges (P.static effect ↔ C.characteristics). */
export function directedReasons(p: DeckCard, c: DeckCard, h: Hierarchy): Reason[] {
  if (!p.tags || !c.tags) return [];
  const reasons: Reason[] = [];
  const pEvents = producerEvents(p.tags);

  // Event edges: normalized producer event ↔ normalized consumer trigger.
  // A printed KEYWORD can be a triggered ability too, and its reminder text is inert at the clause
  // layer, so `tags.abilities` never holds it — see `keywordAbilities`. The demand half of the same
  // channel `keywordEvents` supplies.
  const cAbilities = [...c.tags.abilities, ...keywordAbilities(c.tags.characteristics)];
  for (const e of pEvents) {
    for (const a of cAbilities) {
      if (!a.trigger) continue;
      for (const rawVerb of a.trigger.verbs) {
        const t = normalizeZoneEvent({ verb: rawVerb, subject: a.trigger.subject });
        if (!eventMatches(e, t, h)) continue;
        // TOKENS MEDIATE (Task 7, tokens-as-nodes, 2026-08-16). A maker's own "a Treasure enters"
        // event and the Treasure NODE's own implied "it enters" event (Task 6 -- `selfSubject` in
        // implied.ts now reads `chars.token` instead of hardcoding false) state the identical fact
        // twice: once as a direct maker->payoff edge, once as the two-hop maker->token->payoff path
        // the token node already supplies on its own (it rides the same `pairPool` every other card
        // does, per `analyze.ts`). Drop the shortcut; the two-hop path stands.
        //
        // TWO EXEMPTIONS, both required for the design to hold together and both PROVEN by a test in
        // edges.test.ts rather than assumed:
        //  - the PRODUCER must not itself be a token node. A token's own implied `enters` ALSO
        //    carries `subject.token === true` -- that is exactly what lets it supply the second hop --
        //    so a token-blind rule would delete that hop along with the first and leave no path at
        //    all between the maker and its payoffs.
        //  - `create-token` is never suppressed. It is not a legal TRIGGERS member the clause layer
        //    can produce (normalize-prompt.ts's TRIGGERS has no such event), so the only ability in
        //    the corpus with `trigger.verbs` including it is a CR 614 multiplier
        //    (derive/replacement.ts) -- and a token never "creates a token" by existing, so there is
        //    no second hop for that verb to duplicate. The owner's ruling: a multiplier consumes the
        //    MAKER's action, never the token's, and this is why the generic rule needs no special case
        //    for it once the verb is excluded.
        //  - the producer must actually HAVE a token a node can be built from. Suppression trades a
        //    direct edge for a two-hop path; if the trade receives nothing, the relation is simply
        //    deleted. Second Harvest's only token part is the placeholder "Copy" (type line
        //    `Token`, no card type, its own oracle text calling itself a stand-in), so its
        //    "for each token you control, create a copy" claimed NOTHING -- 0.3 rating, one
        //    partner, invisible to a Caretaker's Talent in the same deck. See
        //    `hasMediatingToken` in tokens.ts.
        if (
          e.subject.token === true && t.verb !== "create-token" && !p.isToken && !c.isToken
          && hasMediatingToken(p.card)
        ) continue;
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
          // `counter` is dropped for the same reason `zone` is dropped in the self-recursion gate
          // below: this compares against a card's PRINTED characteristics, and a counter is a board
          // state no type line carries. Keeping it made The Great Henge unable to put a +1/+1
          // counter on Dusk Legion Duelist, whose trigger watches exactly that.
          const { counter: _stateOnly, ...printedMatchable } = identity;
          if (!subjectMatches(characteristicsSubject(c.tags, c.card.name), printedMatchable, h)) continue;
        }
        const key = zoneEventKey(t.verb, t.subject.zone, themeSubjectKey(t.subject));
        reasons.push({
          tag: key,
          text: `${c.card.name} triggers on ${humanizeEvent(key, t.subject.self === true)}; ${p.card.name} supplies it`,
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
        // A fill that is ITSELF self-scoped puts the PRODUCER into the graveyard, and the producer is
        // never the consumer in a pair. `self` rode along in fillIdentity below, where subjectMatches
        // does not read it, so the fill looked untyped and wildcarded through the very check that
        // exists to demand proof: Necromancy sacrificing itself "enabled" Eye of Nidhogg returning
        // itself.
        if (e.subject.self === true) continue;
        const { zone: _fillZone, ...fillIdentity } = e.subject;
        if (!subjectMatches(characteristicsSubject(c.tags, c.card.name), fillIdentity, h)) continue;
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

  // Scaling edge: a producer graveyard fill makes C's per-graveyard payoff BIGGER. Not a trigger —
  // nothing fires — which is why the channel had no edge despite `effect.scaling` being derived,
  // copied onto every Reason and read by impact.ts, buckets.ts and wincon.ts. Bonehoard is a 0/0
  // Germ until something dies.
  //
  // GATED ON WHAT IS COUNTED, never on the basis alone. `per-graveyard` covers Cavalier of Flame's
  // LAND cards, Glamdring's instants and sorceries and Bonehoard's creatures alike, and the basis
  // would claim all three are fed by milling anything — 676 candidate pairs across the 71 decks.
  // `effect.scalingSubject` carries the counted type and whose graveyard, so the fill goes through
  // `graveyardFillMatches` exactly as a reanimator demand does. A payoff whose count derived no
  // subject forms nothing rather than everything.
  for (const e of pEvents) {
    if (!(e.verb === "enters" && e.subject.zone === "graveyard")) continue;
    for (const a of c.tags.abilities) {
      if (a.effect.scaling !== "per-graveyard" || !a.effect.scalingSubject) continue;
      // AN UNTYPED COUNT IS A WILDCARD, and `graveyardFillMatches` passes an untyped demand on
      // purpose, so this is where it has to be refused. Rite of Flame counts "cards NAMED Rite of
      // Flame in each graveyard" — a name, which no SubjectFilter can express — and it parsed to
      // nothing and claimed all 61 fills in its decks. Riverchurn Monument's "cards in their
      // graveyard" is honestly untyped and goes the same way: 49 claims the engine cannot justify.
      // A missing answer beats a wrong one, and the two are 110 of the 273 this loop first made.
      //
      // For RITE OF FLAME the refusal is the whole answer, not a stopgap: EDH is singleton, so a
      // card counting its own name finds at most one other copy, in an opponent's graveyard.
      // BUT THE `named` GAP ITSELF IS REAL HERE, and singleton is not the argument against it
      // (owner, 2026-08-15): **13 corpus cards say "a deck can have any number of cards named …"
      // and all 13 count their own name** — Dragon's Approach, Slime Against Humanity, Shadowborn
      // Apostle, Rat Colony, Hare Apparent, Persistent Petitioners. A Dragon's Approach deck runs 30
      // copies and the engine cannot see the archetype at all. 35 cards count a name anywhere, 19 of
      // them in a graveyard. That is a roadmap item, not a line of code here.
      const counted = a.effect.scalingSubject;
      if (list(counted.type).length === 0 && list(counted.subtype).length === 0) continue;
      // A deck ROLE is not a pairwise synergy, and cost-reduction is the rule's own first member:
      // The Capitoline Triad costs less for each historic card in your graveyard, which says the
      // same thing next to every card in the deck.
      if (ROLE_NOT_SYNERGY.has(a.effect.kind)) continue;
      if (!graveyardFillMatches(e.subject, a.effect.scalingSubject, h)) continue;
      reasons.push({
        tag: `scales:${themeSubjectKey(a.effect.scalingSubject)}`,
        text: `${p.card.name} fills the graveyard, growing ${c.card.name}`,
        effectKind: a.effect.kind,
        repeatability: a.kind === "static" ? "static" : a.kind === "activated" ? "activated" : "triggered",
        scaling: a.effect.scaling,
        consumer: c.card.name,
        producer: p.card.name,
      });
    }
  }

  // A WIN CONDITION THAT NAMES WHAT IT COUNTS IS A RELATION, NOT A ROLE. `win-game` sits in
  // ROLE_NOT_SYNERGY because "this card wins the game" says the identical thing next to every card —
  // true of Laboratory Maniac, false of Revel in Riches, which wins on ten TREASURES and is
  // therefore a claim about Treasure producers. Gated on `thresholdSubject`: an untyped win
  // condition stays a role, exactly as before.
  for (const a of c.tags.abilities) {
    if (a.effect.kind !== "win-game") continue;
    const counted = a.trigger?.thresholdSubject;
    if (!counted) continue;
    if (!subjectMatches(characteristicsSubject(p.tags, p.card.name), counted, h)) continue;
    reasons.push({
      tag: `wincon:${themeSubjectKey(counted)}`,
      text: `${p.card.name} is what ${c.card.name} counts toward winning`,
      effectKind: a.effect.kind,
      repeatability: "static",
      consumer: c.card.name,
      producer: p.card.name,
    });
  }

  // Static edges: P is a lord whose effect subject C's characteristics satisfy. (UNCHANGED)
  //
  // Plus one non-static kind. A `clone` states WHICH permanent becomes the copy — "target
  // Shapeshifter becomes a copy of target creature" — and derive keeps that subject only when it
  // names a SUBTYPE, so the shape is typal by construction and cannot mesh the way an untyped lord
  // does. Shapesharer is an ACTIVATED ability, so this pass never saw it and Universal Automaton, a
  // Shapeshifter in the same deck, got no edge. Nothing else is widened: `token-generation` and the
  // other 500-odd non-static subjects with a subtype name what the card MAKES, not what it applies
  // to, and they are already carried by their emit.
  //
  // The subtype test lives HERE and not only in derive because both tag sources reach this pass:
  // measured, admitting every clone subject added 7,622 derived edges, a `clone:any` mesh 99 cards
  // wide on Mizzix's Mastery and Lithoform Engine. "Copy target instant" names no permanent it
  // applies to, and an untyped subject matches the whole deck.
  for (const a of p.tags.abilities) {
    const appliesTo = a.kind === "static"
      || (a.effect.kind === "clone" && a.effect.subject?.subtype !== undefined);
    if (!appliesTo || !a.effect.subject) continue;
    // DECK ROLES ARE NOT PAIRWISE SYNERGIES (user rulings, 2026-08-06) — WITH `cost-reduction`
    // REMOVED FROM THAT SET BY THE OWNER, 2026-08-18: "your cost reducing card is as good as many
    // cards it can reduce."
    //
    // The 2026-08-06 argument was that a Medallion makes the identical claim in every deck, since
    // Sapphire Medallion in mono-red does nothing. The overturning argument is that it does nothing
    // there BECAUSE there is nothing to reduce, which a pairwise edge states correctly by forming
    // zero edges in that deck and forty in a mono-blue one. The colour and type restrictions are
    // already on the subject, so `subjectMatches` does that work for free.
    //
    // The measured cost is fan-out, and it is real: admitting this family takes edges 32,220 ->
    // 36,607, reasons 40,612 -> 46,219 and MESHED 288 -> 3,420, with Ugin, the Ineffable reaching
    // 74 cards in one deck. Fan-out is the POINT here (the count is the value), so `mesh.ts` exempts
    // this one tag from the mesh census rather than letting a deliberate width drown the instrument
    // that exists to catch accidental ones.
    //
    // `tax` is INTERACTION / PROTECTION. Propaganda and Ghostly Prison make opponents attack you
    // less. That is a role the deck plays against the table, not a relation to a card you chose to
    // run — Ghostly Prison protects you exactly as much whatever else is in the 99.
    //
    // Both still DERIVE: the kinds remain on the card and stay available as role signals for
    // `build.ts`. They simply stop claiming an edge.
    if (ROLE_NOT_SYNERGY.has(a.effect.kind)) continue;
    // A counter-presence condition ("creatures you control WITH a +1/+1 counter") is a BOARD STATE,
    // not a printed characteristic, and this pass matches against the type line. Demanding it here
    // deletes the edge outright -- Sludge Monster's anthem stopped reaching anything. The dedicated
    // counter-presence pass below is what supplies that state.
    const { counter: _stateOnly, ...printedMatchable } = a.effect.subject;
    if (!subjectMatches(characteristicsSubject(c.tags, c.card.name), printedMatchable, h)) continue;
    if (a.effect.kind === "cost-reduction") {
      // A SELF REDUCTION'S SUBJECT IS WHAT MEASURES IT, NOT WHAT IT DISCOUNTS — see `reducesItself`.
      if (reducesItself(p.card.oracleText)) continue;
      // A LAND IS PLAYED, NOT CAST (CR 305.1). "Spells you cast cost {1} less" reaches no land, and
      // the type union keeps a modal DFC's castable face.
      if (isLandOnly(c.tags)) continue;
      // "Spells your OPPONENTS cast cost less" is not a relation to a card you chose to run — it is
      // the tax family pointing the other way, and tax stays in ROLE_NOT_SYNERGY.
      if (a.effect.subject.control === "opp") continue;
    }
    reasons.push({
      // A non-static ability keeps the `${kind}:${subject}` shape the graveyard-recursion and
      // counter-presence passes use; `static:` stays reserved for what cardThemeTags calls static.
      tag: a.kind === "static"
        ? `static:${a.effect.kind}`
        : `${a.effect.kind}:${themeSubjectKey(a.effect.subject)}`,
      text: a.effect.kind === "cost-reduction"
        ? `${p.card.name} reduces what ${c.card.name} costs`
        : `${p.card.name}'s ${a.effect.kind.replace(/-/g, " ")} applies to ${c.card.name}`,
      effectKind: a.effect.kind,
      repeatability:
        a.kind === "static" ? "static" : a.kind === "activated" ? "activated" : a.kind === "on-cast" ? "oneshot" : "triggered",
      scaling: a.effect.scaling,
      hasStatPredicate: (a.effect.subject?.stats?.length ?? 0) > 0 || undefined,
      consumer: c.card.name,
      producer: p.card.name,
    });
  }
  // TUTOR edges: P can SEARCH UP C. "My search can find you" is not a producer-event to
  // consumer-trigger relation, which is why the recall measurement filed the family as
  // `miss-inexpressible` — wrongly, Commander Salt models it. Flamekin Harbinger searching for an
  // Elemental card genuinely relates to every Elemental in the deck.
  //
  // GATED ON A SUBTYPE, for exactly the reason the clone gate is. Of 115 corpus search actions,
  // "a card" (Demonic Tutor, Grim Tutor, Gamble) reaches all 99 others, "a creature card" (Worldly
  // Tutor) reaches the whole creature base, "an artifact card" (Fabricate) the whole artifact base.
  // A bare TYPE is not a relation to any particular card. A SUBTYPE is.
  //
  // LAND subtypes are excluded on top of that: a fetchland naming Swamp is the MANA BASE, and the
  // cost-reduction and tax rulings already settled that a deck property is not a pairwise synergy.
  // 60 of the 115 search actions are land fetches, and every one would edge to every dual.
  //
  // `top-manipulation` is shared with scry, surveil and mill — none of which carry a narrowing
  // subject, so the same gate keeps them out without needing to know the verb.
  for (const a of p.tags.abilities) {
    if (a.effect.kind !== "top-manipulation" || !a.effect.subject) continue;
    // A SUBTYPE or a STAT PREDICATE narrows; a bare type does not. `combatNarrowsOffType` has said
    // the same about stats all along — Imperial Recruiter's "power 2 or less" and Spellseeker's
    // "mana value 2 or less" pick out particular cards, not a whole type.
    // A disjunction keeps its subtypes in the branches: Magda's "an artifact or Dragon card" is
    // `anyOf: [{type: artifact}, {subtype: dragon}]`, and reading only the outer subject would miss
    // the Dragon half that makes her a typal tutor at all.
    const subs = [
      ...list(a.effect.subject.subtype),
      ...(a.effect.subject.anyOf ?? []).flatMap((b) => list(b.subtype)),
    ];
    // A NAME narrows harder than any subtype: it picks out one card. The First Doctor searches for
    // "a card named TARDIS" and derived a bare `top-manipulation` the gate refused as unnarrowed, so
    // the most specific tutor in the corpus was the one that formed nothing.
    const narrows = subs.length > 0 || (a.effect.subject.stats?.length ?? 0) > 0
      || a.effect.subject.named !== undefined;
    // A LAND FINDER IS ITS OWN RELATION, and it is the one the ramp diagnostic is built on (owner's
    // ruling, 2026-08-15, reversing the blanket land exclusion above). Farseek relates to the Plains,
    // Islands, Swamps and Mountains it can actually fetch — including every dual carrying one of
    // those basic types — and Rampant Growth to the basics. That relation is what lets a report say
    // "your ramp finds 4 targets for this colour and 11 for that one", which is a deckbuilding fact
    // no other channel in the engine can state. `bin/ramp-coverage.ts` is its consumer.
    //
    // TWO SHAPES, because the cards say it two ways: a BASIC LAND TYPE list (Farseek, the fetchlands)
    // and the `basic` supertype (Rampant Growth, Cultivate, Evolving Wilds). A bare "a land card"
    // (Expedition Map, Sowing Mycospawn — 2 cards) stays refused: every land answers it, so it names
    // no particular card, which is the same bar the typal tutors clear.
    //
    // CONTROL IS LOAD-BEARING HERE. Path to Exile and Assassin's Trophy search for a basic land too —
    // for the OPPONENT, as compensation for removal — and derive `control: "opp"`. Claiming they ramp
    // YOUR mana base is a wrong sentence. `any` is kept: it is the parser's "could not tell", and
    // Cultivate and Evolving Wilds both land there.
    const landSubtypes = subs.length > 0 && subs.every((s) => LAND_SUBTYPES.has(s));
    const basicLand = a.effect.subject.basic === true && list(a.effect.subject.type).includes("land");
    const found = characteristicsSubject(c.tags, c.card.name);
    if (landSubtypes || basicLand) {
      if (a.effect.subject.control === "opp") continue;
      if (!subjectMatches(found, a.effect.subject, h)) continue;
      reasons.push({
        tag: `ramp-target:${landSubtypes ? themeSubjectKey(a.effect.subject) : "basic"}`,
        text: `${p.card.name} can fetch ${c.card.name}`,
        effectKind: a.effect.kind,
        repeatability:
          a.kind === "static" ? "static" : a.kind === "activated" ? "activated" : a.kind === "on-cast" ? "oneshot" : "triggered",
        scaling: a.effect.scaling,
        consumer: c.card.name,
        producer: p.card.name,
      });
      continue;
    }
    if (!narrows) continue;
    if (!subjectMatches(found, a.effect.subject, h)) continue;
    // Key on the branch that MATCHED. "An artifact or Dragon card" keyed as `tutor:artifact` would
    // report a Dragon as an artifact — the same defect themeSubjectKey documents for negations.
    const { anyOf, ...shared } = a.effect.subject;
    const matched = anyOf?.find((b) => subjectMatches(found, { ...shared, ...b }, h));
    reasons.push({
      tag: `tutor:${themeSubjectKey(matched ?? a.effect.subject)}`,
      text: `${p.card.name} can search up ${c.card.name}`,
      effectKind: a.effect.kind,
      repeatability:
        a.kind === "static" ? "static" : a.kind === "activated" ? "activated" : a.kind === "on-cast" ? "oneshot" : "triggered",
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

  return dedupeReasons(reasons.map((r) => stampSides(r, p, c)));
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
/** MELD: the one relation here that is card NAME to card NAME.
 *
 *  Mishra, Claimed by Gix names "a creature named Phyrexian Dragon Engine" outright. Everything else
 *  in this file matches a producer EVENT to a consumer TRIGGER, so that shape had nowhere to land —
 *  the recall measurement filed the pair `miss-inexpressible`, which was wrong: Commander Salt
 *  models it as a `named` qualifier, MTGJSON as `cardParts`, and `ingest-meld.ts` now puts
 *  `meldPartner` on the card as a printed characteristic.
 *
 *  Emitted from `pairReasons` rather than `directedReasons` because the relation is SYMMETRIC and the
 *  pair is one fact: both halves must be on the battlefield, so neither is the producer. Emitting it
 *  per direction would double every meld pair in the report.
 *
 *  There is no `effectKind`: the closed 30 are payoff kinds, and melding is not one of them. The
 *  field is optional for exactly this sort of case. */
function meldReason(a: DeckCard, b: DeckCard): Reason[] {
  const partnered = a.card.meldPartner === b.card.name || b.card.meldPartner === a.card.name;
  if (!partnered) return [];
  return [stampSides({
    tag: "meld",
    text: `${a.card.name} and ${b.card.name} meld together`,
    repeatability: "oneshot",
    producer: a.card.name,
    consumer: b.card.name,
  }, a, b)];
}

/** Token creation edges: a producer's own AUTHORED create-token emit, matched against the token
 *  NODE's characteristics (Task 6, tokens-as-nodes). A dedicated pass because every other reason in
 *  this file requires the CONSUMER to carry an ability (a trigger, an effect subject) -- a token
 *  node commonly has none: 59 of the 94 derived tokens are vanilla (a plain Flying Bird), and
 *  without this a maker card and its own token would form no edge at all despite the token sitting
 *  on the node set.
 *
 *  RESTRICTED TO AUTHORED emits (`ability.emits`), never `producerEvents`'s keyword-implied ones
 *  (Amass, Fabricate, Embalm, ...). A keyword-implied create-token event carries no type filter --
 *  `KEYWORD_EMITS` records `{verb:"create-token", token:true}` and nothing else -- so matching it
 *  through `subjectMatches` would claim a Fabricate creature makes every OTHER token type in the
 *  deck too, since every token satisfies a filter that only checks control and token-ness.
 *
 *  Callers must gate this to pairs where `p` is structurally known to create `c`
 *  (`createdTokenRefs`, matcher/tokens.ts -- the exact printingId join Task 3/4a built) before
 *  calling: that is what stops an untyped authored emit (rare, but present) from wildcarding onto a
 *  token this card never actually makes. `subjectMatches`/`themeSubjectKey` here only pick the best
 *  reason tag/text among the card's own emits, never decide the relationship itself. */
/** Does `p` create token `c` UNDER OUR CONTROL? Beast Within and Generous Gift make their Beast/
 *  Elephant for the permanent's controller -- "Its controller creates a 3/3 green Beast" -- and the
 *  clause layer already records that, `control: "opp"` on the `create-token` emit.
 *
 *  Separate from `createsReasons` on purpose, and the graph edge deliberately keeps ignoring it: "this
 *  card makes that token exist" is TRUE for Beast Within, which is why the token is on its board at
 *  all. What is false is the RATINGS claim built on top of it -- that Beast Within supports your
 *  token payoff -- because a payoff says "tokens YOU control". So the traversal gates, the edge does
 *  not. `control: "any"` counts as ours: a card that says only "create a 4/4 Dragon" (Elemental
 *  Eruption) creates it under its own controller, and refusing those would delete nearly every real
 *  token maker in the corpus. */
export function createsForYou(p: DeckCard, c: DeckCard, h: Hierarchy): boolean {
  if (!p.tags || !c.tags || c.tags.characteristics.token !== true) return false;
  const consumerSubject = characteristicsSubject(c.tags, c.card.name);
  return p.tags.abilities.some((pa) =>
    (pa.emits ?? []).some((e) =>
      e.verb === "create-token" && e.subject.control !== "opp" && subjectMatches(consumerSubject, e.subject, h)));
}

export function createsReasons(p: DeckCard, c: DeckCard, h: Hierarchy): Reason[] {
  if (!p.tags || !c.tags || c.tags.characteristics.token !== true) return [];
  const consumerSubject = characteristicsSubject(c.tags, c.card.name);
  const reasons: Reason[] = [];
  for (const pa of p.tags.abilities) {
    for (const e of pa.emits ?? []) {
      if (e.verb !== "create-token") continue;
      if (!subjectMatches(consumerSubject, e.subject, h)) continue;
      reasons.push({
        tag: `creates:${themeSubjectKey(e.subject)}`,
        text: `${p.card.name} creates ${c.card.name}`,
        effectKind: "token-generation",
        repeatability:
          pa.kind === "static" ? "static" : pa.kind === "activated" ? "activated" : pa.kind === "on-cast" ? "oneshot" : "triggered",
        consumer: c.card.name,
        producer: p.card.name,
      });
    }
  }
  return dedupeReasons(reasons.map((r) => stampSides(r, p, c)));
}

export function pairReasons(a: DeckCard, b: DeckCard, h: Hierarchy): Reason[] {
  return dedupeReasons([
    ...directedReasons(a, b, h),
    ...directedReasons(b, a, h),
    ...meldReason(a, b),
  ]);
}
