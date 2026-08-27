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
