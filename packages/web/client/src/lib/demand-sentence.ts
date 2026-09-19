/** A CENSUS KEY, AS THE WORDS A PLAYER USES — extracted from `BuildBenchmarks.tsx` so the ranked
 *  diagnosis can reach it too.
 *
 *  `lib/findings.ts` began printing raw keys ("enters:type:land") in a finding's own sentence, which
 *  is the same class of defect as the `targetedRemoval` that escaped into prose one review earlier:
 *  an internal identifier rendered as English. The fix is one map, not a second copy — a duplicate
 *  of this vocabulary is how two surfaces start disagreeing about what a key means.
 *
 *  Moved rather than imported across the layer boundary: a lib module importing from a component is
 *  the wrong direction and would have made this a cycle the first time a component needed a finding.
 */
/** The event half of a census key (`enters`, `dies`, `cast`, `end-step`…) as the words a player
 *  would use, for every verb `@edh-seer/tagger`'s `VERB_VOCAB` can put in a consumer's trigger EXCEPT
 *  the three `availability.ts` calls `PHASE_VERBS` (those live in `DEMAND_PHASE` below, because a
 *  phase carries no subject to glue this onto) AND the eight `DEMAND_SUBJECTLESS` below (a player
 *  action has no permanent subject either). The completeness test below this component walks all
 *  three maps against `VERB_VOCAB`/`PHASE_VERBS` directly, so a verb the engine grows can no longer
 *  ship silently unmapped, unmapped twice, or glued to a subject that cannot perform it — see
 *  `demandSentence`'s fallback for what happens if one ever is.
 *
 *  Every remaining entry reads as a TRUE sentence once `${subject} ${event}` is glued: the subject
 *  is always the OBJECT the event happens to or the ACTOR performing it, and every verb below is
 *  true of a permanent in one of those two roles — `mill`/`discard`/`sacrifice`/`create-token` are
 *  PASSIVE ("a card being milled" is true regardless of who mills it) and `enters`/`dies`/`leaves`/
 *  `taps`/`untaps`/`attacks`/`cast`/`combat-damage`/`non-combat-damage`/`counter-added`/`land-play`
 *  are ACTIVE, naming a permanent or card as the thing that does it. Checked one at a time against
 *  review finding F1 (task 8 fix round 1), which is why this comment says so rather than leaving the
 *  reader to re-derive it: `draw`, `gain-life`, `lose-life`, `dice-rolled` and `proliferate` failed
 *  that check (CR pins all five to the CONTROLLER, never a permanent) and moved out.
 *
 *  One entry still needs a call rather than a lookup:
 *  - `counter-added`: the subject is what the counter lands ON ("a creature getting a counter"),
 *    not the counter's own kind — the field this reads is the consumer's demand, and a demand
 *    names a permanent, never a +1/+1. */
export const DEMAND_VERB: Record<string, string> = {
  enters: "entering the battlefield",
  "enters-graveyard": "going to a graveyard",
  // The eerie half: "whenever you fully unlock a Room" (verb added 2026-09-05).
  unlock: "being fully unlocked",
  dies: "dying",
  leaves: "leaving the battlefield",
  "leaves-graveyard": "leaving a graveyard",
  cast: "being cast",
  attacks: "attacking",
  taps: "becoming tapped",
  untaps: "untapping",
  "non-combat-damage": "dealing noncombat damage",
  "combat-damage": "dealing combat damage",
  damaged: "being dealt damage",
  exiled: "being exiled",
  discard: "being discarded",
  mill: "being milled",
  sacrifice: "being sacrificed",
  "create-token": "being created",
  "counter-added": "getting a counter",
  "counter-removed": "losing a counter",
  // AC11 batch 2, the object events (2026-09-09).
  transform: "transforming",
  "turned-face-up": "being turned face up",
  copy: "being copied",
  reveal: "being revealed",
  attached: "becoming attached",
  unattached: "becoming unattached",
  "gains-control": "changing control",
  "phases-out": "phasing out",
  regenerate: "regenerating",
  // AC11 batch 3, keyword actions done to a permanent.
  goad: "being goaded",
  exert: "being exerted",
  detain: "being detained",
  suspect: "being suspected",
  harness: "being harnessed",
  convert: "converting",
  explore: "exploring",
  endure: "enduring",
  heal: "being healed",
  airbend: "being airbent",
  foretell: "being foretold",
  // CR 701.5, verb added 2026-09-09 (the Baral witness).
  "counter-spell": "being countered",
  "land-play": "being played",
};

/** Phase keys carry no subject — "an end step" is the whole demand, and gluing a subject onto it
 *  ("anything an end step") is nonsense. Kept in exact lockstep with `availability.ts`'s own
 *  `PHASE_VERBS` (the completeness test enforces it): `combat-damage` and `draw-step` do NOT belong
 *  here — the first is an event with a subject (a CREATURE dealing combat damage), the second is a
 *  phase name the engine has never used a trigger key for. Both bugs shipped from this map
 *  disagreeing with the engine's own list instead of reading it. */
export const DEMAND_PHASE: Record<string, string> = {
  "end-step": "an end step",
  upkeep: "an upkeep",
  "begin-combat": "the beginning of combat",
};

/** Player actions, not permanent events — the CR pins each of these eight to the CONTROLLER
 *  (CLAUDE.md's own list of controller-only verbs: draw · mill · discard · sacrifice · search ·
 *  scry · surveil · add-mana · create · gain-life · lose-life; the other six in that list stay in
 *  `DEMAND_VERB` because their PASSIVE reading — "a card being milled/discarded", "a permanent
 *  being created/sacrificed" — is true of the object no matter who acts on it). None of these eight
 *  has a true passive reading once glued to a subject: "anything drawing a card" told the reader a
 *  PERMANENT draws, which nothing does — review finding F1, task 8 fix round 1. Same structural move
 *  `DEMAND_PHASE` already makes for a phase: the phrase IS the whole demand, no subject glued on.
 *  `proliferate` moves here too — no corpus card narrows WHAT proliferates (it is a player action
 *  over "any number" of permanents/players with counters), so "anything proliferating" was the same
 *  false-actor sentence, not a genuinely free choice of wording. */
