export const SCHEMA_VERSION = 1;

export type Control = "you" | "opp" | "any";

export const STAT_METRICS = ["power", "toughness", "mana-value"] as const;
export const STAT_OPS = ["lte", "gte", "lt", "gt", "eq"] as const;
export type StatMetric = (typeof STAT_METRICS)[number];
export type StatOp = (typeof STAT_OPS)[number];

/** A numeric condition on a subject's stat. Exactly one of `value` (constant rhs, e.g. power ≤ 2)
 *  or `vs` (another metric rhs, e.g. toughness ≥ power) is set. */
export interface StatPredicate {
  metric: StatMetric;
  op: StatOp;
  value?: number;
  vs?: "power" | "toughness";
}

/** A characteristic filter: what a trigger cares about, or what an effect targets/produces. */
export interface SubjectFilter {
  /** A card type, or an array of types meaning OR (e.g. ["instant","sorcery"]). */
  type?: string | string[];
  /** Card types the text NEGATED ("noncreature spell", "nonland permanent"), as the card says it.
   *
   *  `type` carries the RESOLVED list this negation leaves, and that is what the matcher tests —
   *  `expandTypes` unions a subject's type tokens, so a `noncreature` token living in `type` would
   *  read wider than either word. This field is the authored fact alongside it: the tag key and the
   *  reason prose come from here, because "an artifact being cast" is a false sentence about an
   *  instant, and grouping noncreature-spell payoffs under `cast:artifact` puts them on the wrong
   *  theme axis. Set only when the negation actually narrowed something. */
  notType?: string[];
  /** SUBTYPES the text negated — "target **non-Dragon** creature card", "each non-Zombie creature".
   *
   *  `notType` cannot carry these: it holds CARD TYPES and is tested through `expandTypes`, so a
   *  negated Dragon would either be dropped or read as a negated card type. Measured 2026-08-20:
   *  **65 distinct subtypes are negated across 247 corpus cards, 14 of them in the derived corpus**
   *  — non-Human, non-Zombie, non-Dragon, non-Angel, non-Sliver and 60 more.
   *
   *  The witness is Junji, the Midnight Sky returning "target non-Dragon creature card": without
   *  this it claimed to reanimate **Hidetsugu and Kairi, a Legendary Creature — Ogre Demon Dragon**,
   *  which is precisely the card the text excludes. It is also the slot CR 700.16 `worthy` needs
   *  ("legendary, ISN'T A VILLAIN, and is red and/or white"), so one field serves both. */
  notSubtype?: string[];
  /** THE OBJECT ARRIVED WITHOUT BEING CAST OR PLAYED — a blink, a token, a reanimation.
   *
   *  CR 603.4's intervening if is refused as a general slot (241 distinct conditions), but this one
   *  shape is a PROPERTY OF THE EVENT the producer supplies, so it narrows which producer satisfies
   *  the trigger rather than needing to be evaluated. Satoru, the Infiltrator — "whenever Satoru
   *  and/or one or more other nontoken creatures you control enter, IF NONE OF THEM WERE CAST OR NO
   *  MANA WAS SPENT to cast them" — claimed every creature in the deck without it, and Deep Gnome
   *  Terramancer wants lands entering "WITHOUT BEING PLAYED".
   *
   *  Answered on the producer side by INFERENCE, never a second field: a token creation or an entry
   *  from a stated zone (put/return from a graveyard, exile, library or hand) arrived without being
   *  cast, while a card's own implied entry is the cast. Measured: 644 of 748 derived `enters` emits
   *  are one of the two. */
  notCast?: true;
  /** THE OBJECT ARRIVED TAPPED. Two cards demand it — Amulet of Vigor and Tiller Engine — and both
   *  read "whenever a permanent you control ENTERS TAPPED". Set on both sides from the same printed
   *  cue `ARRIVES_TAPPED` already uses to suppress a phantom `taps` event. */
  entersTapped?: true;
  /** The umbrella noun a multi-umbrella `type` list was resolved FROM — "permanent" for
   *  "permanent spell".
   *
   *  The same fact `notType` records, for the same reason. Two umbrella nouns narrow one another
   *  ("a permanent spell" is a spell that is also a permanent), so `type` carries their concrete
   *  INTERSECTION — a token list would be ORed by `expandTypes` back into every card type. But then
   *  keying on the first of those five types renders "cast:creature" to a user about Hylda's Crown
   *  of Winter, an Artifact. This keeps the tag reading `cast:permanent`. Set only where an
   *  intersection actually happened: a lone umbrella is already its own name. */
  umbrella?: string;
  /** Card types the subject demands ALL of — a compound noun, "artifact creature".
   *
   *  `type` cannot carry this: an array there means OR, which is what "target artifact or
   *  enchantment" needs. Without a separate field "other artifact creatures you control" derived
   *  `["creature","artifact"]` and Sol Ring satisfied Master of Etherium's anthem. The mirror of
   *  `notType`: `type` says what MAY satisfy the subject, `allTypes` and `notType` refine it. */
  allTypes?: string[];
  /** A subtype, or an array meaning OR (e.g. ["faerie","wizard"]). */
  subtype?: string | string[];
  colors?: string[];
  /** The subject IS the card whose ability this is ("when THIS creature enters", or the card named
   *  by its own name). Set by derivation from the clause text, which is the only layer that can see
   *  it: parseSubject reduces "this creature" and "another creature you control" to the same
   *  {type: creature}, so without this the matcher cannot tell a self-ETB from a real payoff -- the
   *  defect behind 74% of the false edges in the 2026-08-05 precision measurement. */
  self?: true;
  control: Control;
  /** false = nontoken only, true = token only, null = any. */
  token: boolean | null;
  /** Marks "the chosen type" (Kindred Discovery); resolved deck-aware in Stage 2. */
  chosenType?: boolean;
  /** "Historic" — artifact, legendary, or Saga. A printed fact, not a judgment, and the only way the
   *  engine can hear Jhoira, Basim Ibn Ishaq, Glóin, Rona and The Sixth Doctor narrow their cast
   *  trigger. Without it their subject is the bare umbrella `spell` and every card in the deck
   *  satisfies it. Set on a CONSUMER by `parseSubject`, and on a PRODUCER by the matcher, which reads
   *  it off the printed type line. */
  historic?: true;
  /** The subject demands an OUTLAW — CR 700.12, an object with the Assassin, Mercenary, Pirate,
   *  Rogue and/or Warlock creature type. A printed fact read off the type line, exactly like
   *  `historic`, and set on BOTH sides for the reason 09ce98d records: a consumer demand a producer
   *  cannot state is a demand nothing satisfies.
   *
   *  20 corpus cards, ZERO of them in the derived corpus today. Added as VOCABULARY insurance rather
   *  than for current demand — the subject is parsed at derive time and derivation is free, but a
   *  subject the parser cannot see reads WIDER than printed, and "other outlaws you control have
   *  haste" (Vihaan, Hellspur Posse Boss) would anthem every creature the way Favorable Winds did
   *  before `keyword` existed. */
  outlaw?: true;
  /** The subject demands a MODIFIED permanent — CR 700.9: it has a counter on it, is equipped, or is
   *  enchanted by an Aura its controller controls.
   *
   *  A BOARD STATE, NEVER A PRINTED CHARACTERISTIC — the same class as `counter`, whose arrival broke
   *  three identity gates that were comparing it against a type line. So this is set on a CONSUMER by
   *  `parseSubject` and on a PRODUCER only where the printed card really does say it: a permanent
   *  that ENTERS WITH COUNTERS ON ITSELF is modified from the moment it arrives, and nothing else on
   *  a type line can tell.
   *
   *  44 corpus cards, 40 with a "modified <noun>" subject, 2 in the derived corpus. It NARROWS:
   *  Kodama of the West Tree says "whenever a MODIFIED creature you control deals combat damage" and
   *  derives a subject of every creature you control. */
  modified?: true;
  /** The subject demands the LEGENDARY supertype. "Legendary creatures you control get +2/+2"
   *  (Serah Farron) and Jodah's +X/+X derived a subject of EVERY creature without it, which were the
   *  two widest meshes in the derived population at x53 and x51. Shaped exactly like `historic`:
   *  matched against the card's printed characteristics, which already carry supertypes. */
  legendary?: true;
  /** The subject demands the BASIC supertype. "Search your library for a basic land card" emitted
   *  `{type: land}` and nothing else, so at the authored-emit identity check — the one place an emit
   *  sits on the FILTER side — every NONBASIC land satisfied it, which was about half the false
   *  edges the 2026-08-13 board fixtures showed on self-ETB lands. 65 actions across 50 corpus docs.
   *  Same shape as `legendary`, and set on BOTH sides for the reason 09ce98d records. */
  basic?: true;
  /** Printed KEYWORD ABILITIES the subject demands, ALL of them — "creatures you control with
   *  flying", "a creature with defender", "spells with flash you cast".
   *
   *  A keyword is not a type, a subtype or a supertype, so nothing else here could carry it and the
   *  narrowing was simply DROPPED: Favorable Winds' "creatures you control with flying get +1/+1"
   *  derived `{type: creature, scope: all}` and anthemed every creature in the deck, exactly the
   *  over-wide subject `legendary` had before 09ce98d. Measured on the corpus: 1,836 cards print a
   *  keyword-narrowed subject, 108 of them inside the derived corpus.
   *
   *  ALL-of rather than OR because that is what the corpus prints: of the keyword-narrowed subjects
   *  in the derived corpus, 97 name one keyword and 17 join two with "and" — "a 1/1 Bird with flying
   *  and vigilance" has both. NOT ONE says "or", so a disjunction would be machinery for a shape no
   *  card uses; `anyOf` is there if one ever prints.
   *
   *  Set on BOTH sides — `characteristicsSubject` and `selfSubject` read the printed `keywords`
   *  array — for the reason 09ce98d records: a one-sided cut leaves consumers demanding something no
   *  producer can advertise, which deletes real edges instead of narrowing false ones. */
  keyword?: string[];
  /** Keyword abilities the subject demands the card does NOT have — "a creature you control without
   *  flying". The `notType` shape, for keywords: `keyword` says what must be there, this says what
   *  must not, and a subject can carry both.
   *
   *  Without it the narrowing vanished and the subject derived WIDER than printed: Luminous
   *  Broodmoth's "whenever a creature you control without flying dies, return it to the battlefield"
   *  derived as bare `{type: creature, control: you}` and claimed every FLYING creature in the deck
   *  too — 7 false reasons the moment a named producer arrived (Saga deaths, 2026-08-15).
   *
   *  SMALL AND REAL, measured before the slot was added: 238 corpus matches over 233 cards, but 69
   *  are a keyword's OWN reminder text ("deals combat damage before creatures without first strike"),
   *  67 removal/target and 25 "can't" restrictions. **18 are trigger subjects and exactly 1 is in the
   *  derived corpus.** Ranked by printed cards this looks like a 233-card family; counting consumers
   *  it is Broodmoth plus Crimson Roc, Circle of Flame and Barbed Foliage.
   *
   *  An ABSENT producer `keyword` list satisfies it, which is correct rather than lenient: printed
   *  keywords arrive free on every card, so "no keywords recorded" really is "has no keywords". */
  notKeyword?: string[];
  /** The subject demands a COMMANDER — "a commander you control", "your commander".
   *
   *  UNLIKE every other qualifier here, this is a DECK fact and not a printed one. The same card is
   *  a commander in one list and an ordinary creature in another, so `parseSubject` sets it on the
   *  CONSUMER side from the clause text, and the PRODUCER side is stamped per deck by
   *  `markCommanders` (matcher/commander.ts) — the shape `resolveChosenTypes` already uses for the
   *  other deck-aware fact.
   *
   *  Found by sweeping CR 903 in an engine that analyses the Commander format and had never read it.
   *  206 corpus cards / 35 derived name a commander as a subject. Kediss, Emberclaw Familiar prints
   *  "Whenever a commander you control deals combat damage to an opponent" and derived
   *  `{control: "you", token: null}` — no type at all, so it matched ANY combat damage from anything
   *  you control.
   *
   *  NO `type: creature` alongside: CR 903.3 lets a commander be a legendary creature, a VEHICLE, or
   *  a Spacecraft with power/toughness, so stamping `creature` would narrow past what the rules say.
   *  `commander` is the tighter filter anyway — it reaches one or two cards in a deck. */
  commander?: true;
  /** A real DISJUNCTION: the subject is satisfied by ANY of these branches.
   *
   *  `type` is an OR-list and `subtype` is an OR-list, but the two are ANDed with each other, so
   *  "another creature or Vehicle you control" (Prowl) and "an artifact or Dragon card" (Magda)
   *  could not be said at all — they cross the slot boundary. Branches hold only the DIFFERING
   *  type/subtype; everything shared ("you control") stays on the outer subject and binds all of
   *  them. Match = the outer subject matches AND some branch matches.
   *
   *  PARTIAL by construction: a branch carries only what DIFFERS. The matcher merges the outer
   *  subject into each branch before testing, so `control` and `token` arrive from there. */
  anyOf?: Partial<SubjectFilter>[];
  /** A CARD NAME the subject demands, lowercased — "a card named TARDIS", "creatures named Rat
   *  Colony". No other slot can hold it: a name is not a type, a subtype or a supertype. Mostly a
   *  singleton pointer in EDH, but 13 corpus cards say "a deck can have any number of cards named
   *  ..." and all 13 count their own name, which is an archetype the engine could not see at all. */
  named?: string;
  /** Counter kind for `counter-added` events, e.g. "+1/+1", "-1/-1", "loyalty". */
  counter?: string;
  /** Which phase or step an `extra-phase` effect grants, over a closed CR vocabulary: `untap`,
   *  `upkeep`, `draw`, `main`, `combat`, `beginning`, `end`. Same shape as `counter` above, and for
   *  the same reason: a coarse `extra-phase` conflated units the game itself keeps apart -- an
   *  additional BEGINNING phase brings an untap step and is activation supply, while an additional
   *  UPKEEP or END step brings none, and only recording which one lets a downstream weighting layer
   *  tell them apart. Owner's ruling, 2026-08-14 (threshold-lines spec §4.3). Unset when the card's
   *  text names no phase from the closed list -- refused, never defaulted. `combat` is listed for
   *  the vocabulary's completeness but never actually appears here: a card whose text names a combat
   *  phase derives the separate `extra-combat` kind instead, which carries no `phase` field at all. */
  phase?: string;
  /** Zone the subject lives in; omitted means battlefield. E.g. "graveyard", "hand", "exile". */
  zone?: string;
  /** Zone the subject came FROM, when the text names one: "casts a spell from a graveyard" (River
   *  Kelpie), "casts a legendary spell from your hand" (Jodah), "enters from a graveyard".
   *
   *  Separate from `zone`, which says where the subject LIVES. The two cannot share a field:
   *  `normalizeZoneEvent` stamps zone "battlefield" onto every `enters` event, so an origin stored
   *  there would be overwritten — and on the producer side `zone: "graveyard"` on an `enters` means
   *  a graveyard FILL, which `graveyardFillMatches` reads. Unset means any origin, so the constraint
   *  is opt-in and a producer that never records one keeps every edge it has today. */
  fromZone?: string;
  /** Quantifier the text used for this subject. "target creature" is spot removal, "each creature
   *  your opponents control" is a board wipe, and "creatures you control" is an anthem rather than
   *  a pump — a distinction `SubjectFilter` could not previously express at all. Optional and
   *  additive: no consumer reads it yet (the wipe-vs-spot call still happens in matcher's
   *  `build.ts` via BOARD_WIPE_RE against raw oracle text). Derived now because the clause text is
   *  in hand, so asking the question later costs a re-derive rather than a re-grind. */
  scope?: "target" | "each" | "all";
  /** Authored numeric conditions; ALL must hold (ANDed with the rest of the subject). */
  stats?: StatPredicate[];
  /** Concrete stat values the MATCHER attaches to a producer subject (never authored by the LLM).
   *  Non-numeric printed stats (*, X, null) are stored as 0. */
  power?: number;
  toughness?: number;
  manaValue?: number;
}

