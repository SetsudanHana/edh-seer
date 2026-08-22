/** THE ONE PLACE A REASON SENTENCE IS BUILT.
 *
 *  It used to be six sites inside edges.ts, each assembling its own string, which is why the same
 *  pair could read two different ways on two tabs (skeptic persona, 2026-08-20).
 *
 *  The vocabulary this replaces was the ENGINE'S, not Magic's: "supplies it" appeared in both the
 *  precon player's and the deck tuner's unknown-word lists on the same day. */

/** kind -> [with amount, without amount]. A kind absent here yields null, which is rung 3 of the
 *  ladder: we say the payoff triggers and claim nothing about what it does. */
const PHRASES: Record<string, [(n: string) => string, string]> = {
  "draw-card": [(n) => `draws you ${n} card${n === "1" ? "" : "s"}`, "draws you cards"],
  drain: [(n) => `drains for ${n}`, "drains each opponent"],
  lifegain: [(n) => `gains you ${n} life`, "gains you life"],
  damage: [(n) => `deals ${n} damage`, "deals damage"],
  "player-life-loss": [(n) => `costs each opponent ${n} life`, "costs each opponent life"],
  "counter-placement": [(n) => (n === "1" ? "puts a counter on it" : `puts ${n} counters on it`), "puts counters on it"],
  "token-generation": [(n) => (n === "1" ? "makes a token" : `makes ${n} tokens`), "makes a token"],
  "mana-generation": [(n) => `adds ${n} mana`, "adds mana"],
  "graveyard-recursion": [() => "brings a card back", "brings a card back"],
  pump: [(n) => `gives +${n}/+${n}`, "makes your creatures bigger"],
  "cost-reduction": [(n) => `costs ${n} less`, "costs less"],
};

export function effectPhrase(kind: string | undefined, amount: string | undefined): string | null {
  if (!kind) return null;
  const entry = PHRASES[kind];
  if (!entry) return null;
  const [withAmount, without] = entry;
  return amount ? withAmount(amount) : without;
}

/** verb -> third-person verb phrase ("<producer> <phrase>" must read as English), keyed on the verb
 *  half of a zone-event key alone — the subject/type half is discarded here, because the cause
 *  names the PRODUCER CARD, never its class.
 *
 *  This SUPERSEDES a defect `humanizeEvent` (edges.ts, deleted once this module took over every
 *  call site) once had to carry two fixes for. `leaves` and `taps` had no case in its switch and
 *  fell through to a raw de-slugify default, shipping "triggers on leaves any" / "taps creature" to
 *  the web UI as English — fixed there by giving each its own case ("leaving the battlefield",
 *  "becoming tapped"), which is why they read that way here too. And a `dies` event is any
 *  permanent LEAVING THE BATTLEFIELD, not only a creature; that function hardcoded "a creature
 *  dying" for every one, rendering Scrap Trawler's `dies:creature` and `dies:artifact` reasons —
 *  fed by the same sac outlet — as identical lines (an artifact told to the reader as a creature).
 *  The fix there was to read the subject out of the KEY into the prose; the fix here is that the
 *  prose no longer needs it at all — the two rows still carry distinct TAGS (`claimCount`/
 *  `dedupeReasons` key on tag, so nothing collapses), and a reader does not need to be told which of
 *  Scrap Trawler's two typed triggers fired, only that Executioner's Capsule caused a death and
 *  Scrap Trawler responded to it. */
// Exported only so a completeness test can walk it against @mtg/tagger's VERB_VOCAB -- this table
// grows every time this project adds a verb, and the naive fallback below is wrong for every
// noun-shaped one, so a forgotten entry must fail a test rather than ship silently.
export const VERB_PHRASES: Record<string, string> = {
  enters: "enters",
  "enters-graveyard": "hits the graveyard",
  dies: "dies",
  leaves: "leaves the battlefield",
  cast: "is cast",
  attacks: "attacks",
  taps: "becomes tapped",
  untaps: "untaps",
  "counter-added": "gets a counter",
  "gain-life": "gains life",
  "lose-life": "makes a player lose life",
  sacrifice: "sacrifices something",
  "create-token": "makes a token",
  proliferate: "proliferates",
  // The rest of VERB_VOCAB: nouns wearing a verb's job, where "verb + s" reads as nonsense
  // ("combat-damages", "land-plays", "dice-rolleds").
  "combat-damage": "deals combat damage",
  "non-combat-damage": "deals noncombat damage",
  draw: "draws a card",
  discard: "discards a card",
  mill: "mills a card",
  "land-play": "plays a land",
  "dice-rolled": "rolls a die",
  // Phase triggers. Nothing in the corpus ever EMITS these (no card supplies your upkeep — see
  // CLAUDE.md, VERB_VOCAB), so a producer's eventKey should never carry one; kept for completeness
  // rather than left to the ungrammatical naive fallback below.
  upkeep: "reaches its upkeep",
  "begin-combat": "enters combat",
  "end-step": "reaches the end step",
};