export const DEMAND_SUBJECTLESS: Record<string, string> = {
  draw: "a card being drawn",
  "gain-life": "life being gained",
  "lose-life": "life being lost",
  "dice-rolled": "a die being rolled",
  proliferate: "proliferating",
  // CR 701.22 / 701.25 / 701.23, added 2026-09-07 with the verbs. SUBJECTLESS is the right table of
  // the three: "whenever you scry" names no permanent, so gluing a subject to it would invent an
  // actor exactly as the header describes for proliferate. All 27 consumers phrase it about the
  // PLAYER -- 15 scry, 10 surveil, 4 search, and every one reads "whenever you/an opponent ...".
  scry: "scrying",
  surveil: "surveilling",
  // The engine emits this only for a LIBRARY search (emits.ts), which is what all four consumers
  // watch, so the phrase says the zone rather than leaving the reader to guess it.
  search: "a library being searched",
  // CR 104.3, AC11 batch 1: a player event, no permanent subject.
  "loses-game": "a player losing the game",
  // AC11 batch 2: player-scoped events with no permanent subject.
  shuffle: "a library being shuffled",
  prevented: "damage being prevented",
  exchange: "an exchange",
  double: "doubling",
  triple: "tripling",
  // AC11 batch 3, keyword actions a PLAYER performs.
  vote: "a vote",
  clash: "a clash",
  fateseal: "fatesealing",
  behold: "beholding",
  learn: "learning",
  forage: "foraging",
  "time-travel": "time travelling",
  "collect-evidence": "collecting evidence",
  "venture-into-the-dungeon": "venturing into the dungeon",
  "face-a-villainous-choice": "a villainous choice",
  waterbend: "waterbending",
  // AC11 batch 4, the designations: player events, no permanent subject.
  "flip-coin": "a coin being flipped",
  monarch: "becoming the monarch",
  initiative: "taking the initiative",
  "city-blessing": "gaining the city's blessing",
  "ring-tempts": "the Ring tempting you",
};

/** THE SAME EVENT, AS A CLAUSE (roadmap AK4, owner 2026-09-19: "this is not how mtg players say
 *  things"). `DEMAND_VERB` holds participles because it was built to be GLUED to a noun -- "a
 *  creature dying" -- which reads as a label and nowhere else. Inside a sentence it was simply
 *  wrong, and shipped that way: the ability table has been printing "when this card dying" and
 *  "when a card being drawn" on every card page.
 *
 *  Present tense, third person, because that is the tense the rules text a player reads is in. */
export const CLAUSE_VERB: Record<string, string> = {
  enters: "enters the battlefield",
  "enters-graveyard": "goes to a graveyard",
  unlock: "is fully unlocked",
  dies: "dies",
  leaves: "leaves the battlefield",
  "leaves-graveyard": "leaves a graveyard",
  cast: "is cast",
  attacks: "attacks",
  taps: "becomes tapped",
  untaps: "untaps",
  "non-combat-damage": "deals noncombat damage",
  "combat-damage": "deals combat damage",
  damaged: "is dealt damage",
  exiled: "is exiled",
  discard: "is discarded",
  mill: "is milled",
  sacrifice: "is sacrificed",
  "create-token": "is created",
  "counter-added": "gets a counter",
  "counter-removed": "loses a counter",
  transform: "transforms",
  "turned-face-up": "is turned face up",
  copy: "is copied",
  reveal: "is revealed",
  attached: "becomes attached",
  unattached: "becomes unattached",
  "gains-control": "changes control",
  "phases-out": "phases out",
  regenerate: "regenerates",
  goad: "is goaded",
  exert: "is exerted",
  detain: "is detained",
  suspect: "is suspected",
  harness: "is harnessed",
  convert: "converts",
  explore: "explores",
  endure: "endures",
  heal: "is healed",
  airbend: "is airbent",
  foretell: "is foretold",
  "counter-spell": "is countered",
  "land-play": "is played",
};

/** The subjectless events as clauses. Most already read as one; the participles do not. */
export const SUBJECTLESS_CLAUSE: Record<string, string> = {
  draw: "a card is drawn",
  // WITH NO TYPE IN THE KEY THE OBJECT IS STILL KNOWN: milling and discarding are done to CARDS,
  // so the bare key reads "a card is milled" rather than the generic "anything is milled". A key
  // that names a type (`mill|creature|-|-`) never reaches here and keeps its own noun.
  mill: "a card is milled",
  discard: "a card is discarded",
  "gain-life": "life is gained",
  "lose-life": "life is lost",
  "dice-rolled": "a die is rolled",
  proliferate: "you proliferate",
  scry: "you scry",
  surveil: "you surveil",
  search: "a library is searched",
  "loses-game": "a player loses the game",
  shuffle: "a library is shuffled",
  prevented: "damage is prevented",
  exchange: "an exchange happens",
  double: "something is doubled",
  triple: "something is tripled",
  vote: "you vote",
  clash: "you clash",
  fateseal: "you fateseal",
  behold: "you behold",
  learn: "you learn",
  forage: "you forage",
  "time-travel": "you time travel",
  "collect-evidence": "you collect evidence",
  "venture-into-the-dungeon": "you venture into the dungeon",
  "face-a-villainous-choice": "you face a villainous choice",
  waterbend: "you waterbend",
  "flip-coin": "a coin is flipped",
  monarch: "you become the monarch",
  initiative: "you take the initiative",
  "city-blessing": "you gain the city's blessing",
  "ring-tempts": "the Ring tempts you",
};

/** WHAT A CARD DOES, IN A PLAYER'S WORDS (roadmap AK4, owner's ruling: "draw a card").
 *
 *  A card that CAUSES an event performs an action, and a player names the action, not the event --
 *  "mill a card", not "a card being milled". This is the verb; the object noun is glued on by
 *  `eventKeyAction`.
 *
 *  AND THE VERB HAS TO BE A REAL ONE. `dies` was given "kill", which is not a word in Magic; the
 *  obvious replacement is not right either, because CR 701.7 `destroy` is only ONE of the ways CR
 *  700.4 `dies` happens and this key's suppliers use several. It has no entry, and the clause "a
 *  creature dies" -- which IS the rules word -- carries it. Both terms reach it through the search.
 *
 *  NOT EVERY EVENT HAS ONE, and that is not a gap. Nobody "deaths" a creature, and no card makes
 *  "a creature attack" the way it makes one die -- those keep the clause. An absent entry here is
 *  the caller's signal to fall back, which is why this map is deliberately shorter than the other
 *  two rather than padded with invented verbs.
 *
 *  `ONTO`/`INTO` are placeholders the composer splits on: the object sits inside the phrase ("put
 *  a creature onto the battlefield"), not after it. */
export const ACTION_VERB: Record<string, string> = {
  mill: "mill",
  discard: "discard",
  exiled: "exile",
  sacrifice: "sacrifice",
  "create-token": "create",
  taps: "tap",
  untaps: "untap",
  copy: "copy",
  reveal: "reveal",
  goad: "goad",
  detain: "detain",
  suspect: "suspect",
  exert: "exert",
  transform: "transform",
  regenerate: "regenerate",
  heal: "heal",
  harness: "harness",
  cast: "cast",
  "counter-spell": "counter",
  "land-play": "play",
  "gains-control": "take control of",
  "counter-added": "put a counter on",
  "counter-removed": "remove a counter from",
  damaged: "deal damage to",
  enters: "put ONTO the battlefield",
  "enters-graveyard": "put INTO a graveyard",
  // A FILL IS AN ACTION ON THE CAUSING SIDE. The label reads as the thing wanted ("a creature in a
  // graveyard") because a reanimator is waiting for it; the card that puts it there is doing
  // something, and a player calls that filling the yard.
  fills: "put INTO a graveyard",
};