export type Verb =
  | "enters"
  | "enters-graveyard"
  | "dies"
  | "leaves"
  | "cast"
  | "attacks"
  | "taps"
  | "non-combat-damage"
  | "combat-damage"
  | "draw"
  | "discard"
  | "mill"
  | "gain-life"
  | "lose-life"
  | "sacrifice"
  | "create-token"
  | "counter-added"
  | "land-play"
  | "untaps"
  | "proliferate"
  | "upkeep"
  | "begin-combat"
  | "end-step"
  | "dice-rolled";

export const VERB_VOCAB: readonly Verb[] = [
  "enters",
  "enters-graveyard",
  "dies",
  "leaves",
  "cast",
  "attacks",
  "taps",
  "non-combat-damage",
  "combat-damage",
  "draw",
  "discard",
  "mill",
  "gain-life",
  "lose-life",
  "sacrifice",
  "create-token",
  "counter-added",
  "land-play",
  "untaps",
  "proliferate",
  // Phase/step triggers. Without these the vocabulary had nowhere to put "at the beginning of your
  // upkeep", so those abilities were tagged with the nearest available verb — a 46-card audit found
  // Nut Collector, Sen Triplets and Crystalline Giant all recorded as `enters`, which does not just
  // lose the timing, it forms FALSE edges with every ETB payoff in the deck. Nothing ever EMITS
  // these (no card supplies your upkeep), so they correctly form no edges; their value is that the
  // ability's own emits survive with honest timing, and a phase trigger marks a repeatable engine.
  "upkeep",
  "begin-combat",
  "end-step",
  // CR 706. Only 7 corpus cards trigger on a roll, but 162 instruct one — the supply was there and
  // had no verb to arrive as, so the consumers starved. Coin flips (CR 705) get NO engine verb: 81
  // cards flip and ZERO trigger on someone else flipping, because a flip is self-contained
  // ("flip a coin. If you win the flip, ..."), and Okaun/Zndrsplt flip and pay off on one card.
  "dice-rolled",
];