/** Turn a zone-event key ("enters:creature", "dies:artifact") into the verb phrase that follows a
 *  card's name. Unlike `humanizeEvent`, the subject half is dropped: the sentence names the
 *  PRODUCER CARD as the cause, not a class of card, so "a creature" would be redundant at best and
 *  wrong once the class doesn't describe the actual producer (an artifact creature dying still
 *  satisfies `dies:creature`). ponytail: a verb this map has never seen gets `verb + "s"`, which is
 *  wrong for the noun-shaped verbs above but is why they are all listed explicitly instead. */
export function eventVerbPhrase(key: string): string {
  const verb = key.split(":")[0] ?? key;
  return VERB_PHRASES[verb] ?? `${verb.replace(/-/g, " ")}s`;
}

/** Cause first: what happens, then what it does for you.
 *
 *  `self` means the CONSUMER watches its own event and the producer is what makes that event
 *  happen (Eldrazi Confluence blinking Solemn Simulacrum, which then draws a card) — so the cause
 *  names the consumer as the thing the event happens to, not the producer.
 *
 *  The `eventKey`'s TAG is deliberately not changed to match `self` — `themeSubjectKey` (edges.ts)
 *  ignores `subject.self`, so a card watching only its own entry still keys `enters:any`, the same
 *  tag a card watching ANY permanent enter would carry. That tag is the panel's join key, and
 *  re-keying it to reflect `self` would detach every cached verdict on these pairs to fix a
 *  rendering question — the trade `DERIVE_VERSION` 31 already refused once, keeping judging debt at
 *  0 through the umbrella work. Only the PROSE is self-aware; the tag stays coarse on purpose. */
export function reasonSentence(input: {
  producer: string; consumer: string; eventKey: string;
  effectKind?: string; amount?: string; self?: boolean;
}): string {
  const verb = eventVerbPhrase(input.eventKey);
  const phrase = effectPhrase(input.effectKind, input.amount);
  if (input.self) {
    const effect = phrase ? `it ${phrase}` : "it triggers";
    return `When ${input.consumer} ${verb} thanks to ${input.producer}, ${effect}`;
  }
  const cause = `When ${input.producer} ${verb}`;
  return phrase ? `${cause}, ${input.consumer} ${phrase}` : `${cause}, ${input.consumer} triggers`;
}

/** A card that can end up in the graveyard is the raw material a recursion ability needs. Not a
 *  triggered EVENT — the recursion ability can be static or activated any time — so this reads as
 *  an enabling fact rather than a cause-and-effect firing, and it is one of the three phrases the
 *  design named for outright removal: "fills the graveyard, enabling X's recursion" was on both the
 *  precon player's and the deck tuner's unknown-word lists (2026-08-20). */
export function graveyardEnablesRecursion(producer: string, consumer: string): string {
  return `When ${producer} is in the graveyard, ${consumer} can bring it back`;
}

/** The same enabling shape, for a payoff that merely gets BIGGER per card in the graveyard rather
 *  than returning one (Bonehoard). Not a trigger either — `effect.scaling` fires nothing. */
export function graveyardFeedsScaling(producer: string, consumer: string): string {
  return `When ${producer} is in the graveyard, ${consumer} gets bigger`;
}