/** A STATIC HAS NO ACTION FORM, AND THE ONE IT HAD WAS BACKWARDS (owner-commissioned engine
 *  review, 2026-09-19). `STATIC_ACTION` read "boost a creature" on the CAUSES list -- but the
 *  suppliers of `applies:pump|creature|-|-` are the 15,005 cards the anthem REACHES, not the
 *  anthems: Llanowar Elves and Dimir Doppelganger are in that list and Glorious Anthem is not.
 *  The engine models a static as WANTING its class, so the anthem is the consumer (Koll, Rienne,
 *  Divine Sacrament, all on the cares side) and the creatures supply it.
 *
 *  So a static is a standing fact about a class, exactly like `counts` and `copies`, and the label
 *  form -- "a creature it boosts" -- already reads correctly from both ends. Naming an action here
 *  described the wrong side of every `applies:*` key, including cost-reduction at 24,982 cards. */

/** THE OBJECT A VERB IMPLIES WHEN THE KEY NAMES NO CLASS. "untap anything" is not what a player
 *  says; "untap a permanent" is, and the verb already tells you which noun it must be. Only for
 *  verbs whose object is never in doubt -- everything else keeps "anything", which is honest about
 *  the key naming no class at all. */
const DEFAULT_OBJECT: Record<string, string> = {
  taps: "a permanent",
  untaps: "a permanent",
  exiled: "a card",
  reveal: "a card",
  sacrifice: "a permanent",
  "create-token": "a token",
  "counter-spell": "a spell",
  "land-play": "a land",
};

/** The subjectless actions, whole: there is no object noun to glue on. */
export const SUBJECTLESS_ACTION: Record<string, string> = {
  draw: "draw a card",
  // The same known object the clauses name: you mill a CARD, you discard a CARD.
  mill: "mill a card",
  discard: "discard a card",
  "gain-life": "gain life",
  // NOT "drain": a drain loses life AND gains it, and the suppliers here are mostly plain burn
  // (Fire Ambush deals damage, which is life loss, and gains nothing). Review finding, 2026-09-19.
  "lose-life": "make a player lose life",
  search: "search your library",
  scry: "scry",
  surveil: "surveil",
  proliferate: "proliferate",
  shuffle: "shuffle a library",
  "flip-coin": "flip a coin",
  "dice-rolled": "roll a die",
  vote: "vote",
  clash: "clash",
  fateseal: "fateseal",
  behold: "behold",
  learn: "learn",
  forage: "forage",
  "time-travel": "time travel",
  "collect-evidence": "collect evidence",
  "venture-into-the-dungeon": "venture into the dungeon",
  waterbend: "waterbend",
  monarch: "become the monarch",
  initiative: "take the initiative",
  "city-blessing": "gain the city's blessing",
};

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** A raw census key, de-slugified. Reached only when a verb or a subject shape has no entry above
 *  — which the completeness test says should never happen for a real `VERB_VOCAB` member, so this
 *  is the SAFETY NET for a verb the engine grows tomorrow, not the everyday path. `humanizeEvent`
 *  (edges.ts, deleted 0fb5e4d once `sentence.ts` took over reason-sentence rendering) shipped this
 *  exact idea as its own default case: colons and dashes are the only things distinguishing a raw
 *  key from an ordinary English sentence, so stripping them to spaces is still ugly and true, but
 *  it no longer LOOKS like engine internals — the failure this map has already shipped twice
 *  (`combat-damage`, `begin-combat`) was a raw identifier reaching a reader, not an English gap. */
const deslugify = (key: string): string => key.replace(/[:-]/g, " ");

/** Turn a census key into the sentence its own aria-label already implies — `enters:type:creature`
 *  is "a creature entering the battlefield", not a colon-separated identifier.
 *
 *  THE RAW KEY IS ENGINE VOCABULARY, and four separate player reviews read it as evidence the page
 *  was a template rather than a reading of their deck. It survives on the row's `title` for anyone
 *  who wants to match a report against `bin/deck-availability.ts`, which prints keys. */
export function demandSentence(key: string): string {
  const narrowed = key.endsWith(" (narrowed)");
  const bare = narrowed ? key.slice(0, -" (narrowed)".length) : key;
  const [verb, ...rest] = bare.split(":");
  const subjectKey = rest.join(":");

  const phase = DEMAND_PHASE[verb];
  if (phase && subjectKey === "any") return phase;

  // A player action has no permanent subject to glue this onto either -- same shape as the phase
  // check above, one rung down (the subject slot always resolves to "any" for these eight, since
  // nothing narrows WHO draws or gains life to a card type).
  const subjectless = DEMAND_SUBJECTLESS[verb];
  if (subjectless && subjectKey === "any") {
    return `${subjectless}${narrowed ? " (a real one, not the game's own)" : ""}`;
  }

  const event = DEMAND_VERB[verb];
  // Unknown verb: say the true ugly thing, de-slugified, rather than inventing a phrase for a verb
  // the engine grew after this map was written.
  if (!event) return deslugify(key);

  /** "artifact", "battle", "creature" -> "an artifact, battle or creature". */
  const oneOf = (members: string[]): string => {
    const rest = [...members];
    const last = rest.pop()!;
    const noun = rest.length > 0 ? `${rest.join(", ")} or ${last}` : last;
    return `${/^[aeiou]/i.test(noun) ? "an" : "a"} ${noun}`;
  };

  let subject: string;
  if (subjectKey === "any") {
    subject = "anything";
  } else if (subjectKey.startsWith("subtype:")) {
    // Subtypes are proper nouns in Magic — a Wizard, not a wizard.
    subject = oneOf(subjectKey.slice("subtype:".length).split("+").map(capitalize));
  } else if (subjectKey.startsWith("type:")) {
    subject = oneOf(subjectKey.slice("type:".length).split("+"));
  } else {
    // A subject shape this function has no branch for — same failure mode as an unmapped verb,
    // same fallback for the same reason.
    return deslugify(key);
  }

  return `${subject} ${event}${narrowed ? " (a real one, not the game's own)" : ""}`;
}