/** Common near-miss verb spellings the LLM emits, mapped to the canonical VERB_VOCAB member. */
export const VERB_ALIASES: Readonly<Record<string, Verb>> = {
  die: "dies",
  dying: "dies",
  death: "dies",
  enter: "enters",
  "enters-the-battlefield": "enters",
  etb: "enters",
  attack: "attacks",
  tap: "taps",
  "add-counter": "counter-added",
  "counter-add": "counter-added",
  "beginning-of-upkeep": "upkeep",
  "your-upkeep": "upkeep",
  "upkeep-step": "upkeep",
  "beginning-of-combat": "begin-combat",
  "combat-begins": "begin-combat",
  "beginning-of-end-step": "end-step",
  "end-of-turn": "end-step",
  "play-land": "land-play",
  "create-tokens": "create-token",
  untap: "untaps",
  untapped: "untaps",
};

/** An event an ability puts out for OTHER cards to trigger on. Subject is concrete. */
export interface GameEvent {
  verb: Verb;
  subject: SubjectFilter;
  /** Marks an event `impliedEvents` synthesized (e.g. "any creature can attack"), rather than one
   *  the tagger authored from oracle text. Never set by the LLM/extraction pipeline -- matcher-only,
   *  written solely by `packages/matcher/src/implied.ts`. Used to scope `combatSelfSupplied` to
   *  implied combat only, so authored combat emits (goad, Mage Slayer, Saskia) still form edges. */
  implied?: true;
}

