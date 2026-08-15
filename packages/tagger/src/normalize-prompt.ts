import type { Clause } from "./segment.js";

/** Bump when ANYTHING that determines the request changes: SYSTEM, VERBS, TRIGGERS, ZONES — and
 *  `segment.ts`, because the segmenter decides which clauses exist and what ids they carry.
 *
 *  That last one is not obvious and is easy to get wrong: `segmentHash` covers the card's INPUTS
 *  (oracle text, type line, keywords), not the segmenter's behaviour. So a segmenter change alters
 *  the clause list while the hash stays identical, and without a version bump every persisted doc
 *  would look fresh forever and never re-queue. Multi-face handling changed exactly that way.
 *
 *  This version IDENTIFIES the prompt. It no longer decides what is stale — see
 *  NORMALIZE_MIN_COMPATIBLE — so bumping it alone is free, and every persisted doc still records
 *  exactly which prompt produced it. */
export const NORMALIZE_VERSION = 10;

/** The oldest prompt whose answers are still valid. `needsNormalize` re-queues a card only when its
 *  stored version is BELOW this, so a mixed-version corpus is a stated condition rather than an
 *  accident.
 *
 *  Raise this ONLY for a BREAKING change — prompt prose, a changed rule, a segmenter change that
 *  moves clause ids — because raising it re-buys the whole corpus (~$8.50 at 2,453 cards). An
 *  ADDITIVE change (a new verb, a new trigger member) leaves it alone: a new verb only widens what
 *  the model MAY say, so an answer given without the option is still correct. Pick up the addition
 *  cheaply with `normalize-corpus.ts --refresh-other` instead of re-buying everything.
 *
 *  3 is the version the calibration corpus was bought at. */
export const NORMALIZE_MIN_COMPATIBLE = 3;

/** The NORMALIZE_VERSION at which the closed VOCABULARIES (VERBS, TRIGGERS, ZONES) last changed.
 *  **Bump this ONLY when one of those lists changes** — never for a prose rule.
 *
 *  `carriesOther` exists because an ADDITIVE vocabulary change can improve a card stuck on the escape
 *  hatch. A change to the prompt's PROSE cannot: the card said `other` because no verb covered its
 *  action, and it will say `other` again. Keying the refresh on NORMALIZE_VERSION alone made every
 *  prose fix reopen the whole `carriesOther` set — on 2026-08-06 a one-line rule about trigger
 *  subjects selected 158 cards, of which 148 had been bought hours earlier at v8 and would come back
 *  identical. Priced at $0.69 to fix 9 cards. With this the same run selects 10 and costs $0.02. */
export const VOCAB_VERSION = 10;

/** The NORMALIZE_VERSION at which **TRIGGERS** last changed, tracked apart from VOCAB_VERSION.
 *
 *  One constant for all three lists is the `--refresh-other` treadmill wearing a different hat. A
 *  TRIGGERS-only change cannot improve a card stuck on an `other` ACTION — the verb it needed still
 *  does not exist — so selecting those cards buys back identical answers and a bill. Measured on
 *  this very batch: one shared constant priced 182 cards at $0.78, of which ~140 were `other`-action
 *  cards that VERBS did not change for. Split, the same batch is the trigger-stuck cards alone.
 *
 *  Same shape as the 2026-08-06 finding this file already records for prose-vs-vocabulary, applied
 *  one level finer: gate each selector on the list it actually reads. */
export const TRIGGER_VOCAB_VERSION = 10;

