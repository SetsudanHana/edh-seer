import type { Ability, CardTags, Characteristics, GameEvent, SubjectFilter } from "@mtg/tagger";
import { parseSubject } from "@mtg/tagger";
import { parseStat } from "./stats.js";

const PERMANENT_TYPES = new Set(["creature", "artifact", "enchantment", "planeswalker", "battle", "land"]);

/** Collapse a string list to undefined (empty), a bare string (one), or the array (many) — the
 *  SubjectFilter convention so "x" and ["x"] compare equal downstream. */
function collapse(a: string[]): string | string[] | undefined {
  return a.length === 0 ? undefined : a.length === 1 ? a[0] : a;
}

/** The concrete subject for the card entering/being cast: its own characteristics. token:false
 *  because a printed card entering is never a token; control:"you" because it is yours. */
/** Historic is a printed fact: artifact, legendary, or Saga. `splitTypeLine` keeps supertypes in
 *  `types`, so "Legendary Creature — Human Noble" arrives as ["legendary","creature"] and the
 *  supertype needs no separate field. */
export function isHistoric(types: string[], subtypes: string[]): boolean {
  return types.includes("legendary") || types.includes("artifact") || subtypes.includes("saga");
}

/** CR 700.12: an outlaw is an object with the Assassin, Mercenary, Pirate, Rogue and/or Warlock
 *  creature type. A printed fact, read off the type line exactly as `isHistoric` is — the noun is
 *  the only thing that is new, and it is the reason a card can say "other outlaws you control" and
 *  mean five subtypes at once. */
const OUTLAW_SUBTYPES = ["assassin", "mercenary", "pirate", "rogue", "warlock"];
export function isOutlaw(subtypes: string[]): boolean {
  return subtypes.some((s) => OUTLAW_SUBTYPES.includes(s));
}

function selfSubject(chars: Characteristics): SubjectFilter {
  const types = chars.types.map((t) => t.toLowerCase());
  const subtypes = chars.subtypes.map((t) => t.toLowerCase());
  // `token: false` was hardcoded here for the project's whole life, correctly -- until a TOKEN
  // itself became a node with its own implied events (Task 6, tokens-as-nodes). A token's own entry
  // genuinely IS a token, and reading `chars.token` (already correct on a real card, which is always
  // false per `Characteristics.token`'s own doc comment) is what lets "whenever a token enters" match
  // it, exactly as `characteristicsSubject` (edges.ts) already reads it for the consumer side.
  const out: SubjectFilter = { control: "you", token: chars.token === true };
  const type = collapse(types);
  const subtype = collapse(subtypes);
  if (type !== undefined) out.type = type;
  if (subtype !== undefined) out.subtype = subtype;
  if (isHistoric(types, subtypes)) out.historic = true;
  if (isOutlaw(subtypes)) out.outlaw = true;
  // NO `modified` STAMP, and the reason is measured rather than architectural. CR 700.9 has exactly
  // one printed case — a permanent that ENTERS WITH COUNTERS on itself is modified on arrival — but
  // that fact lives in the card's ABILITIES (the `enters-with-counters` effect kind) and this
  // function sees only `Characteristics`. Widening the signature buys nothing today: the only
  // derived consumer of a `modified` subject is Kodama of the West Tree, whose trigger is
  // combat-damage, and `combatSelfSupplied` already refuses every baseline producer for it — so
  // Kodama forms 0 combat-damage reasons with or without a supply side. Wire it when a consumer
  // exists that a stamped producer could actually reach.
  // A card's own cast/enters event must advertise its COLOURS, or every colour-narrowed trigger
  // matches nothing: Aragorn, the Uniter watches white, blue, red and green spells and found none of
  // its own deck. Written even when EMPTY, because "colorless" is a real answer and an absent field
  // would be indistinguishable from "not recorded". 53 cast triggers across 44 corpus cards filter
  // on colour.
  out.colors = chars.colors;
  // A legendary card entering IS "another legendary creature you control enters" (Legolas, Gimli,
  // Tinybones Joins Up). Without this the supertype filter cut five real edges: the consumer demanded
  // legendary and the producer's own entry never advertised it, so a legend failed to be a legend.
  if (types.includes("legendary")) out.legendary = true;
  // Set on BOTH sides for the same reason legendary is: a producer that fetches "a basic land card"
  // must be satisfiable by the basic it actually fetches, and a demand nothing can meet is a
  // silently deleted edge rather than a refused one.
  if (types.includes("basic")) out.basic = true;
  // The producer half of `SubjectFilter.keyword`, and free — `Characteristics.keywords` arrives on
  // the Scryfall payload. Set here for the reason 09ce98d records about legendary: a consumer
  // demanding flying that no producer can advertise deletes real edges rather than narrowing false
  // ones. Lowercased because the demand is parsed from lowercased clause text.
  if (chars.keywords?.length) out.keyword = chars.keywords.map((k) => k.toLowerCase());
  // The deck fact, so a commander's IMPLIED cast/enters/attacks/combat-damage advertise it too. See
  // commander.ts: stamping only authored emits left a commander-matters consumer blind to the very
  // events commanders mostly supply.
  if (chars.commander === true) out.commander = true;
  out.power = parseStat(chars.power);
  out.toughness = parseStat(chars.toughness);
  out.manaValue = chars.cmc;
  return out;
}