/** The closed set of recognized effect.kind labels. Extraction output is normalized to this
 *  set (via EFFECT_ALIASES); abilities whose kind is unknown after aliasing are dropped, since
 *  they are almost always a keyword the model mistook for an ability (e.g. "trample") or the
 *  emit-verb name pasted into effect.kind (e.g. "counter-added"). */
export const EFFECT_KINDS = [
  "token-generation",
  "damage",
  "player-life-loss",
  "lifegain",
  "drain",
  "draw-card",
  "forced-sacrifice",
  "pump",
  /** A NEGATIVE power/toughness modifier. Shaped like `pump` and meaning the opposite: Massacre Wurm,
   *  Toxic Deluge and Doomwake Giant are removal, not anthems, and reading them as anthems put a
   *  false claim on every creature in the deck. Measured 2026-08-20: **30 of 301 derived pump
   *  abilities (10%) carry a negative amount**, 186 corpus cards print "get -N/-N". Its own kind
   *  rather than a matcher-side gate because five readers consult this field — `mechanisms.ts` uses
   *  `pump` for four archetypes and `wincon.ts` for the go-wide finisher — and every one of them was
   *  wrong about these cards. */
  "debuff",
  "cost-reduction",
  "trigger-doubling",
  "graveyard-recursion",
  "clone",
  "token-doubling",
  "damage-multiplier",
  "tax",
  "top-manipulation",
  "counter-placement",
  "enters-with-counters",
  "mana-generation",
  "fast-mana",
  "ritual",
  "copy-spell",
  "speed-increase",
  "flicker",
  "animate",
  "untap",
  "proliferate",
  "graveyard-hate",
  "extra-combat",
  // A keyword handed to OTHER permanents. Deliberately not attempted for a long time -- see
  // effect-kind.ts -- because hexproof/indestructible/ward are the `protection` deck ROLE and
  // flying/trample are evasion, and a near-miss kind is worse than silence. This is not a near-miss:
  // it says exactly what the card does. It earns edges only when the recipient names a SUBTYPE, so
  // "other Merfolk you control have ward" is a typal payoff and "creatures you control gain haste"
  // stays the ordinary-card claim it is.
  "keyword-grant",
  "type-grant",
  // The TERMINAL. 49 corpus cards say "you win the game" and the vocabulary could not express it:
  // 12 of the 38 derived thresholds gate a blank effect kind, 4 of them alt-win cards (Simic
  // Ascendancy, Revel in Riches, Hellkite Tyrant, Twenty-Toed Toad). Excluded from edges in
  // `ROLE_NOT_SYNERGY` -- winning makes the identical claim next to all 99 other cards, which is
  // the deck-role argument that took cost-reduction and tax out.
  "win-game",
  // ACTIVATION SUPPLY. An extra turn or a non-combat extra phase brings another untap step, which
  // is what a `{T}` ability needs to fire again. Kept apart from `extra-combat` because
  // `pressure.ts` reads that kind and an extra combat is not an extra untap.
  "extra-turn",
  "extra-phase",
] as const;