export const VERBS = ["destroy", "exile", "sacrifice", "tap", "untap", "draw", "discard", "mill", "search",
  "put", "return", "create", "counter-spell", "copy", "gain-life", "lose-life", "deal-damage",
  "add-mana", "add-counter", "remove-counter", "grant-ability", "modify-pt", "prevent", "cast",
  "play", "shuffle", "reveal", "attach", "transform", "trigger-again", "extra-turn", "extra-combat",
  "animate", "cant", "emblem", "fight", "set-life", "proliferate", "scry", "surveil", "cost-modify",
  // Each of these had a card stuck behind it: amass (Orcish Bowmasters), turn-face-up (Cyber
  // Conversion, Ugin's Mastery), extra-phase (Cyclonus). The gate refused the whole card rather
  // than one clause, so a missing verb cost 100% of the card.
  "amass", "turn-face-up", "extra-phase",
  // CR 701 KEYWORD ACTIONS, added 2026-08-15 for COMPLETENESS rather than for current demand —
  // normalization is a one-way ratchet and nobody re-runs 36k cards to add a word. The 69 actions in
  // CR 701 were reconciled by hand against this list; these are the ones it did not carry.
  //
  // Adding the keyword does NOT cost the primitives. `EMITS` in derive/emits.ts expands each one
  // into the events the Comprehensive Rules say it IS — connive and recruit into draw+discard,
  // bolster into a +1/+1 counter — so the clause records the card's own word and the matcher still
  // sees ordinary events. That was the owner's correction to an earlier draft of this list, which
  // had proposed leaving out any keyword whose primitive was already expressible.
  //
  // Expanded in EMITS (the rules give them a primitive):
  "connive", "recruit", "bolster", "support", "adapt", "monstrosity", "blight", "investigate",
  "populate", "incubate", "manifest", "discover", "meld", "cloak", "manifest-dread", "earthbend",
  // Recorded but emitting NOTHING, because the rules give them no event to emit: a status
  // (goad 701.15, detain 701.35, suspect 701.60, harness 701.64, exert 701.43), a replacement
  // effect (regenerate 701.19), library manipulation nobody triggers on (clash 701.30,
  // fateseal 701.29, behold 701.4), damage removal (heal 701.69), or a player choice
  // (vote 701.38). They still earn a word: without one the model answers `other` and the clause
  // is lost whole, which is how 38 trigger clauses ended up on the escape hatch.
  // (meld moved to the expanded group above on a re-read: 701.42a puts cards onto the battlefield.)
  //
  // REGENERATE IS A REPLACEMENT EFFECT AND EMITS NOTHING, which a first pass got wrong by reading
  // 701.19a too literally: "instead remove all damage marked on it and its controller TAPS IT" is
  // not a tap that happens when you regenerate. Regenerating puts up a SHIELD; the tap happens later
  // and only if a destruction is actually attempted — and only destruction, never sacrifice. An
  // action that creates a replacement effect emits nothing at the time it is performed, the same
  // reason connive's conditional counter is omitted. 428 corpus cards, and an unconditional `taps`
  // on all of them would have been a wrong sentence on every one that never got destroyed.
  "goad", "regenerate", "exert", "detain", "suspect", "harness", "vote", "clash", "fateseal",
  "behold", "heal", "exchange", "convert", "double", "triple",
  // CONDITIONAL, so recorded with no emit rather than a guessed one: explore (701.44, land to hand
  // OR a counter), endure (701.63, a token XOR counters), learn (701.48, discard-then-draw OR
  // fetch a Lesson), forage (701.61, sacrifice a Food OR exile three cards), time travel (701.56,
  // add OR remove time counters), collect evidence (701.59, exile from a graveyard).
  "explore", "endure", "learn", "forage", "time-travel", "collect-evidence",
  // Found only by COMPUTING the CR 701 diff rather than eyeballing it — the hand reconciliation
  // claimed completeness and had missed nine. `venture-into-the-dungeon` (701.49) moves a marker,
  // `face-a-villainous-choice` (701.55) is a choice wrapper and `waterbend` (701.67) is an
  // alternative way to pay a cost, so none of the three has an event. `airbend` (701.65) EXILES the
  // objects, and `exile` itself carries no emit row today, so it follows that existing decision
  // rather than inventing a new one. `ring-tempts` is already a TRIGGER word; it is an action too.
  "venture-into-the-dungeon", "face-a-villainous-choice", "waterbend", "airbend", "ring-tempts",
  // CR 706 and 705. `roll-dice` expands to a `dice-rolled` event; `flip-coin` gets no emit, because
  // no corpus card triggers on another card's flip — a flip is self-contained.
  "roll-dice", "flip-coin",
  // DESIGNATIONS the game itself can hold, each its own CR section, and keywords are only one axis
  // of the dictionary. `monarch` (725) and `day-night` (731) went in above; these were missed.
  // `initiative` is CR 726 and `city-blessing` is what Ascend (702.131) grants.
  "initiative", "city-blessing",
  "other", "none"];
/** Terms whose EXEMPLARS join the normalization scope, so a vocabulary addition is exercised on real
 *  cards instead of sitting untested until someone happens to play one.
 *
 *  The calibration corpus is 71 decks and covers only the mechanics the owner already plays, so a
 *  word added for completeness (the ratchet argument — see CLAUDE.md) would otherwise never appear in
 *  a single clause. A handful of cards per term is enough to prove the expansion in `EMITS` produces
 *  the events the Comprehensive Rules say it should.
 *
 *  Every term here is a word this vocabulary gained on 2026-08-15. Trigger words are included too:
 *  `copy` is the reason any of this happened. */