/** A card's own producer events, derived from its characteristics (not authored by the tagger):
 *  - any nonland card is CAST (instants/sorceries/permanents) -> emits { verb: "cast" };
 *  - any permanent (incl. lands) ENTERS the battlefield -> emits { verb: "enters" }.
 *  So a nonland permanent implies both; instant/sorcery implies cast only; a land implies
 *  enters only (landfall). Every subject carries the card's full types + subtypes.
 *  Every event this function returns carries `implied: true` — the marker that separates
 *  baseline supply (a card merely existing) from authored surplus. `directedReasons` (edges.ts)
 *  reads it on every reason it produces; `combatSelfSupplied` in edges.ts also reads it, but only
 *  for combat verbs; see the comment below. */
export function impliedEvents(chars: Characteristics): GameEvent[] {
  // ONE FACE AT A TIME. A card is cast or played as a single face, so each playable face gets its
  // own events and they are never merged into one subject. Merging is what `types` does, and it is
  // right for what a permanent can BE and wrong for what enters or is cast: read as one subject,
  // "Instant // Land" is a land you cast and an instant that enters the battlefield, and
  // "Artifact // Land — Cave" is a land that supplies landfall while being unable to be cast at all.
  // A transform or flip card lists only its front face here, so its back contributes nothing.
  const faces = chars.faces ?? [{ types: chars.types, subtypes: chars.subtypes }];
  const out: GameEvent[] = [];
  const seen = new Set<string>();
  for (const face of faces) {
    const types = face.types.map((t) => t.toLowerCase());
    const isLand = types.includes("land");
    const isPermanent = types.some((t) => PERMANENT_TYPES.has(t));
    // Power and toughness belong to the CREATURE face and to no other. Marang River Regent //
    // Coil and Catch is a 4/4 Dragon and an Instant — Omen; without this the instant half advertises
    // a power of 4 to any stats-conditioned consumer. `cmc` cannot be split the same way — the face
    // mana costs are on the card document and not on `Characteristics` — so an adventure's spell
    // half still reports the creature's mana value. That is a known imprecision, unchanged from
    // when both faces shared one merged subject.
    const stats = types.includes("creature") ? {} : { power: null, toughness: null };
    const subject = selfSubject({ ...chars, ...face, ...stats });
    const push = (verb: GameEvent["verb"]): void => {
      const key = verb + JSON.stringify(subject);
      // Wear // Tear is Instant // Instant: two faces, one event.
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ verb, subject, implied: true });
    };
    // CR 111.7: a token is neither a card nor a spell, so it is never cast. Unreachable for a real
    // card (`Characteristics.token` is always false there) until Task 6 put a TOKEN's own
    // characteristics through this function -- untested before because nothing ever called it with
    // `token: true`. Without this a Treasure or a Bird satisfied "whenever you cast a creature spell"
    // just by existing on the node set: measured on the 71 calibration decks, 1,115 reasons touching
    // a token carried the `cast` verb before this line existed, more than every other family
    // combined including `creates` itself (511).
    if (!isLand && !chars.token) push("cast");
    if (isPermanent) push("enters");
    // A creature on the battlefield can attack and connect, exactly as a nonland card can be cast.
    // These only ever reach a consumer that filters on WHICH creature attacks -- see
    // `combatSelfSupplied` in edges.ts for why the generic case forms no edge. `implied: true`
    // marks them as synthetic so that gate applies only to these, never to a card's own AUTHORED
    // attacks/combat-damage emit (goad, Mage Slayer, Saskia).
    if (types.includes("creature")) {
      push("attacks");
      push("combat-damage");
    }
  }
  // Printed keywords are supply too, and were a dead channel until 2026-08-14. Appended once for the
  // whole card rather than per face: a keyword is printed on the card, not on a face.
  out.push(...keywordEvents(chars));
  // A Saga's own death, which no ability states — see `sagaEvents`. Once for the card, same reason.
  out.push(...sagaEvents(chars));
  return out;
}