export type EffectKind = (typeof EFFECT_KINDS)[number];

/** Common near-miss labels the LLM emits, mapped to the canonical EFFECT_KINDS member. These
 *  mirror the label merges baked into the gold set, so model output lands on the same target. */
export const EFFECT_ALIASES: Readonly<Record<string, EffectKind>> = {
  "counter-added": "counter-placement",
  "counter-placed": "counter-placement",
  "player-damage": "damage",
  "noncombat-damage": "damage",
  "non-combat-damage": "damage",
  "life-loss": "player-life-loss",
  lord: "pump",
  anthem: "pump",
  scry: "top-manipulation",
  surveil: "top-manipulation",
  blink: "flicker",
  flickering: "flicker",
  "exile-and-return": "flicker",
};

/** The closed set of recognized effect.scaling bases — how a payoff's amount scales. Extraction
 *  output is normalized to this set (via SCALING_ALIASES); unknown → "fixed" (no scaling). */
export const SCALING_BASES = [
  "fixed",
  "per-creature",
  "per-permanent",
  "per-graveyard",
  "per-cast-or-spell",
  "x-cost",
  "per-opponent",
  "unbounded",
] as const;

export type ScalingBasis = (typeof SCALING_BASES)[number];

/** Near-miss scaling labels the LLM emits, mapped to a canonical SCALING_BASES member. */
export const SCALING_ALIASES: Readonly<Record<string, ScalingBasis>> = {
  "for-each-creature": "per-creature",
  "per-creature-you-control": "per-creature",
  "for-each-permanent": "per-permanent",
  "for-each-artifact": "per-permanent",
  devotion: "per-permanent",
  "per-graveyard-creature": "per-graveyard",
  "per-spell": "per-cast-or-spell",
  storm: "per-cast-or-spell",
  "for-each-opponent": "per-opponent",
  "per-player": "per-opponent",
  x: "x-cost",
  combo: "unbounded",
  infinite: "unbounded",
};