export const EXEMPLAR_TERMS = [
  // Keyword actions the rules give a primitive, so the expansion is testable.
  "connive", "recruit", "bolster", "support", "adapt", "monstrosity", "blight", "investigate",
  "populate", "incubate", "manifest", "discover", "meld", "cloak", "manifest-dread", "earthbend",
  // Keyword actions that emit nothing — the test is that the CLAUSE survives rather than falling to
  // `other`, which is the whole reason they earned a word.
  "goad", "regenerate", "exert", "detain", "suspect", "vote", "clash", "fateseal", "behold", "heal",
  "explore", "endure", "learn", "forage",
  // Trigger words.
  "becomes blocked", "cycle", "mutates", "monstrous", "commits a crime", "expend", "descended",
  "copy a spell", "rolls a", "becomes the monarch", "Ring tempts",
] as const;

export const ZONES = ["battlefield", "graveyard", "hand", "library", "exile", "stack", "command"];
export const TRIGGERS = ["enters", "dies", "leaves", "attacks", "blocks", "taps", "untaps", "cast",
  "upkeep", "begin-combat", "end-step", "draw", "draw-step", "main-phase", "combat-damage-step", "damage-dealt", "life-gained", "life-lost",
  "counter-added", "sacrificed", "discarded", "milled", "turned-face-up", "level-up", "chapter",
  "proliferate",
  // Named because the corpus named them: an opponent searching (Archivist of Oghma), becoming a
  // target (Unsettled Mariner), scry or surveil (Matoya), a Room unlocking (Mirror Room). None has
  // an engine verb, so they form no edges and surface in `unknownTriggers` — the point is that one
  // unnameable clause no longer throws away the whole card.
  "search", "becomes-target", "scry", "surveil", "unlocked", "transform",
  // ADDED 2026-08-15 from two sweeps that disagreed with each other, which is why both were run.
  // `bin/trigger-vocab-gaps.ts` reads what the clause layer NEEDED and could not say — 38 trigger
  // clauses answered `other`; `bin/cr-vocab-sweep.ts` reads what the GAME defines, from the
  // Comprehensive Rules. Each word below is followed by its rule (where the CR names it) and the
  // count of derived-corpus cards that reach for it.
  //
  // `copy` is the one that started this: CR 707, already a legal VERBS member as an ACTION, missing
  // from TRIGGERS — so Parnesse, the Subtle Brush ("whenever you copy a spell") answered `cast`, and
  // when a re-ask finally said `copy` the persist gate refused it for not being in this list. 2.
  "copy",
  // CR 700.13. "Whenever you commit a crime" — Gisa, Magda, Duelist of the Mind, Patrolling
  // Peacemaker. Found by BOTH sweeps. 4.
  "crime",
  // CR 700.14. "Whenever you expend N" — Muerra, Trailtracker Scout, Wandertale Mentor. Both. 3.
  "expend",
  // CR 700.11. A permanent card hit your graveyard this turn. CR-only — the corpus sweep never
  // surfaced it, because these cards phrase it as a condition rather than a trigger. 2.
  "descended",
  // Corpus-only, each with a card stuck behind it and each a named CR concept in a section the
  // vocabulary diff does not reach: day/night (CR 730, The Celestus), dice (Vrondiss), dungeons
  // (CR 309, Loot Dispute), the monarch (CR 720, Starscream), the Ring (Sauron, Call of the Ring),
  // clash (CR 701.30, Marvo).
  "day-night", "dice-rolled", "dungeon-completed", "monarch", "ring-tempts", "clash",
  // THE REST OF THE TURN, from CR 500-514. A turn is five phases and eleven steps; this list had six
  // of them. The beginning phase is untap/upkeep/draw (501.1) and combat is beginning of combat /
  // declare attackers / declare blockers / combat damage / end of combat (506.1), with cleanup
  // closing the ending phase. Nothing EMITS a phase — the turn supplies it — so these form no edges
  // by design; their value is that an ability's own emits survive with honest timing.
  "untap-step", "declare-attackers", "declare-blockers", "end-of-combat", "cleanup",
  "initiative", "city-blessing",
  // FOUND ONLY BY THE WHOLE-CORPUS CENSUS (`bin/corpus-trigger-census.ts`), and each is bigger than
  // every word above COMBINED. Owner's ruling 2026-08-15: the vocabulary serves any deck someone
  // brings, not the 71 calibration decks, so demand is counted over all ~34k cards. Ranking on the
  // derived corpus would have shipped the small words and missed these two entirely.
  //
  // "Whenever this creature becomes blocked" — 164 cards. The ATTACKER's side; `blocks` is the
  // blocker's and does not cover it.
  "becomes-blocked",
  // "When you cycle this card" — 91 cards. The cycling EMIT shipped 2026-08-14; the trigger side
  // never had a word, so a cycling payoff could not say what it watches.
  "cycled",
  // 32 and 18 cards. Both are printed events with no other spelling available.
  "mutates", "becomes-monstrous",
  // DELIBERATELY EXCLUDED, so the next reader does not "complete" the list: Planechase
  // (chaos ensues / planeswalk, 238 cards), Archenemy (scheme, 84) and Contraptions (crank, 45) are
  // the largest residue families in the corpus and NONE of them is an EDH event — no plane, scheme
  // or contraption is ever in a decklist. `specializes` (42) is Alchemy-only and digital.
  // The same escape hatch VERBS has always had. Its absence was pure asymmetry: the model, told to
  // pick EXACTLY one member, invented "other" anyway on 9 cards and lost all of them.
  "other",
  "none"];