/** What a PRINTED KEYWORD supplies, keyed by the keyword and justified by its printed reminder text.
 *
 *  `Characteristics.keywords` arrives free on the Scryfall payload and MTGJSON's 220 keyword
 *  abilities are already generated into `vocabulary.json`, but until now the only reader anywhere in
 *  the matcher was `graph.ts`, drawing keyword nodes for the graph view — nothing in edge formation
 *  looked at it. Measured on the normalized corpus: 23 cards carry Lifelink and never say "gain" in
 *  their own text, and NOT ONE emitted `gain-life`, against 7 corpus consumers watching exactly that.
 *
 *  Each mapping quotes the reminder it comes from. Reminder text is PRINTED DATA mined from the
 *  corpus, which is the same discipline the "never state what a card does from memory" invariant
 *  demands — nothing here is recalled.
 *
 *  DELIBERATE OMISSIONS, so the next reader does not "fix" them:
 *  - **storm** — "copy it for each spell cast before it". A copy put onto the stack is NOT cast, so a
 *    `cast` emit would be a wrong sentence rather than a missing one.
 *  - **prowess, exalted** — "gets +1/+1 until end of turn" is a pump EFFECT, not an emitted event.
 *  - **unearth, persist's and undying's RETURN half** — "return this card ... to the battlefield"
 *    would be a second `enters` on top of the card's own implied one, and double-counting a card's
 *    entry is worse than missing its recursion. Their counters are kept; the re-entry is deferred.
 *  - **EVERY "alternative casting cost" keyword** — flashback, escape, foretell, bestow, evoke,
 *    rebound, mutate, warp, kicker, convoke, flash, morph, disguise, enchant. `impliedEvents` pushes
 *    a `cast` for EVERY nonland card, so a keyword describing another way to cast the same card adds
 *    a second, wider cast rather than a missing one. Flashback ranked second on the keyword gap list
 *    until it was measured: 212 of 212 flashback cards are Instants or Sorceries and every one
 *    already implied its cast, and the corpus holds 0 consumers watching a graveyard-scoped cast.
 *    A supply count cannot see this — count the CONSUMERS.
 *  - **madness** — "If you discard this card, discard it into exile. When you do, cast it for its
 *    madness cost or put it into your graveyard." The card supplies no discard: it is conditional on
 *    YOU discarding it by other means, so madness is a discard CONSUMER. Cycling is the contrast —
 *    it pays its own cost to discard itself.
 *  - **suspend** — "exile it with three time counters on it". Those counters sit on a card in EXILE,
 *    not on a permanent you control, so no counters-matter payoff can see them; a suspended card is
 *    a PROLIFERATE payoff, which is demand rather than supply. Caught on its witness: the only
 *    consumer it reached was Regenerations Restored, whose trigger is its own time counters. */
interface EmitSpec { verb: GameEvent["verb"]; counter?: string; control?: "you" | "opp"; token?: true; self?: true }

const KEYWORD_EMITS: Record<string, EmitSpec[]> = {
  // "Damage dealt by this creature also causes you to gain that much life."
  lifelink: [{ verb: "gain-life" }],
  // "each opponent loses 1 life and you gain that much life."
  extort: [{ verb: "gain-life" }, { verb: "lose-life", control: "opp" }],
  // "Whenever this creature becomes blocked, defending player loses 4 life."
  afflict: [{ verb: "lose-life", control: "opp" }],
  // "defending player sacrifices two permanents of their choice."
  annihilator: [{ verb: "sacrifice", control: "opp" }],
  // "you may sacrifice any number of creatures. It enters with three times that many +1/+1 counters"
  devour: [{ verb: "sacrifice" }, { verb: "counter-added", counter: "+1/+1" }],
  // "exile a nonland card that costs less. You may cast it without paying its mana cost."
  cascade: [{ verb: "cast" }],
  // Every one of these says +1/+1 in its own reminder.
  modular: [{ verb: "counter-added", counter: "+1/+1" }],
  evolve: [{ verb: "counter-added", counter: "+1/+1" }],
  mentor: [{ verb: "counter-added", counter: "+1/+1" }],
  training: [{ verb: "counter-added", counter: "+1/+1" }],
  graft: [{ verb: "counter-added", counter: "+1/+1" }],
  riot: [{ verb: "counter-added", counter: "+1/+1" }],
  bloodthirst: [{ verb: "counter-added", counter: "+1/+1" }],
  undying: [{ verb: "counter-added", counter: "+1/+1" }],
  // "return it to the battlefield ... with a -1/-1 counter on it."
  persist: [{ verb: "counter-added", counter: "-1/-1" }],
  // "damage to creatures in the form of -1/-1 counters and to players in the form of poison counters"
  infect: [{ verb: "counter-added", counter: "-1/-1" }, { verb: "counter-added", counter: "poison" }],
  // "Players dealt combat damage by this creature also get three poison counters."
  toxic: [{ verb: "counter-added", counter: "poison" }],
  // "Put a +1/+1 counter on an Army you control. ... create a 0/0 black Zombie Army creature token"
  amass: [{ verb: "counter-added", counter: "+1/+1" }, { verb: "create-token", token: true },
          { verb: "enters", token: true }],
  // "put two +1/+1 counters on it OR create two 1/1 colorless Servo artifact creature tokens."
  fabricate: [{ verb: "counter-added", counter: "+1/+1" }, { verb: "create-token", token: true },
              { verb: "enters", token: true }],
  // "Create a token that's a copy of it, except it's a white Zombie ... with no mana cost."
  embalm: [{ verb: "create-token", token: true }, { verb: "enters", token: true }],
  eternalize: [{ verb: "create-token", token: true }, { verb: "enters", token: true }],
  // "To populate, create a token that's a copy of a creature token you control."
  populate: [{ verb: "create-token", token: true }, { verb: "enters", token: true }],
  // "you may create a token copy that's tapped and attacking that player"
  myriad: [{ verb: "create-token", token: true }, { verb: "enters", token: true }],
  // "Cycling {3} ({3}, Discard this card: Draw a card.)" — the largest single keyword gap in the
  // corpus at 393 printed cards, of which only 3 of the 33 present in the derived corpus emitted a
  // `draw`. The discard also reaches recursion payoffs, via `impliedGraveyardEvents`.
  cycling: [{ verb: "discard", self: true }, { verb: "draw" }],
  // "Plainscycling {2} ({2}, Discard this card: Search your library for a Plains card, reveal it,
  // put it into your hand, then shuffle.)" — the discard is shared with plain cycling, the draw is
  // NOT. A library search is no emitted event, so the discard is all of it. See `keywordEvents` for
  // why this entry has to SUPPRESS the umbrella rather than merely sit beside it.
  typecycling: [{ verb: "discard", self: true }],
  // "At the beginning of your upkeep, put an age counter on this permanent, then sacrifice it unless
  // you pay its upkeep cost for each age counter on it." The sacrifice is the card's OWN, and it is
  // supply rather than drawback: the aura-drawback gate in `derive.ts` is keyed on `leaves` — a
  // permanent undoing what it did as it departs — and this fires on UPKEEP. A body dying on a clock
  // is the aristocrats shape, and `dies` is what 139 corpus consumers watch against 22 on
  // `sacrifice`, so both are emitted exactly as an authored sacrifice action emits both.
  "cumulative upkeep": [{ verb: "counter-added", counter: "age", self: true },
    { verb: "sacrifice", self: true }, { verb: "dies", self: true }],
  // "At the beginning of your upkeep, if this came under your control since the beginning of your
  // last upkeep, sacrifice it unless you pay its echo cost." Same shape, same reasoning.
  echo: [{ verb: "sacrifice", self: true }, { verb: "dies", self: true }],
  // "Tap another creature you control: Put charge counters equal to its power on this Spacecraft."
  // The tap of the OTHER creature is real supply too, but 4 corpus consumers watch `taps` against
  // 17 on `counter-added`, and the spec shape here cannot say "another creature you control".
  station: [{ verb: "counter-added", counter: "charge", self: true }],
};