/** A census key's VERB half as a chip label — "dies" -> "Dying", "combat-damage" -> "Dealing combat
 *  damage". Reuses `DEMAND_VERB` rather than adding a second vocabulary: this repo has now twice
 *  shipped an internal identifier rendered as English (`targetedRemoval`, `enters:type:land`), and
 *  both times the humane label already existed one file over.
 *
 *  A verb the map has never seen de-slugs rather than printing a raw token, which is the same
 *  fallback `demandSentence` takes and for the same reason. */
export function eventLabel(verb: string): string {
  const phrase = STATIC_KIND[verb] ?? MECHANISM[verb] ?? DEMAND_VERB[verb]
    ?? DEMAND_SUBJECTLESS[verb] ?? DEMAND_PHASE[verb] ?? verb.replace(/-/g, " ");
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

/** THE MECHANISMS A REASON TAG NAMES THAT A CENSUS KEY NEVER DOES.
 *
 *  `DEMAND_VERB` was built for CENSUS keys — what a consumer's trigger watches. A reason TAG carries
 *  a partly different vocabulary, because most of `edges.ts`'s passes write their own literal:
 *  `ramp-target:`, `tutor:`, `creates:`, `land-condition:`, `doubles:`, `scales:`, `wincon:`,
 *  `graveyard-recursion:`, `meld`. Nothing had ever reconciled the two lists, so every one of those
 *  fell through `eventLabel`'s de-slugify branch and reached the reader as an internal identifier:
 *  "Ramp target", "Creates", "Doubles".
 *
 *  IT IS NOT A LONG TAIL. Measured across the 71 calibration decks 2026-08-27, by reason count and
 *  by decks: **`creates` 662 in SEVENTY of 71 decks · `ramp-target` 1,543 in SIXTY-NINE** — the two
 *  worst offenders are in essentially every deck anyone would paste — then `land-condition` 576 (45)
 *  · `tutor` 479 (27) · `scales` 255 (16) · `doubles` 234 (7) · `clone` 44 (2) · `wincon` 11 (2).
 *
 *  EVERY LABEL IS TAKEN FROM THE ENGINE'S OWN SENTENCE FOR THAT TAG, never from reading the tag's
 *  name — `sentence.ts` is where each pass says in English what it claims, so it is the authority on
 *  what the mechanism IS:
 *    - `creates`             `createsSentence`            "P creates C"
 *    - `ramp-target`         `fetchSentence`              "P can fetch C"
 *    - `tutor`               `tutorSentence`              "P can search up C"
 *    - `graveyard-recursion` `graveyardEnablesRecursion`  "When P is in the graveyard, C can bring it back"
 *    - `scales`              `graveyardFeedsScaling`      "When P is in the graveyard, C gets bigger"
 *    - `doubles`             `doublesSentence`            "P doubles C's <verb> trigger"
 *    - `wincon`              `winconSentence`             "P is what C counts toward winning"
 *    - `meld`                `meldSentence`               "A and B meld together"
 *    - `land-condition`      `landConditionSentence`      three templates, all of the shape
 *                            "C is better/enters untapped/can use its second mana ability while you
 *                            control a <basic type>, and P is one" — so the label names the DEMAND
 *                            the three share, which is the only thing true of all of them.
 *    - `clone`               `GRANT_PHRASES.clone`        "a copy of what it targets"
 *
 *  `clone` IS AN EFFECT KIND, NOT A PASS LITERAL, and it is here because the static pass's other
 *  branch writes `<effect kind>:<subject>` — so an effect kind can reach a legend as a mechanism.
 *  Its `static:clone` twin above carries the same phrase on purpose: the mechanism is the same fact
 *  whether or not the ability granting it is static, and giving one surface two words for it is the
 *  disagreement this whole module exists to prevent.
 *
 *  STILL NO RATCHET OVER EVERY POSSIBLE KIND, AND THAT IS A CHOICE. `EFFECT_KINDS` is importable and
 *  would make one — but most of its ~40 members have never formed a reason in 71 decks, and a label
 *  invented for a mechanism nobody has a witness for is a guess dressed as coverage. The test below
 *  pins the MEASURED set; anything else keeps the de-slugify fallback, which is what every entry
 *  here had before it was measured. */
export const MECHANISM: Record<string, string> = {
  creates: "creating a token",
  "ramp-target": "fetching a land",
  tutor: "searching up a card",
  // "FROM WHERE, TO WHERE?" -- a tuner's objection, and half of it is answerable. The engine's
  // sentence is "When P is in the GRAVEYARD, C can bring it back", so the source zone is a printed
  // fact and belongs in the label. The DESTINATION is not in the kind (graveyard-to-hand and
  // graveyard-to-battlefield derive the same one), so the label does not claim it -- naming a zone
  // the tag cannot distinguish would be the wrong half of the same complaint.
  "graveyard-recursion": "bringing cards back from a graveyard",
  // "GETTING BIGGER 1" SAT BESIDE "BOOSTING POWER AND TOUGHNESS 30" and three reviewers in a row
  // said they name the same thing: "two names, no distinction given", "sound like the same thing and
  // are two separate chips", "I don't know which one a pump effect I care about lands in".
  //
  // They are different, and the difference is the GRAVEYARD -- checked in the engine rather than
  // guessed: the scaling loop opens `if (a.effect.scaling !== "per-graveyard") continue`, and
  // `scalingSubject` returns undefined unless the text counts something in a graveyard. So every
  // `scales:` reason on this board is a payoff that grows with a graveyard, and the label can say so
  // without over-claiming. `static:pump` stays the ordinary power/toughness boost.
  scales: "getting bigger from a graveyard",
  doubles: "doubling a trigger",
  wincon: "counting toward a win",
  // The processor pass's tag is `exile-processing:<what was exiled>` (AF7b, 2026-09-16).
  "exile-processing": "processing an opponent's exiled card",
  // The threshold pass's tag is `threshold:<what it counts>` (2026-09-16): a count the ability is
  // GATED on -- Gadrak's four artifacts, Chrome Steed's metalcraft -- as `wincon` is for a win.
  threshold: "counting toward a condition",
  meld: "melding",
  "land-condition": "needing a basic type",
  clone: "copying a permanent",
  // AC12: the copy-ability pass's tag is `copies:<kind>`.
  copies: "having an ability copied",
  // The fodder pass's tag is `fodder:<what it eats>` (recall v4 token family, 2026-09-09).
  fodder: "being sacrificed to it",
};

/** A STATIC IS A CLASS, NOT A MECHANISM, AND EVERY OTHER TAG'S FIRST COMPONENT IS A MECHANISM.
 *
 *  Reason tags are built two ways (`edges.ts`): a normal one is `<mechanism>:<subject>` —
 *  `enters:creature`, `cast:spell` — so splitting on the colon yields the mechanism. A static one is
 *  `static:<mechanism>`, so the same split yields the literal word "static" and throws the mechanism
 *  away. Measured across the 71 calibration decks 2026-08-27: **6,829 of 43,376 reasons (15.7%) are
 *  `static:`, over EIGHT distinct mechanisms** — cost-reduction 4,326 (59 decks) · pump 1,698 (34) ·
 *  keyword-grant 425 (22) · type-grant 229 (5) · speed-increase 61 · untap 45 · token-generation 44 ·
 *  animate 1. A cost cut and an anthem are not the same thing to a deckbuilder, and the graph legend
 *  was calling both of them "Static".
 *
 *  IT WAS NAMING THE WRONG HALF OF A REAL EDGE. On the Jodah deck, Serah Farron reaches a token
 *  carrying BOTH `static:cost-reduction` and `static:pump`; the first was false (a token is never
 *  cast) and the second true, and the legend printed the word that came from the false one.
 *
 *  THE ENGINE ALREADY HAS ENGLISH FOR THESE and it is deliberately not imported: `sentence.ts`'s
 *  `GRANT_PHRASES` fits the slot "<producer> gives <consumer> ___" ("bigger stats", "an extra
 *  ability"), which is a different grammar from a legend LABEL, and no subpath of `@edh-seer/matcher` is
 *  safe to value-import from client code anyway (the 2026-08-21 regression). Same reason
 *  `DEMAND_VERB` and the engine's own `VERB_PHRASES` coexist.
 *
 *  NO COMPLETENESS RATCHET, AND THAT IS STATED RATHER THAN QUIETLY MISSING. `DEMAND_VERB` can be
 *  walked against `VERB_VOCAB` because that list is authoritative; there is no list of "effect kinds
 *  that can appear on a STATIC ability" — it is whatever derivation produces — so this is the
 *  measured set plus the rest of `GRANT_PHRASES`, and an unmapped kind falls through to de-slugified
 *  text, which is exactly what every one of them did before this map existed. */
export const STATIC_KIND: Record<string, string> = {
  // "LESS THAN WHAT?" -- asked by two persona reviews independently. The engine's own sentence is
  // "P reduces what C COSTS", and a cost reduction is refused on a land because "a land is played,
  // not cast", so the thing reduced is the CAST cost and the label can say so.
  "static:cost-reduction": "costing less to cast",
  // "BIGGER STATS" LEFT OUT THE ONE FACT A TUNER CUTS ON. Their words: "Anthems? +1/+1 counters?
  // Equipment? A 'power equal to the number of legends you control' effect? All four are different
  // cards to me and I'd cut them differently." The KIND genuinely cannot separate those -- `pump`
  // is any power/toughness increase -- so the honest move is to name the axis precisely rather than
  // to imply a narrower claim. `PHRASES.pump` in the engine is "gives +N/+N", which is exactly this.
  "static:pump": "boosting power and toughness",
  "static:keyword-grant": "granted abilities",
  "static:type-grant": "granted types",
  "static:speed-increase": "haste",
  "static:untap": "extra untaps",
  "static:token-generation": "making tokens",
  "static:animate": "becoming a creature",
  // Present in the engine's `GRANT_PHRASES` and unmeasured in the 71 decks — an arbitrary paste can
  // still produce them, and a label costs nothing where the fallback would print a slug.
  "static:clone": "copying a permanent",
  "static:proliferate": "proliferating",
  "static:enters-with-counters": "entering with counters",
};

/** THE VOCABULARY MIXES TWO KINDS OF THING, AND THAT IS INHERENT RATHER THAN AN OVERSIGHT.
 *  A skeptic review (2026-08-27) put it exactly: `entering the battlefield`, `being cast` and
 *  `attacking` name the event a card WATCHES, while `bringing cards back from a graveyard`,
 *  `costing less to cast` and `fetching a land` name the EFFECT. That is what the tags are --
 *  `edges.ts` writes a trigger event for an event edge and an effect kind for a static or a pass
 *  literal -- so no labelling can unify them without re-keying the engine's reasons, which the
 *  frozen panel's cached verdicts are keyed on. Recorded so the next reader knows it was seen and
 *  priced, not missed. `creating a token` is the one that could honestly be read either way.
 */

/** The mechanism a reason tag names, for any surface that groups edges by mechanism.
 *
 *  ONE FUNCTION FOR THE TRACE CHIPS AND THE FLOW LEGEND. They read the same tags and would otherwise
 *  disagree about what an edge IS — the chip saying "Static 18" beside a legend saying "Costing less
 *  12", which is how two surfaces start telling different stories about one number. */
export function mechanismKey(tag: string): string {
  return tag.startsWith("static:") ? tag : tag.split(":")[0];
}

/** A whole reason tag as English -- the mechanism, plus the subject that narrows it.
 *
 *  The card inspector rendered the raw tag inside an uppercasing chip, so a relationship read
 *  "ENTERS:CREATURE  GRAVEYARD-RECURSION:ANY" directly above the sentences that already say the
 *  same thing in words. That is the third surface in this repo to ship an internal identifier as
 *  English, after `targetedRemoval` and `enters:type:land`, and it survived the last sweep only
 *  because it sits in a panel the persona screenshots had cropped.
 *
 *  THE SUBJECT IS KEPT, because it is what discriminates: `enters:creature` and `enters:land` are
 *  the same mechanism narrowed two ways, and a chip reading only "Entering the battlefield" on both
 *  would make two different claims look identical -- the same collapse the static split just
 *  undid one surface over. `any` is dropped: it narrows nothing, so printing it adds a word and no
 *  fact. A `static:` tag has no subject half at all (its second component IS the mechanism), which
 *  `mechanismKey` already encodes, so it correctly yields the bare label. */
export function tagLabel(tag: string): string {
  const mechanism = mechanismKey(tag);
  const label = eventLabel(mechanism);
  if (mechanism === tag) return label;
  const subject = tag.slice(mechanism.length + 1);
  return subject && subject !== "any" ? `${label} · ${subject}` : label;
}

/** AN ARTIFACT EVENT KEY (`verb|type|subtype|token`) AS THE WORDS A PLAYER USES.
 *
 *  The card and commander pages print these keys, and the Pages Function prints them into the HTML
 *  a crawler reads -- so until this existed, the main content of 17,775 indexable pages included
 *  four pipe-separated tokens. `enters|creature|goblin|t` is engine vocabulary; "a Goblin creature
 *  token entering the battlefield" is the same fact in the reader's language.
 *
 *  IT REUSES `DEMAND_VERB` AND ITS TWO SIBLINGS rather than adding a second vocabulary. That is the
 *  whole argument of this file's own header: a duplicate map is how two surfaces start disagreeing
 *  about what a key means, and the completeness test above walks these maps against `VERB_VOCAB`
 *  directly, so a verb the engine grows tomorrow cannot ship unmapped here either.
 *
 *  THE KEY SHAPE DIFFERS FROM A CENSUS KEY, which is why this is a second function and not a
 *  parameter on `demandSentence`: a census key is `verb:subject` with the subject already folded to
 *  one dimension, while an artifact key keeps type, subtype and the token flag apart -- and the
 *  token flag is a dimension no census key has ever carried.
 *
 *  THE TOKEN FLAG IS SAID ONLY WHEN IT NARROWS. `t` and `n` are real restrictions a reader must
 *  see -- a payoff that wants a token and one that refuses tokens are different cards -- while `-`
 *  means the trigger never mentioned tokens and printing "token or not" would add a word that
 *  changes no meaning. */
/** WHAT A STATIC DOES TO WHAT IT REACHES, as the tail of "a creature …". The kinds `edges.ts`'s
 *  static pass claims; one it has never seen falls through to the kind's own name. */
const STATIC_REACH: Record<string, string> = {
  "pump": "it boosts",
  "cost-reduction": "it makes cheaper to cast",
  "keyword-grant": "it grants abilities to",
  "type-grant": "it grants types to",
  "trigger-doubling": "whose triggers it doubles",
  "damage-multiplier": "whose damage it multiplies",
  "token-doubling": "whose tokens it doubles",
  "protection": "it protects",
};

/** Scryfall's colour letters, as a player says them. */
const COLOUR_WORD: Record<string, string> = { W: "white", U: "blue", B: "black", R: "red", G: "green", C: "colourless" };

const CARD_TYPE_WORDS = new Set(["artifact", "creature", "enchantment", "land", "planeswalker", "instant", "sorcery", "battle", "permanent", "kindred"]);

/** THE EIGHT CARD TYPES A STATIC CAN NAME (CR 205.2a), minus the ones no EDH card carries. A list
 *  covering five or more of them is a way of writing "anything", not a distinction. */
const PERMANENT_TYPES: ReadonlySet<string> = new Set(["artifact", "battle", "creature", "enchantment", "land", "planeswalker"]);

export function eventKeySentence(key: string, subject?: string, colors?: string[]): string {
  const [verb = "", type = "-", subtype = "-", token = "-"] = key.split("|");

  // A phase and a player action carry no subject to glue a noun onto -- the same two escapes
  // `demandSentence` makes, one rung up, and for the same reason.
  if (type === "-" && subtype === "-") {
    const phase = DEMAND_PHASE[verb];
    if (phase) return phase;
    const subjectless = DEMAND_SUBJECTLESS[verb];
    if (subjectless) return subjectless;
  }

  // MELD IS A CARD-NAME RELATION, and the key carries no class at all.
  if (verb === "meld") return "the other half of its meld pair";

  // A STATIC'S REACH IS NOT AN EVENT EITHER. "A creature it boosts" names the class the static
  // applies to; nothing fires, so the sentence is the noun and what the subject does to it.
  if (verb.startsWith("applies:")) {
    const kind = verb.slice("applies:".length);
    const does = STATIC_REACH[kind] ?? `it applies ${kind.replace(/-/g, " ")} to`;
    const nouns = [...(subtype === "-" ? [] : subtype.split(",").map(capitalize)), ...(type === "-" ? [] : type.split(","))];
    // A LIST OF NEARLY EVERY TYPE MEANS "ANYTHING", AND READS AS NOISE. 37 corpus keys enumerate
    // five or more of the eight card types -- "a creature, artifact, enchantment, planeswalker,
    // instant, sorcery or battle it makes cheaper to cast" is 99 characters that say "a spell",
    // and nine of them opened the event picker as nine near-identical rows (measured 2026-09-19).
    // Collapsed to the word the enumeration means; anything shorter still lists its types.
    if (subtype === "-" && type !== "-") {
      const types = type.split(",");
      if (types.length >= 5) {
        const permanentsOnly = types.every((t) => PERMANENT_TYPES.has(t));
        return `a ${permanentsOnly ? "permanent" : "permanent or spell"} ${does}`;
      }
    }
    const head = nouns.length <= 1 ? nouns.join(" ") : `${nouns.slice(0, -1).join(", ")} or ${nouns.at(-1)}`;
    const noun = subtype !== "-" && type !== "-" ? `${capitalize(subtype.split(",")[0]!)} ${type.split(",").join(" or ")}` : head;
    return `${/^[aeiou]/i.test(noun) ? "an" : "a"} ${noun} ${does}`;
  }

  // A BOARD COUNT IS NOT AN EVENT AND HAS NO VERB PHRASE. "Goblins you control" is a standing fact
  // about the board, not something that happens, so the sentence is the noun and the possession --
  // gluing `DEMAND_VERB` onto it would invent an event nothing fires.
  // A FEEDER KEY CARRIES ITS NOUN IN THE SUBTYPE SLOT whether it is a subtype (Goblin) or, since the
  // type-count ruling of 2026-09-09, a card type (artifact). Subtypes are proper nouns; types are not.
  const feederNoun = (n: string): string => CARD_TYPE_WORDS.has(n) ? n : capitalize(n);
  if (verb === "counts") {
    const counted = subtype !== "-" ? feederNoun(subtype) : type !== "-" ? type : "permanent";
    return `${/^[aeiou]/i.test(counted) ? "an" : "a"} ${counted} you control`;
  }
  // THE OTHER TWO FEEDER SHAPES (2026-09-09): a copier wants a KIND of ability, an outlet wants
  // something to EAT. Neither is an event; both read as the thing wanted.
  if (verb === "copies") return `${/^[aeiou]/i.test(subtype) ? "an" : "a"} ${subtype} ability to copy`;
  if (verb === "fodder") {
    const eaten = subtype !== "-" ? feederNoun(subtype) : type !== "-" ? type : "permanent";
    return `${/^[aeiou]/i.test(eaten) ? "an" : "a"} ${eaten} to sacrifice`;
  }
  // A GRAVEYARD FILL WANTS A CARD IN THE YARD (`fills|<type>|<subtype>|-`, partners-core). It is
  // not an event either; the key read raw -- "fills creature" -- over every reanimator group.
  if (verb === "fills") {
    // Both slots set reads as a type line does, "a Goblin creature", the way the trigger nouns do.
    const wanted = [subtype !== "-" ? feederNoun(subtype) : "", type !== "-" ? type : ""].filter(Boolean).join(" ") || "card";
    return `${/^[aeiou]/i.test(wanted) ? "an" : "a"} ${wanted} in a graveyard`;
  }

  const event = DEMAND_VERB[verb];
  // A verb this map has never seen says the true ugly thing rather than inventing a phrase for it.
  if (!event) return deslugify(key.replace(/\|/g, " "));
  // A SELF TRIGGER NAMES THE CARD. "Whenever Burakos attacks" is not "anything attacking", and the
  // key cannot carry the self flag, so the caller hands the noun in.
  if (subject !== undefined) return `${subject} ${event}`;

  const noun = subjectNoun(type, subtype, token, colors);
  return noun === null
    ? `${token === "n" ? "anything that is not a token" : "anything"} ${event}`
    : `${noun.article} ${noun.phrase} ${event}`;
}

/** THE NOUN THE KEY NAMES, shared by every form of the sentence (roadmap AK4). One grammar, so the
 *  label, the clause and the action cannot disagree about what a key is ABOUT -- only about what
 *  happens to it. `null` is "the key names no class", which each form words its own way.
 *
 *  Subtypes are proper nouns in Magic -- a Goblin, not a goblin -- and they qualify the type rather
 *  than replacing it: "a Goblin creature", the way a type line reads.
 *  THE COLOUR THE KEY CANNOT CARRY (owner, 2026-09-08): "a red spell being cast", not "a spell
 *  being cast", when the caller hands the filter in. Two colours read as a choice, which is what a
 *  colour filter means. */
function subjectNoun(
  type: string, subtype: string, token: string, colors?: string[],
): { article: string; phrase: string } | null {
  const list = (raw: string, proper: boolean): string[] =>
    raw === "-" ? [] : raw.split(",").map((m) => proper ? capitalize(m) : m);
  const colour = colors?.length ? [colors.map((c) => COLOUR_WORD[c] ?? c.toLowerCase()).join(" or ")] : [];
  const words = [
    ...list(subtype, true),
    ...colour,
    ...list(type, false),
    ...(token === "t" ? ["token"] : []),
  ];
  if (words.length === 0) return null;
  // A LIST IS A DISJUNCTION, because that is what the key means: `enters|artifact,creature|-|-`
  // fires on an artifact OR a creature, and reading it as "an artifact creature" would be a
  // narrower claim than the card makes.
  const noun = words.length > 1 && (list(subtype, true).length > 1 || list(type, false).length > 1)
    ? oneOfWords(words)
    : words.join(" ");
  // THE ARTICLE AGREES WITH THE FIRST WORD SAID, which is "nontoken" when the flag is set: "an
  // nontoken artifact" was live on every artifact-sacrifice group (2026-09-17).
  const phrase = `${token === "n" ? "nontoken " : ""}${noun}`;
  return { article: /^[aeiou]/i.test(phrase) ? "an" : "a", phrase };
}

/** WHETHER THE RULES' OWN WORD FITS. `dies` is creature-and-token specific (CR 700.4), so the key
 *  may use it only when every type it names is a creature -- a self trigger ("this card dies") is
 *  the card's own, and the caller has already said it is a creature by keying `dies` on it. */
const diesProper = (type: string): boolean =>
  type === "creature" || type === "-" ? type === "creature" : type.split(",").every((t) => t === "creature");

/** THE EVENT AS A CLAUSE: "a creature dies", "a card is drawn", "this card enters the battlefield".
 *
 *  Use it wherever the words sit INSIDE a sentence -- after "when", in a list of what a deck wants
 *  -- and wherever the reader is waiting for the event rather than causing it. `eventKeySentence`
 *  is the label form and reads as a noun; this one reads as English.
 *
 *  It falls back to the label for the shapes that are not events at all: a board count ("a Goblin
 *  you control"), a static's reach, a graveyard fill. Those are standing facts, and conjugating
 *  them would invent an event nothing fires -- the same rule `eventKeySentence` already keeps. */
export function eventKeyClause(key: string, subject?: string, colors?: string[]): string {
  const [verb = "", type = "-", subtype = "-", token = "-"] = key.split("|");

  if (type === "-" && subtype === "-") {
    const phase = DEMAND_PHASE[verb];
    if (phase) return phase;
    const subjectless = SUBJECTLESS_CLAUSE[verb];
    if (subjectless) return subjectless;
  }
  // ONLY A CREATURE DIES (CR 700.4, owner 2026-09-19: "dies describes an event of creature moving
  // from battlefield to graveyard, and it is creature specific"). Everything else is PUT INTO a
  // graveyard, and the engine keys plenty of those: 14 of the 75 `dies` keys name a non-creature
  // type, including `dies|-|-|-` (4,661 suppliers), `dies|artifact|-|-` (1,059) and `dies|land|-|-`
  // (533). "A land dies" is not a sentence the rules can say.
  //
  // A MIXED LIST TAKES THE GENERAL WORDING, because it has to be true of every member: a creature
  // dying IS put into a graveyard, so "an artifact or creature is put into a graveyard" is right
  // for both halves where "dies" is right for only one.
  if (verb === "dies" && !diesProper(type)) {
    const noun = subjectNoun(type, subtype, token, colors);
    // FROM THE BATTLEFIELD, because CR 700.4 is what makes this dying rather than milling or
    // discarding. Without the origin the phrase describes three different events (review finding,
    // 2026-09-19) and the search would read as a graveyard-filler rather than a removal.
    const put = "is put into a graveyard from the battlefield";
    return noun === null ? `a permanent ${put}` : `${noun.article} ${noun.phrase} ${put}`;
  }
  const event = CLAUSE_VERB[verb];
  // No clause form means this is not an event with a subject -- a feeder, a static, a count. The
  // label already words those correctly, so there is nothing to conjugate.
  if (!event) return eventKeySentence(key, subject, colors);
  if (subject !== undefined) return `${subject} ${event}`;
  const noun = subjectNoun(type, subtype, token, colors);
  return noun === null
    ? `${token === "n" ? "anything that is not a token" : "anything"} ${event}`
    : `${noun.article} ${noun.phrase} ${event}`;
}

/** WHAT A CARD DOES, IN A PLAYER'S WORDS: "draw a card", "sacrifice a creature", "kill a creature".
 *
 *  `undefined` when the event has no actor -- nothing makes "a creature attack" the way it makes
 *  one die -- and the caller falls back to the clause. Inventing a verb for every key would give
 *  every row a phrase and give some of them a lie. */
export function eventKeyAction(key: string, colors?: string[]): string | undefined {
  const [verb = "", type = "-", subtype = "-", token = "-"] = key.split("|");

  // AN OUTLET EATS SOMETHING, and "sacrifice a creature" is the phrase a player uses for it. The
  // feeder key is the one shape whose LABEL is already about the action ("a creature to sacrifice").
  if (verb === "fodder") {
    // A FODDER KEY IS A DEMAND, AND THE CAUSING SIDE IS THE ONE THAT FEEDS IT (owner-reported
    // 2026-09-19, on the deployed site). `fodderDemandsOf` says what a sacrifice OUTLET eats, so
    // the cards that SUPPLY the key are the ones providing the meal -- Staff of Titania and Awaken
    // the Woods make land tokens, and "sacrifice a land" described the outlet instead of them.
    // Searching "sacrifice a land" returned eight cards, not one of which sacrifices a land.
    //
    // THE FEEDER NOUN RULE, not the trigger one: a card TYPE sitting in the subtype slot (the
    // type-count ruling of 2026-09-09) is not a proper noun, so "a creature" and "a Goblin" are
    // both right and "a Creature" is not.
    const eaten = subtype !== "-"
      ? (CARD_TYPE_WORDS.has(subtype) ? subtype : capitalize(subtype))
      : type !== "-" ? type : "permanent";
    return `provide ${/^[aeiou]/i.test(eaten) ? "an" : "a"} ${eaten} to sacrifice`;
  }
  // A static names a CLASS, and its suppliers are the members of that class. See the note above.
  if (verb.startsWith("applies:")) return undefined;
  if (type === "-" && subtype === "-") {
    const whole = SUBJECTLESS_ACTION[verb];
    if (whole) return whole;
  }
  const action = ACTION_VERB[verb];
  if (!action) return undefined;
  const noun = subjectNoun(type, subtype, token, colors);
  // A FILL'S OBJECT IS A CARD when the key names no type, the same known object `mill` and
  // `discard` have: you put a CARD into a graveyard, not "anything".
  const object = noun === null
    ? (verb === "fills" ? "a card" : DEFAULT_OBJECT[verb] ?? "anything")
    : `${noun.article} ${noun.phrase}`;
  // `put ONTO the battlefield` -- the object belongs inside the phrase, not after it.
  const around = action.match(/^(.*)\b(ONTO|INTO)\b(.*)$/);
  return around
    ? `${around[1]}${object} ${around[2]!.toLowerCase()}${around[3]}`
    : `${action} ${object}`;
}

/** WHAT A PLAYER TYPES, AGAINST WHAT THE ENGINE CALLS IT (roadmap AK4, owner-reported: searching
 *  "sacrifice token" found nothing, and so did "dies", "etb" and "tutor").
 *
 *  Three faults were stacked. The match was a raw substring, so word ORDER decided it. It was
 *  literal, so "dies" missed "dying" and "draw" missed "drawn". And no amount of either turns
 *  "etb" into "entering the battlefield" -- that needs saying out loud, which is what this map is.
 *
 *  Kept deliberately small and only for terms a player would actually type at a search box. A
 *  synonym that reaches the wrong event is worse than one that is missing, because the reader has
 *  no way to see that it went wrong. */
const PLAYER_TERMS: Record<string, string[]> = {
  etb: ["enters"],
  "enters the battlefield": ["enters"],
  blink: ["leaves", "enters"],
  flicker: ["leaves", "enters"],
  bounce: ["leaves"],
  sac: ["fodder", "sacrifice"],
  "sac outlet": ["fodder"],
  "death trigger": ["dies"],
  deathtrigger: ["dies"],
  removal: ["dies"],
  // DESTROY AND KILL ARE HOW A PLAYER ASKS FOR THIS, and neither is what the key MEANS (owner,
  // 2026-09-19: "kill is not a word in magic, you have destroy"). CR 700.4 defines `dies` as
  // going to the graveyard from the battlefield; CR 701.7 defines `destroy` as one way that
  // happens, and a sacrificed creature dies without being destroyed. The suppliers of this key do
  // both -- Come Back Wrong destroys, Victimize sacrifices -- so the label stays the rules word
  // and these two only find it.
  destroy: ["dies"],
  kill: ["dies"],
  landfall: ["enters"],
  tutor: ["search"],
  "card draw": ["draw"],
  cantrip: ["draw"],
  "self mill": ["mill"],
  selfmill: ["mill"],
  reanimate: ["fills", "enters-graveyard"],
  reanimator: ["fills"],
  graveyard: ["fills", "enters-graveyard"],
  yard: ["fills", "enters-graveyard"],
  counters: ["counter-added"],
  "+1/+1": ["counter-added"],
  lifegain: ["gain-life"],
  drain: ["lose-life"],
  ping: ["non-combat-damage"],
  "combat trigger": ["attacks"],
  aristocrats: ["fodder", "dies"],
};

/** A CRUDE STEM, and deliberately crude: it has to make "dies" find "dying" and "draw" find
 *  "drawn" without a stemmer library, over a vocabulary of about sixty verbs. Trailing inflections
 *  come off, and three irregular pairs the maps actually contain are named. */
const STEM_PAIRS: Record<string, string> = { dies: "die", dying: "die", died: "die", drawn: "draw", cast: "cast", milled: "mill", milling: "mill" };
const stem = (word: string): string =>
  STEM_PAIRS[word] ?? word.replace(/(ing|ed|es|s)$/, "").replace(/([^aeiou])\1$/, "$1");

/** Does this event answer what the reader typed? Every typed word must hit SOMETHING -- the label,
 *  the clause, the action or a synonym -- so extra words narrow rather than widen. */
export function eventMatches(key: string, query: string): boolean {
  const typed = query.toLowerCase().split(/\s+/).filter((w) => w.length > 0);
  if (typed.length === 0) return true;
  const verb = key.split("|")[0] ?? "";
  const synonyms = Object.entries(PLAYER_TERMS)
    .filter(([, verbs]) => verbs.some((v) => verb === v || verb.startsWith(`${v}:`)))
    .map(([term]) => term);
  const haystack = [eventKeySentence(key), eventKeyClause(key), eventKeyAction(key) ?? "", ...synonyms]
    .join(" ").toLowerCase();
  const words = new Set(haystack.split(/[^a-z0-9+/]+/).filter(Boolean).map(stem));
  const whole = haystack;
  // A typed word counts when it stems onto a WORD of the phrase. The substring fallback exists
  // only for what cannot be a word -- "+1/+1" -- and for a multi-word synonym typed whole ("sac
  // outlet"): applying it to every word made "token" match "nontoken", which is the opposite
  // event, and rank it above the row the reader meant.
  const odd = (w: string): boolean => /[^a-z]/.test(w);
  return typed.every((w) => words.has(stem(w)) || (odd(w) && whole.includes(w)))
    || whole.includes(query.toLowerCase().trim());
}

/** "artifact, creature or enchantment" -- the same joining `demandSentence` does inline, kept here
 *  because two callers now need it and a second copy of a comma rule is a second thing to get
 *  wrong. */
const oneOfWords = (members: string[]): string => {
  const rest = [...members];
  const last = rest.pop()!;
  return rest.length > 0 ? `${rest.join(", ")} or ${last}` : last;
};