export interface Effect {
  /** Normalized to the closed EFFECT_KINDS set at validation time. */
  kind: string;
  subject?: SubjectFilter;
  /** Normalized to the closed SCALING_BASES set at validation time; absent → "fixed". */
  scaling?: string;
  /** WHAT the count counts, when the basis alone cannot say. `per-graveyard` covers Cavalier of
   *  Flame's land cards, Glamdring's instants and sorceries and Bonehoard's creatures alike, so an
   *  edge drawn off the basis would claim that milling anything feeds all three. Carries the zone
   *  and the owner too, so `graveyardFillMatches` can judge it like any other graveyard demand. */
  scalingSubject?: SubjectFilter;
}

export type AbilityKind = "triggered" | "activated" | "static" | "on-cast";

/** How often an ability fires, per turn CYCLE — a full round of the pod. `per-turn` fires on every
 *  player's turn and so up to pod-size times a round; `per-cycle` fires only on yours. */
export type Repeats = "once" | "per-cycle" | "per-turn" | "repeatable" | "continuous";

export interface Ability {
  kind: AbilityKind;
  /** Present for triggered abilities. "enters or attacks" = one trigger, two verbs.
   *
   *  `threshold` is a numeric condition on WHEN the trigger fires — The Millennium Calendar's
   *  "when there are 1,000 or more time counters". Absent means the trigger states no count, which
   *  is the overwhelming majority; see `threshold.ts` for the two shapes deliberately excluded.
   *
   *  It records HOW MANY and never OF WHAT. For Calendar the trigger's own `subject.counter` supplies
   *  the resource; for "if you control four or more lands" nothing does. A consumer must not assume
   *  the threshold's subject is the trigger's subject.
   *
   *  `thresholdSubject` is the noun the threshold counts, when it names a countable permanent — see
   *  `thresholdSubjectFor`. Present only alongside `threshold`, and only sometimes even then: "if you
   *  control ten or more Treasures" carries one, Cabal Ritual's "seven or more cards in your
   *  graveyard" carries none (a zone-scoped card count has no `type`/`subtype` to parse), and
   *  "thirteen cards in your hand" is refused on purpose because no `SubjectFilter` can express a
   *  hand-size condition. */
  trigger?: {
    verbs: Verb[];
    subject: SubjectFilter;
    threshold?: { atLeast: number };
    thresholdSubject?: SubjectFilter;
  };
  /** An activated ability's activation cost, verbatim as `segment.ts` split it out of the body —
   *  "{X}{X}, {T}", "{T}, Sacrifice a creature". Unparsed on purpose: this records what the card
   *  says, and what a cost MEANS for a loop's economy is sub-project B's question.
   *
   *  Empty string means "activated, no cost recorded"; absent means "not an activated ability".
   *  The distinction is load-bearing — it is the difference between a free sacrifice outlet and a
   *  static ability. */
  cost?: string;
  /** The amount stated by the action that produced this ability, verbatim from the clause —
   *  "2", "X", "1,000".
   *
   *  A STRING, not a number. "X" is a legitimate value and `Number("X")` is NaN, which is exactly
   *  how a `*` power once poisoned an entire pressure curve (`pressure.ts:41-43`). Whoever consumes
   *  this decides what a variable amount means; derivation's job is to record what the card says.
   *
   *  Unset when the action states no amount. Never defaulted to 1 — "draw a card" and "draw 1 card"
   *  are the same fact, but "no amount recorded" and "amount is one" are not. */
  amount?: string;
  /** THEME TAGS THE ABILITY'S INTERVENING-IF CONDITION DEMANDS — "if it had counters on it" wants a
   *  counters deck, "if a creature died this turn" wants an aristocrats one.
   *
   *  Not an evaluable condition and deliberately not one: see `conditionCares`. It records only the
   *  DEMAND, so `cardCaresTags` can put the card on the right axis. Forms no edge, ever. */
  conditionCares?: string[];
  /** How often this ability can fire — see
   *  `docs/superpowers/specs/2026-08-11-repeatability-taxonomy-design.md`.
   *
   *  A DIFFERENT axis from the `repeatability` that `edges.ts` and `buckets.ts` derive from
   *  `kind`: that says what kind of ability this is, this says how often it fires. Gogo's
   *  `{X}{X}, {T}:` and a free sacrifice outlet are both "activated" and a round apart.
   *
   *  UNSET means the rules could not tell, which is a real outcome. Unlabelled beats mislabelled:
   *  a consumer can see an absent label and decline to weight it, but cannot see through a wrong
   *  one. */
  repeats?: Repeats;
  effect: Effect;
  /** Events this ability emits for others to trigger on. */
  emits?: GameEvent[];
}