/** What a printed keyword WATCHES. `KEYWORD_EMITS` above is the supply half and has been rich for a
 *  while; the demand half had no path at all, which is the structural miss the Fable review's item 6
 *  names — a keyword whose reminder text is a TRIGGERED ability derives no trigger, because
 *  `segment.ts` makes a keyword line inert and reminder text with it.
 *
 *  MEASURED BEFORE BUILDING, and the named card is not the win. Extort is 17 corpus cards / 3
 *  derived / 3 with no trigger at all, and its reminder is "**Whenever you cast a spell**, you may
 *  pay {W/B}" — UNNARROWED, so `castSelfSupplied` refuses every implied producer on purpose and
 *  extort can only ever be fed by an AUTHORED cast emit. It is here because it is correct and
 *  because the review asked for it, not because it moves the population. PROWESS is the member that
 *  pays: "whenever you cast a **noncreature** spell" narrows, so the gate lets it through, and it is
 *  87 corpus cards against extort's 17.
 *
 *  REFUSED, with the reason, so the next reader does not add it:
 *  - **evolve** — "whenever a creature you control enters, **if that creature has greater power or
 *    toughness than this creature**". The condition is an intervening if (CR 603.4) comparing the
 *    entering creature against the CONSUMER's own stats, which `SubjectFilter.stats` cannot express.
 *    Recording the trigger without it claims every creature in the deck, which is knowingly adding
 *    the defect `bin/intervening-if-audit.ts` was built to count. Its counter EMIT is already
 *    supplied above; only the demand half is refused.
 *  - **every attack- and block-triggered keyword** (exalted, battle cry, mentor, melee, annihilator,
 *    training, dethrone, bushido, renown, ingest, afflict, flanking) — each watches ITS OWN attack or
 *    block, so no other card supplies it, and `combatSelfSupplied` refuses the unnarrowed combat
 *    baseline anyway. Their EFFECTS are already emitted above where they carry one.
 *  - **cascade, undying, persist, haunt** — all self-triggered ("when you cast THIS spell", "when
 *    THIS creature dies"), so a consumer trigger has nothing to receive.
 *
 *  Subjects are parsed from the printed reminder wording with the SAME `parseSubject` the clause
 *  layer uses, so a keyword-supplied trigger and an authored one are the same shape — and, for
 *  prowess, so that "noncreature spell" resolves to the type list `castConsumerNarrows` reads. */
const KEYWORD_TRIGGERS: Record<string, { verbs: GameEvent["verb"][]; subject: string; kind: string }> = {
  // "Extort (Whenever you cast a spell, you may pay {W/B}. If you do, each opponent loses 1 life and
  // you gain that much life.)"
  extort: { verbs: ["cast"], subject: "a spell", kind: "drain" },
  // "Prowess (Whenever you cast a noncreature spell, this creature gets +1/+1 until end of turn.)"
  prowess: { verbs: ["cast"], subject: "a noncreature spell", kind: "pump" },
};