export const SYSTEM = `You NORMALIZE Magic: The Gathering rules text. You do not classify, rate, or interpret it.

You are given a card's clauses, already numbered. Answer EVERY clause id exactly once, in order.
Never merge clauses, never split one, never invent an id — with one stated exception, a clause
marked twoConditions, described in the rules below.

The clause list already carries type= and cost= where they apply. Do NOT re-decide them; copy
type= into abilityType verbatim.

For each clause return:
{ "id": number,
  "abilityType": copied from type=, or "none" for keyword/reminder clauses,
  "trigger": { "event": TriggerEvent, "subject": string, "control": "you"|"opponent"|"any" },  // omit if not triggered
  "actions": [ { "verb": Verb, "object": string, "fromZone": Zone|null, "toZone": Zone|null,
                 "amount": string|null, "optional": boolean } ] }

Verb is EXACTLY one of: ${VERBS.join(", ")}
Zone is EXACTLY one of: ${ZONES.join(", ")}
TriggerEvent is EXACTLY one of: ${TRIGGERS.filter((t) => t !== "none").join(", ")}

Rules:
- Record what the clause SAYS. "Destroy target creature" is verb "destroy" — never a category
  like "removal" and never a strategic label.
- fromZone/toZone are set ONLY when the clause MOVES an object between zones. Getting this right
  matters more than anything else: "search your library ... put it onto the battlefield" is
  library->battlefield, but "... put it into your hand" is library->hand. They are different cards.
- Every clause you are shown states a game action; inert clauses are not sent to you.
- OMIT the trigger field entirely when the clause is not triggered. Do not send trigger:null and
  do not send event:"none" — one fact must have exactly one encoding, or two runs disagree over
  nothing. (This ambiguity alone accounted for every residual disagreement in the first run.)
- "trigger-again" is for effects that make a triggered ability trigger an additional time.
- COSTS are already decided for you. A clause showing costActions=[...] contributes exactly those
  actions FIRST, verbatim, then the actions of its effect. A clause with a cost= but no
  costActions contributes none from the cost — paying mana and tapping the source are not things
  any card triggers on. Never infer a cost action yourself.
- ZONES. Set fromZone/toZone for EXACTLY these five verbs and no others: put, return, exile,
  search, cast. Their zones genuinely vary — "put onto the battlefield" and "put into your hand"
  are different cards. Every other verb already fixes its own zones: a draw is always
  library->hand, a mill always library->graveyard, a discard always hand->graveyard, a sacrifice
  always battlefield->graveyard. Recording those makes two runs disagree over a fact neither
  chose. Leave them null.
  Those verbs already imply where they happen; recording it twice makes two runs disagree over
  nothing. "create" is the one exception you may be tempted by — a token entering is implied by
  the verb, so leave its zones null.
- A TRIGGER'S SUBJECT IS WHAT THE EVENT HAPPENED TO, not who did it. "Whenever you cast a
  noncreature spell" has subject "a noncreature spell" and control "you" — NOT subject "you". The
  control field already records the player; putting them in the subject too loses the only part
  another card can match on. When the trigger names no thing beyond the bare umbrella ("whenever you
  cast a spell", "whenever you draw a card", "whenever you attack"), a player subject is right.
- ORIGIN ZONES IN A TRIGGER. When the trigger says WHERE the event came from, keep that phrase in
  the subject verbatim: "another permanent enters from a graveyard", "a spell from your hand",
  "a Dragon creature spell from your graveyard". It is the whole card — River Kelpie without it
  triggers on every permanent that enters, not on reanimation. Do NOT add an origin the text does
  not state, and do not keep "from anywhere": it means the same as saying nothing.
- "Enters tapped" is a property of entering, not an action: record it as verb "tap" with object
  "this", so the fact survives without inventing a second entry event.
- List one action per game action the clause states, in the order written.
- "cant" is for restrictions ("can't attack", "can't be countered"); put the restriction in object.
- "animate" is a permanent BECOMING a creature ("becomes a 0/0 Elemental creature", man-lands,
  Ensoul Artifact). Do not reach for transform, modify-pt or grant-ability for this — transform is
  only for a double-faced card turning over.
- "put a counter on" is ALWAYS add-counter, never put. The verb "put" is exclusively for moving an
  object between zones ("put it onto the battlefield", "put it into your hand").
- Three pairs that have been observed swapping; the rule for each:
  * A COUNTER of any kind (+1/+1, loyalty, lore, indestructible, stun) is always add-counter with
    the kind in object — never "other", even for an unusual counter.
  * "becomes a creature" is animate. "transform" is ONLY a double-faced card turning over.
  * An effect that makes an ability trigger an extra time is trigger-again; an effect that makes a
    TOKEN is create. Copying a permanent is copy. These are three different things.
- EFFECT ACTIONS are already decided for you too. A clause showing effectActions=[...] states
  those actions; include every one of them, then add any other action the clause states. They were
  read off the text mechanically, so do not drop one, rename one, or replace one with "other".
  An entry written verb=N carries the amount: copy N into that action's "amount" field.
- "emblem" is getting an emblem. It is NOT "create" — create is for tokens, and an emblem is
  neither a permanent nor a card. The ability the emblem grants is a separate clause of its own.
- "fight" is two creatures dealing damage equal to their power to each other.
- "set-life" is a life total being SET to a number ("target opponent's life total becomes 10").
  It is not lose-life or gain-life: how much changes depends on the total it started from.
- A REPLACEMENT effect is STATIC and has NO trigger. "If a creature would die, instead exile it",
  "this permanent enters with a counter on it", "if you would draw, draw two instead", and "untap
  this during each other player's untap step" all modify how something happens rather than reacting
  to it. Do not record "dies", "enters" or "untaps" for these — a replacement effect that acquires
  an event becomes a payoff for every card that causes it, which is false.
- A permanent PUT INTO A GRAVEYARD from the battlefield is the event "dies", whatever the wording.
  "Whenever an enchantment you control is put into a graveyard from the battlefield" is "dies".
- A clause marked twoConditions fires on TWO different events ("When this enters OR is put into a
  graveyard", "When this enters AND whenever you fully unlock a Room"). One record holds one
  trigger, so answer that clause with TWO records: the first keeps the clause's id, the second takes
  an id LARGER THAN EVERY id in the list you were shown, and both repeat the same actions. Do not
  reuse the number of another clause — Brinelin and Titans' Vanguard both numbered the overflow as
  the next sequential id, which was already a printed keyword, and the whole card was refused. Only a clause marked twoConditions may be
  answered this way, and only with one extra record.
- A TriggerEvent of "other" is the same escape hatch for a trigger no event above names ("whenever
  you choose a Ring-bearer"): use it and put the event verbatim in the trigger's subject. Never
  force a near-miss event — a wrong event forms false edges with every payoff for the real one.
- "other" is the deliberate escape hatch: when a clause does something no verb above covers
  (changing maximum hand size, an unusual rules modification), use verb "other" and put the effect
  verbatim in object. Use it rather than forcing a near-miss verb — a wrong verb is consumed as if
  it were true, while "other" is honestly inert.
Return ONLY { "clauses": [ ... ] }.`;

/** The numbered clause list handed to the model. */
export function listClauses(clauses: Clause[]): string {
  return clauses.map((c) =>
    `${c.id}. [${c.kind}${c.marker ? ` ${c.marker}` : ""}]` +
    `${c.abilityType ? ` type=${c.abilityType}` : ""}${c.multiTrigger ? " twoConditions" : ""}` +
    `${c.cost ? ` cost="${c.cost}"` : ""}` +
    `${c.costActions ? ` costActions=[${c.costActions.join(",")}]` : ""}` +
    `${c.effectActions ? ` effectActions=[${c.effectActions.join(",")}]` : ""} ${c.text}`).join("\n");
}