/** kind -> what a continuous STATIC effect gives the class of card its subject reaches. Direction
 *  is the mirror of PHRASES above: there the CONSUMER performs what a triggered effect does; here
 *  the PRODUCER's own static keeps granting it, so the phrase reads "<producer> gives <consumer>
 *  <phrase>" rather than naming an event that fires.
 *
 *  EVERY member of `EFFECT_KINDS` (schema.ts, 35 total) was checked against the fallback's own
 *  sentence, "gives <consumer> its <kind, hyphens to spaces>". Three read as an unconjugated VERB
 *  rather than a noun phrase and needed an explicit entry: `proliferate` ("... its proliferate"),
 *  `enters-with-counters` ("... its enters with counters") and `untap` ("... its untap"). The
 *  remaining 26 unmapped kinds are already noun phrases and pass through the fallback fine — damage,
 *  lifegain, drain, draw-card, forced-sacrifice, trigger-doubling, graveyard-recursion,
 *  token-doubling, damage-multiplier, top-manipulation, counter-placement, mana-generation,
 *  fast-mana, ritual, copy-spell, flicker, graveyard-hate (the existing covering test), extra-combat,
 *  plus `debuff`, `cost-reduction`, `tax`, `win-game`, `extra-turn` and `extra-phase`, which can
 *  never reach this function at all: `cost-reduction` takes the ternary's other branch at the one
 *  call site, `debuff` is refused by its own `continue` two lines above that call, and the other four
 *  sit in `ROLE_NOT_SYNERGY` and are refused before the push that would reach here. A kind this table
 *  has never seen still reads as English via the de-slugified fallback, never a raw tag. */
const GRANT_PHRASES: Record<string, string> = {
  pump: "bigger stats",
  "keyword-grant": "an extra keyword ability",
  "type-grant": "an extra creature type",
  "speed-increase": "haste",
  animate: "life as a creature",
  clone: "a copy of what it targets",
  proliferate: "the ability to proliferate",
  "enters-with-counters": "counters as it enters",
  untap: "an extra untap",
};

/** Replaces the ternary's non-cost-reduction branch, whose old text — "P's <kind> applies to C" —
 *  was the third of the three phrases the design named for removal ("'s static applies to"). */
export function staticGrantSentence(producer: string, consumer: string, kind: string): string {
  const phrase = GRANT_PHRASES[kind] ?? `its ${kind.replace(/-/g, " ")}`;
  return `${producer} gives ${consumer} ${phrase}`;
}

/** "Panharmonicon doubles Solemn Simulacrum's enters trigger". Says WHICH trigger, because the whole
 *  point of the doubling channel is that Panharmonicon (entering), Isshin (attacking) and Drivnod
 *  (dying) were indistinguishable before it — a sentence that dropped the event would reintroduce
 *  exactly the ambiguity the field was added to remove. */
export function doublesSentence(producer: string, consumer: string, verb: string): string {
  return `${producer} doubles ${consumer}'s ${VERB_PHRASES[verb] ?? verb} trigger`;
}

/** The cost-reduction branch was already plain English and its text does not change — moved here
 *  only so sentence.ts is the single place every reason sentence is built. */
export function costReductionSentence(producer: string, consumer: string): string {
  return `${producer} reduces what ${consumer} costs`;
}

/** The five remaining sites' text, moved verbatim (byte-identical) — single-sourced, not reworded. */
export function winconSentence(producer: string, consumer: string): string {
  return `${producer} is what ${consumer} counts toward winning`;
}

export function fetchSentence(producer: string, consumer: string): string {
  return `${producer} can fetch ${consumer}`;
}

export function tutorSentence(producer: string, consumer: string): string {
  return `${producer} can search up ${consumer}`;
}

export function counterPresenceSentence(producer: string, consumer: string, counterKind: string): string {
  return `${consumer} benefits from ${counterKind} counters being on the board; ${producer} puts them there`;
}

export function meldSentence(a: string, b: string): string {
  return `${a} and ${b} meld together`;
}

export function createsSentence(producer: string, consumer: string): string {
  return `${producer} creates ${consumer}`;
}

/** THE COPY FAMILY, which needs two sentences and shares neither with the generic trigger site.
 *
 *  A copy states a MECHANISM the reader cannot look up on either card: CR 707.2 gives the copy the
 *  copied card's abilities, so an entry trigger fires a second time, and CR 704.5j then kills one of
 *  two legends outright — a state-based action printed on no card at all. `reasonSentence`'s
 *  "thanks to <producer>" hides the copy, which is the one fact that makes the claim checkable, so
 *  this site keeps its own wording. The `dies` string is byte-identical to the one it replaced; the
 *  `enters` half is turned cause-first like every other self trigger (see `reasonSentence`). */
export function copySentence(producer: string, consumer: string, eventKey: string, dies: boolean): string {
  return dies
    ? `${producer} copies ${consumer}; the legend rule puts one of them into the graveyard, triggering its death ability`
    : `When ${consumer} ${eventVerbPhrase(eventKey)} because ${producer} copies it, its ability triggers again`;
}