/** The triggered abilities a card's printed keywords give it, in the shape `directedReasons` already
 *  reads. Not merged into `CardTags.abilities`: those are DERIVED and stored, and this is a matcher
 *  fact about a printed characteristic — the same split `keywordEvents` observes.
 *
 *  CEILING, stated: only edge formation sees these. Theme, archetype and mechanism detection read
 *  `tags.abilities` directly, so a prowess creature still does not count toward a spellslinger theme.
 *  `keywordEvents` has the identical ceiling and has since it shipped. */
export function keywordAbilities(chars: Characteristics): Ability[] {
  const out: Ability[] = [];
  for (const raw of chars.keywords ?? []) {
    const whole = String(raw).toLowerCase().trim();
    const spec = KEYWORD_TRIGGERS[whole] ?? KEYWORD_TRIGGERS[whole.split(/[\s{]/)[0]];
    if (!spec) continue;
    out.push({
      kind: "triggered",
      trigger: { verbs: spec.verbs, subject: parseSubject(spec.subject) },
      effect: { kind: spec.kind as Ability["effect"]["kind"] },
    });
  }
  return out;
}

/** The events a card's PRINTED KEYWORDS supply. Marked `implied: true` like every other synthetic
 *  event, so the self-supply gates in edges.ts treat them as baseline rather than authored surplus. */
export function keywordEvents(chars: Characteristics): GameEvent[] {
  const out: GameEvent[] = [];
  // Keywords arrive with their argument attached ("Ward {2}", "Annihilator 2", "Protection from
  // Demons"), so match on the FIRST word — the same shape `isKeywordLine` uses in the segmenter.
  // The WHOLE keyword first, so two-word entries ("cumulative upkeep") are reachable at all — the
  // first word alone would key them as "cumulative", and "basic landcycling" as "basic".
  const keys = (chars.keywords ?? []).map((raw) => {
    const whole = String(raw).toLowerCase().trim();
    return whole in KEYWORD_EMITS ? whole : whole.split(/[\s{]/)[0];
  });
  // ONE KEYWORD NARROWS ANOTHER, so the map alone cannot decide this. Scryfall stamps the umbrella
  // `Cycling` on every typecycling card as well as its specific name, but their printed reminder
  // SEARCHES the library where plain cycling draws — Eternal Dragon carries Plainscycling,
  // Landcycling, Typecycling and Cycling at once. 90 of the 393 printed cycling cards are this
  // shape, so honouring the umbrella too would hand every one of them a draw it does not have.
  const emitKeys = keys.includes("typecycling") ? keys.filter((k) => k !== "cycling") : keys;
  for (const k of emitKeys) for (const spec of KEYWORD_EMITS[k] ?? []) out.push(syntheticEvent(chars, spec));
  return out;
}

/** One synthetic producer event from a spec, shared by the keyword and Saga channels. */
function syntheticEvent(chars: Characteristics, spec: EmitSpec): GameEvent {
  return {
    verb: spec.verb,
    subject: {
      control: spec.control ?? "you",
      token: spec.token ?? null,
      ...(spec.counter ? { counter: spec.counter } : {}),
      // A SELF event happens to a KNOWN permanent — this one — so it carries this card's printed
      // identity rather than staying untyped. Left untyped it wildcards onto typed consumers:
      // Mystic Remora's age counter goes on an ENCHANTMENT and was reaching Fathom Mage's
      // `counter-added:creature`, and cycling's discard reached typed graveyard recursion. Same
      // fact `selfSubject` states for a card's own cast/enters, so it is reused rather than
      // rebuilt — `counter` is overlaid after, since a counter is board state and not printed.
      ...(spec.self ? { ...selfSubject(chars), self: true as const,
        ...(spec.counter ? { counter: spec.counter } : {}) } : {}),
      // A token this card makes is a creature it did not print on its own type line, so the
      // subject says only what the reminder guarantees: it is a token, and it is a creature.
      ...(spec.token ? { type: "creature" } : {}),
    },
    implied: true,
  };
}

/** WHAT A SAGA'S OWN TYPE SUPPLIES: its death. CR 704.5s puts a Saga with lore counters at or past
 *  its final chapter number into its owner's graveyard — a state-based action, so NO ability states
 *  it and derivation, which reads oracle text, cannot see it. That makes a Saga a *guaranteed*
 *  future death, better evidence than most authored sacrifice outlets, that fed nothing.
 *
 *  Measured on the corpus before writing this: 234 Sagas, of which **17 sit in the derived corpus
 *  and only 3 emitted any death verb**, against 31 death-watching consumer abilities an enchantment
 *  could satisfy, spread over 12 of the 25 calibration decks that run a self-sacrificing Saga.
 *
 *  `sacrifice` AND `dies`, exactly as `echo` and `cumulative upkeep` emit them — a permanent dying
 *  on a clock is the aristocrats shape, and `dies` is what most corpus consumers watch. The
 *  graveyard fill follows for free: `normalizeZoneEvent` turns `dies` into `leaves@battlefield` and
 *  `impliedGraveyardEvents` into `enters@graveyard`, with `selfFillTypes` stamping the printed types.
 *
 *  A TRANSFORMING Saga is EXILED and returned transformed — it never reaches a graveyard, so it must
 *  get no death event. The matcher sees `Characteristics` and never oracle text, so the discriminator
 *  is the type line, and it was measured rather than assumed: across all 234 corpus Sagas,
 *  multi-face ⟺ says "transform" is EXACT (44 of 44), and single-face ⟺ states its own sacrifice
 *  holds for 186 of 190.
 *
 *  ponytail: the 4 single-face exceptions are read as dying. Three of them really do die — The Legend
 *  of Arena, The Many Deeds of Belzenlok and Saga of Krark Losing His Thumb simply print no
 *  "Sacrifice after" reminder, and 704.5s applies to them regardless. The one genuine miss is **The
 *  Aesir Escape Valhalla**, whose chapter III returns itself to its owner's HAND; it is not in the
 *  derived corpus today. Reading oracle text here would fix it — and would mean threading text into a
 *  layer whose whole input is characteristics, for one card. */
export function sagaEvents(chars: Characteristics): GameEvent[] {
  if (!chars.subtypes.some((t) => t.toLowerCase() === "saga")) return [];
  if (chars.faces) return [];
  return [{ verb: "sacrifice" as const, self: true as const }, { verb: "dies" as const, self: true as const }]
    .map((spec) => syntheticEvent(chars, spec));
}

/** Graveyard-fill events implied by a producer's (already-normalized) emits: mill/discard put an
 *  untyped card into a graveyard; a nontoken leaving the battlefield (a normalized `dies`) also
 *  enters the graveyard carrying its type. Tokens cease to exist, so they add no graveyard card. */
export function impliedGraveyardEvents(emits: GameEvent[]): GameEvent[] {
  const out: GameEvent[] = [];
  for (const e of emits) {
    if (e.verb === "mill" || e.verb === "discard") {
      // Note: this (and authored token-generation emit subjects) carry no power/toughness/manaValue — a stats-conditioned consumer can't distinguish token/creature sizes here (Slice-1 limitation, not a bug).
      //
      // `self` is the one thing carried through, because it changes what the fill IS. A discard
      // normally takes an unknown card out of your hand, so an untyped fill is the honest answer and
      // `graveyardFillMatches` wildcards it onto any typed recursion consumer on purpose. A card
      // discarding ITSELF is not unknown — cycling is 303 corpus cards of exactly that shape, plus 9
      // authored self-discards — and `selfFillTypes` downstream stamps its printed types on. Left
      // untyped, Deceptive Landscape (a Land) "enabled" World Breaker returning World Breaker.
      // Mill is never marked self and is left alone: a milled card's type really is unknown.
      out.push({ verb: "enters", subject: {
        control: e.subject.control, token: null, zone: "graveyard",
        ...(e.subject.self === true ? { self: true } : {}),
      } });
    } else if (e.verb === "leaves" && e.subject.zone === "battlefield" && e.subject.token !== true) {
      out.push({ verb: "enters", subject: { ...e.subject, zone: "graveyard" } });
    }
  }
  return out;
}

/** Stamp the card's OWN printed types onto a graveyard fill that is the card itself.
 *
 *  `graveyardFillMatches` wildcards an UNTYPED fill onto any typed recursion consumer, and that is
 *  deliberate: a milled card's type is genuinely unknown. But a card sacrificing ITSELF is not
 *  unknown — Myriad Landscape, Buried Ruin and Inventors' Fair all record the object as a bare
 *  "this", so the fill arrived untyped and a LAND hitting the graveyard "supplied" Bloodline
 *  Necromancer's Vampire recursion and Archaeomancer's instant recursion.
 *
 *  Only fills already marked `self` are touched, and only where the fill states no type of its own. */
/** WHAT A MULTI-FACE CARD IS *IN A ZONE*, which is not the union `types` holds and not always the
 *  same as what it can be PLAYED as. Three Comprehensive Rules, three answers, and the layout is the
 *  only thing that separates them — `faces` cannot, because split and adventure both list every face:
 *
 *   - **709.4 SPLIT** — "a split card has the combined characteristics of its two halves" in every
 *     zone but the stack. The union is already right; these are left alone.
 *   - **715.4 ADVENTURE / 720.4 OMEN** — "in every zone except the stack, and while on the stack not
 *     as an Adventure, an adventurer card has only its NORMAL characteristics". Brazen Borrower in a
 *     graveyard is a Creature and NOT an Instant.
 *   - **712.4a DOUBLE-FACED** — a transforming or modal DFC has its FRONT face's characteristics
 *     everywhere but the battlefield. Valakut Awakening // Valakut Stoneforge in a graveyard is an
 *     Instant, not a land — which matters directly to the graveyard-scaling work, since Cavalier of
 *     Flame counts LAND cards in your graveyard.
 *
 *  So the rule is: the front face, unless the layout is a split. A card with no `faces` is its own
 *  one face and the union already says everything. */
const UNIONS_IN_ZONE = new Set(["split"]);

export function zoneTypes(chars: Characteristics): { types: string[]; subtypes: string[] } {
  const front = chars.faces?.[0];
  if (!front || (chars.layout && UNIONS_IN_ZONE.has(chars.layout))) {
    return { types: chars.types, subtypes: chars.subtypes };
  }
  return { types: front.types, subtypes: front.subtypes };
}

export function selfFillTypes(events: GameEvent[], chars: Characteristics): GameEvent[] {
  return events.map((e) => {
    if (!(e.verb === "enters" && e.subject.zone === "graveyard" && e.subject.self === true)) return e;
    // SUPERTYPE FLAGS ARE STAMPED EVEN WHEN A TYPE IS ALREADY STATED, and the early return below is
    // why they had to be. `self` means the object IS this card, so its printed supertypes are known
    // facts about the event whatever noun the clause used for it — and a card that says "sacrifice
    // THIS CREATURE" arrives here with `type: creature` already set and used to skip out with no
    // flags at all. Measured 2026-08-20: **Burnished Hart is an Artifact Creature** whose own
    // ability sacrifices it as a creature, so it really does put an artifact — a historic card — in
    // the graveyard, and The Capitoline Triad could not see it. Same for Otawara (Legendary Land,
    // channelled), Boromir and Sojourner's Companion.
    const own = zoneTypes(chars);
    const ownTypes = own.types.map((t) => t.toLowerCase());
    const ownSubtypes = own.subtypes.map((t) => t.toLowerCase());
    const flags: Partial<SubjectFilter> = {
      ...(isHistoric(ownTypes, ownSubtypes) ? { historic: true as const } : {}),
      ...(isOutlaw(ownSubtypes) ? { outlaw: true as const } : {}),
    };
    if (e.subject.type !== undefined || e.subject.subtype !== undefined) {
      return Object.keys(flags).length ? { ...e, subject: { ...e.subject, ...flags } } : e;
    }
    // A GRAVEYARD IS A ZONE, so the card there is its front face and not the union of its faces —
    // see `zoneTypes`. Without this an adventurer's fill advertised its Instant half, and
    // Marang River Regent // Coil and Catch "enabled" Archaeomancer returning an instant.
    const zone = zoneTypes(chars);
    const types = zone.types.map((t) => t.toLowerCase());
    const subtypes = zone.subtypes.map((t) => t.toLowerCase());
    return { ...e, subject: {
      ...e.subject,
      ...flags,
      ...(types.length ? { type: types } : {}),
      ...(subtypes.length ? { subtype: subtypes } : {}),
    } };
  });
}

/** The counter-added event a proliferate implies: proliferate gives each chosen permanent another
 *  counter of each kind already there, so it adds counters of an UNKNOWN, board-state-dependent kind
 *  — an untyped counter-added (no `counter`, no type) that a permissive matcher wildcards onto any
 *  counter-matters payoff. control:"you" (you choose what to proliferate). Only `proliferate` implies
 *  it; all other verbs contribute nothing. */
export function impliedCounterEvents(emits: GameEvent[]): GameEvent[] {
  const out: GameEvent[] = [];
  for (const e of emits) {
    if (e.verb === "proliferate") {
      out.push({ verb: "counter-added", subject: { control: e.subject.control, token: null } });
    }
  }
  return out;
}

/** WHAT A PROLIFERATE ASKS FOR. `impliedCounterEvents` above is the supply half and has shipped
 *  since proliferate became a first-class event; the demand half had no path at all, so Radstorm
 *  ("Proliferate.") and Virulent Silencer ("that player gets two poison counters") were two
 *  PRODUCERS with nothing between them — spec 26.3's "proliferate -> poison counters" miss, still
 *  open when it was re-measured on 2026-08-28.
 *
 *  Proliferate gives each chosen permanent and player another counter of each kind ALREADY THERE
 *  (CR 701.29), so a board with no counter on it makes the card do nothing. That is a demand for a
 *  counter SOURCE, and it is the same shape `keywordAbilities` gives a printed keyword: a synthetic
 *  triggered ability in the form `directedReasons` already reads.
 *
 *  MEASURED BEFORE BUILDING: 24 derived cards emit `proliferate` (102 print the word corpus-wide),
 *  they sit in 14 of the 71 decks, and the (proliferate x counter-source) pairs across those decks
 *  number 766. Max fan-out per producer is 16 (`venser`), against the mesh cap of 50 — so this
 *  cannot manufacture a mesh, and MESHED holding at 332 is the acceptance test.
 *
 *  THE SUBJECT IS DELIBERATELY UNTYPED AND `control: "any"`:
 *   - no counter KIND, because proliferate takes another of EVERY kind already there, so naming one
 *     would refuse the other eleven kinds the corpus emits (time 23, charge 21, stun 14, ...);
 *   - `any`, because a proliferate may choose an OPPONENT's permanent or player and Virulent
 *     Silencer's poison counters are exactly that. On a DEMAND, `any` means "accepts either", which
 *     is what the card says — the reading C6 established when it fixed the SUPPLY side.
 *
 *  ONE ability however many times the card proliferates: the demand is "is there a counter on the
 *  board", which two proliferate abilities do not ask twice. `claimCount` would collapse the
 *  duplicate rows anyway; not minting them is cheaper and says the right thing.
 *
 *  CEILING, the same one `keywordAbilities` carries: only edge formation reads this. Theme,
 *  archetype and mechanism detection read `tags.abilities` directly, so a proliferate card still
 *  does not count as a counter payoff for `cardCaresTags`. */
export function proliferateAbilities(tags: CardTags): Ability[] {
  const proliferates = tags.abilities.some((a) => (a.emits ?? []).some((e) => e.verb === "proliferate"));
  if (!proliferates) return [];
  return [{
    kind: "triggered",
    trigger: { verbs: ["counter-added"], subject: { control: "any", token: null } },
    effect: { kind: "proliferate" },
  }];
}

/** "You may have this creature enter as a copy of any creature on the battlefield" is a replacement
 *  effect on the card's OWN entry (CR 614.1c), which makes every blink, flicker and reanimation in
 *  the deck a way to re-use it — and the card carried no demand for one. Sakashima the Impostor
 *  derives exactly `{kind: "static", effect: {kind: "clone"}}`: no subject, no emit, nothing for a
 *  producer's `enters` to satisfy. Spec 26.3's "flicker + enters-as-copy" miss, re-measured still
 *  open on 2026-08-28.
 *
 *  MATCHED ON THE PRINTED CUE, NOT THE DERIVED KIND, which is the ruling the C4 copy work already
 *  made for this same family: the kinds do not separate it. 31 derived cards print the cue and they
 *  arrive as `static/clone` (27) and `static/copy-spell` (4) indifferently, while `clone` is also
 *  the kind a card gets for copying something else.
 *
 *  ALL 66 CORPUS CARDS PRINTING THE CUE WERE READ, not sampled, and 2 of them are a FALSE POSITIVE
 *  the naive cue would take:
 *   - **Essence of the Wild** — "CREATURES YOU CONTROL enter as a copy of this creature"
 *   - **Infinite Reflection** — "NONTOKEN CREATURES YOU CONTROL enter as a copy of enchanted creature"
 *  Both are replacements applied to OTHER permanents; this card's own entry copies nothing, so a
 *  self demand would be a claim the card does not make. Anchoring on the printed self template
 *  ("you may have <something> enter as a copy", 62 of the 66) refuses both.
 *
 *  IT UNDER-CLAIMS ON TWO, STATED RATHER THAN STRETCHED FOR. The Mimeoplasm says "if you do, IT
 *  enters as a copy" in a second sentence, and The Playful Winners names itself with no "may have".
 *  A cue loose enough to reach them would have to read a bare pronoun, and "it" routinely means a
 *  TOKEN elsewhere in this corpus — a missing edge beats a wrong one.
 *
 *  SCOPED TO ONE SENTENCE (`[^.]*`), so the "you may have" of one ability cannot license a copy
 *  clause in the next. Face-safe for free: `faceDeckCards` gives every face its own `oracleText`,
 *  so Glasspool Shore (the LAND back of Glasspool Mimic) is not handed a clone demand.
 *
 *  WHAT FEEDS IT IS ALREADY GATED. A `self` enters trigger is refused an implied or token producer
 *  by `selfEtbSelfSupplied`, and the self-trigger identity gate in `directedReasons` then requires
 *  the producer's emit to be something this card could BE. So the suppliers are authored, non-token
 *  `enters` emits — the flicker and reanimation class — which is the same channel every self-ETB
 *  creature already draws on. Measured: 17 of the 71 decks hold one, 548 candidate pairs, max
 *  fan-out 16 (`can-i-copy-your-homework`, `everything-is-a-land`) against the mesh cap of 50.
 *
 *  CEILING, the one `keywordAbilities` and `proliferateAbilities` both carry: only edge formation
 *  reads this, so a clone still does not count as a blink payoff for `cardCaresTags`. */
const ENTERS_AS_A_COPY = /\byou may have\b[^.]*\benters? as a copy\b/i;

export function enterAsCopyAbilities(oracleText: string | undefined, chars: Characteristics): Ability[] {
  if (!oracleText || !ENTERS_AS_A_COPY.test(oracleText)) return [];
  return [{
    kind: "triggered",
    // THE CARD'S OWN PRINTED TYPE, so this demand is no wider than the one a self-ETB creature
    // already derives. Left untyped, it was WIDER: Reality Shift's emit is a bare
    // `{verb: "enters", control: "any"}` — the manifest of an unknown top card — and an untyped
    // demand accepted it, 21 rows, while the same emit reaches an ordinary self-ETB creature ZERO
    // times today (verified against the committed tree). A face-down manifested permanent is a 2/2
    // with no abilities (CR 708.2), so its copy replacement does not even apply.
    //
    // TYPE ONLY, NEVER SUBTYPE. A blink emits "a creature you control", which cannot promise a
    // Shapeshifter, so demanding the subtype would refuse the whole flicker class this exists for.
    // `selfSubject` above carries both because it is SUPPLY, where naming more is naming truth.
    trigger: {
      verbs: ["enters"],
      subject: { control: "you", token: null, self: true, type: collapse(chars.types) },
    },
    effect: { kind: "clone" },
  }];
}