export interface Characteristics {
  types: string[];
  subtypes: string[];
  /** The faces this card can be PLAYED as, one at a time, each unmerged. Absent on a single-face
   *  card. A transform or flip card lists only its front — its back is reached by transforming a
   *  permanent already in play, which is not a zone change — while a modal DFC, adventure, split or
   *  `prepare` card lists every face, because each really is castable or playable in its own right.
   *
   *  `types`/`subtypes` stay the UNION of every face and are still what a consumer asking what this
   *  permanent can BE should read: a transformed Westvale Abbey really is a Demon. What the union
   *  cannot express is what ENTERS or is CAST, since those happen one face at a time.
   *  `impliedEvents` is its only reader. */
  faces?: { types: string[]; subtypes: string[] }[];
  /** Scryfall's printing layout, carried so the matcher can apply the ZONE rules, which differ by
   *  family and cannot be read off `faces` alone — split and adventure both list every face.
   *  See `zoneTypes` in matcher/implied.ts. */
  layout?: string;
  colors: string[];
  identity: string[];
  cmc: number;
  power: string | null;
  toughness: string | null;
  /** Printed cards are always false. */
  token: boolean;
  /** THE ONE DECK FACT ON AN OTHERWISE PRINTED RECORD. Set per deck by `markCommander`
   *  (matcher/commander.ts), never by extraction — CR 903.3 says the commander designation "is not a
   *  characteristic of the object represented by the card". It lives here anyway because a card's
   *  IMPLIED events (`impliedEvents` → `selfSubject`) are synthesized from `Characteristics` at match
   *  time and are exactly the ones a commander-matters consumer needs: a commander's combat damage,
   *  entry and death. Stamping only the authored emits left Kediss unable to see its own partner. */
  commander?: boolean;
  keywords: string[];
}

export interface CardTags {
  oracleId: string;
  schemaVersion: number;
  promptVersion: number;
  model: string;
  characteristics: Characteristics;
  abilities: Ability[];
  /** True for a hand-verified tag that must survive automated re-tagging (e.g. a prompt-version
   *  bump). needsRetag short-circuits to false for a pinned tag regardless of version drift —
   *  set this only for cards where the LLM has demonstrably gotten the shape wrong and a human
   *  fixed it directly (see docs/superpowers/plans/2026-07-28-strategy-gap-fixes.md Task 2). */
  pinned?: boolean;
}
