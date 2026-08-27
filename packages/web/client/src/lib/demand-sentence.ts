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
 *  would use, for every verb `@mtg/tagger`'s `VERB_VOCAB` can put in a consumer's trigger EXCEPT
 *  the three `availability.ts` calls `PHASE_VERBS` (those live in `DEMAND_PHASE` below, because a
 *  phase carries no subject to glue this onto) AND the five `DEMAND_SUBJECTLESS` below (a player
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
  dies: "dying",
  leaves: "leaving the battlefield",
  cast: "being cast",
  attacks: "attacking",
  taps: "becoming tapped",
  untaps: "untapping",
  "non-combat-damage": "dealing noncombat damage",
  "combat-damage": "dealing combat damage",
  discard: "being discarded",
  mill: "being milled",
  sacrifice: "being sacrificed",
  "create-token": "being created",
  "counter-added": "getting a counter",
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

/** Player actions, not permanent events — the CR pins each of these five to the CONTROLLER
 *  (CLAUDE.md's own list of controller-only verbs: draw · mill · discard · sacrifice · search ·
 *  scry · surveil · add-mana · create · gain-life · lose-life; the other six in that list stay in
 *  `DEMAND_VERB` because their PASSIVE reading — "a card being milled/discarded", "a permanent
 *  being created/sacrificed" — is true of the object no matter who acts on it). None of these five
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
  // check above, one rung down (the subject slot always resolves to "any" for these five, since
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
  meld: "melding",
  "land-condition": "needing a basic type",
  clone: "copying a permanent",
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
 *  ability"), which is a different grammar from a legend LABEL, and no subpath of `@mtg/matcher` is
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
