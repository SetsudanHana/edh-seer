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
  // NINE KINDS THE ENGINE READ AND THE SENTENCE REFUSED TO SAY. MEASURED 2026-09-04 over every
  // consumer ability in the derived corpus: 27.7% of all partner rows on the site ended in a bare
  // "<card> triggers", and only 3,453 of those were a genuine blank -- the rest were these, kinds
  // the engine had identified and this table simply had no words for. A skeptic reading the page
  // called those rows "the sentence generator running out", filed as a refusal that reads as a hole,
  // and they were right: an engine that knows a card grants haste and prints "triggers" is hiding
  // what it knows behind the same wording it uses for what it does not.
  //
  // WORDED WEAK ON PURPOSE. Each phrase says the category and claims nothing past it -- "hits a
  // graveyard" rather than "exiles their graveyard", because `graveyard-hate` covers exile, mill and
  // shuffle-back alike and the kind cannot tell them apart. Over-specifying here would be the
  // Decoction Module defect one register up.
  "top-manipulation": [() => "sets up the top of a library", "sets up the top of a library"],
  "keyword-grant": [() => "grants a keyword", "grants a keyword"],
  untap: [() => "untaps a permanent", "untaps a permanent"],
  "speed-increase": [() => "grants haste", "grants haste"],
  // SPEED IS THE PLAYER'S (CR 702.179): the card raises yours, it does not gain one.
  speed: [() => "raises your speed", "raises your speed"],
  "copy-spell": [() => "copies a spell", "copies a spell"],
  flicker: [() => "blinks a permanent", "blinks a permanent"],
  animate: [() => "turns something into a creature", "turns something into a creature"],
  "graveyard-hate": [() => "hits a graveyard", "hits a graveyard"],
  debuff: [(n) => `shrinks a creature by ${n}`, "shrinks a creature"],
  "ability-loss": [() => "strips abilities", "strips abilities"],
  // AND THE MULTIPLIERS, which a sample of the still-bare rows put next in volume: 28 of 400 were
  // `token-doubling`, 18 `proliferate`, 14 `damage-multiplier`. Each one is a card whose whole
  // reason for being in a deck is what it multiplies, printed as "triggers".
  "token-doubling": [() => "doubles the tokens", "doubles the tokens"],
  "damage-multiplier": [() => "doubles the damage", "doubles the damage"],
  "trigger-doubling": [() => "doubles the trigger", "doubles the trigger"],
  proliferate: [() => "proliferates", "proliferates"],
  clone: [() => "copies a permanent", "copies a permanent"],
  "enters-with-counters": [() => "arrives with counters", "arrives with counters"],
  "type-grant": [() => "changes what something is", "changes what something is"],
  "extra-combat": [() => "takes an extra combat", "takes an extra combat"],
  "extra-phase": [() => "takes an extra phase", "takes an extra phase"],
  "extra-turn": [() => "takes an extra turn", "takes an extra turn"],
  "win-game": [() => "can win the game", "can win the game"],
  tax: [() => "taxes the table", "taxes the table"],
  // A PUMP AMOUNT IS A P/T DELTA, NOT A NUMBER, and this table read it as a number for as long as
  // it has existed: `+${n}/+${n}` over the corpus's own `"+2/+0"` renders `gives ++2/+0/++2/+0`,
  // which shipped to the Archetypes tab and was reported from a real deck. Measured over the
  // derived corpus: 1,893 pump abilities carry a P/T pair and TWO carry a bare number, so the
  // shape this was written for is the rounding error and the one it mangled is the rule.
  //
  // Anything with a slash goes through verbatim, which also carries the X forms and the
  // conditional ones as English -- `gives +X/+X`, `gives +1/+1 for each creature you control`. A
  // bare number keeps the old reading for the two cards that use it. Anything else (a lone `X`,
  // prose with no pair in it) falls back to the amountless phrase: the amount is the part we
  // cannot state, not the fact that it pumps.
  pump: [
    (n) => (n.includes("/") ? `gives ${n}` : /^\d+$/.test(n) ? `gives +${n}/+${n}` : "makes your creatures bigger"),
    "makes your creatures bigger",
  ],
  // A COST REDUCTION IS ALREADY NEGATIVE. 138 of these carry `"-1"` and the template said
  // `costs ${n} less`, so the sentence read "costs -1 less" -- a double negative that states the
  // opposite of the card. Another 36 carry a mana symbol (`"-{1}"`, `"{1} less"`), where the
  // template also doubled the word "less".
  "cost-reduction": [costsLess, "costs less"],
};

/** `-1` and `-{1}` are the same reduction written two ways, and `{1} less` already carries the
 *  word. Strips the sign (ASCII and the Unicode minus the corpus also holds), refuses prose it
 *  cannot place inside the sentence, and never says "less" twice. */
function costsLess(amount: string): string {
  const n = amount.replace(/^[-\u2212]/, "").trim();
  if (/\bless\b/.test(n)) return `costs ${n}`;
  // A number or a mana symbol reads inside the sentence; a clause ("X is the amount of life you
  // lost this turn") does not, and the amountless phrase is the honest answer for it.
  return /^\{?[0-9WUBRGC]+\}?$/.test(n) ? `costs ${n} less` : "costs less";
}

/** WHERE THE COUNTERS GO, as a noun the sentence can end on.
 *
 *  "puts counters on it" has TWO live antecedents in every row it appears in: the sentence opens
 *  "When a Goblin enters thanks to Krenko, Mob Boss…", so "it" reads as the Goblin — and on Quest
 *  for the Goblin Lord the counters go on the QUEST. A skeptic put it exactly: "the two readings are
 *  a real synergy versus a nothing". 25,997 rows carried the pronoun.
 *
 *  The derived effect subject settles it wherever it says anything: `self` is the card itself, a
 *  type or subtype names the class, and an untyped one falls back to "a permanent" -- true of every
 *  counter target and, unlike "it", claiming nothing about WHICH one. That is the whole ambiguity:
 *  not that the noun is vague, but that the pronoun pointed confidently at the wrong thing. */
export function effectTargetNoun(subject: {
  self?: boolean; subtype?: string | string[]; type?: string | string[];
} | undefined): string {
  if (subject?.self === true) return "itself";
  const noun = emitSubjectNoun(subject);
  return noun ?? "something";
}

/** WHO THE PAYOUT GOES TO, for the two kinds whose phrase names a recipient. "draws you" and "gains
 *  you" were hard-coded, so Arcane Denial's "its controller may draw up to two cards" -- derived
 *  correctly as `opp` -- printed as *draws you up to two cards* on the card page (owner, 2026-09-05).
 *  `opp` names an opponent, `any` a player; `you` and an unstated recipient read as before. */
const RECIPIENT_PHRASES: Record<string, Record<string, [(n: string) => string, string]>> = {
  "draw-card": {
    opp: [(n) => `makes an opponent draw ${n} card${n === "1" ? "" : "s"}`, "makes an opponent draw cards"],
    any: [(n) => `makes a player draw ${n} card${n === "1" ? "" : "s"}`, "makes a player draw cards"],
  },
  lifegain: {
    opp: [(n) => `gains an opponent ${n} life`, "gains an opponent life"],
    any: [(n) => `gains a player ${n} life`, "gains a player life"],
  },
};

export function effectPhrase(
  kind: string | undefined, amount: string | undefined, target?: string, recipient?: string,
): string | null {
  if (!kind) return null;
  const aimed = recipient ? RECIPIENT_PHRASES[kind]?.[recipient] : undefined;
  if (aimed) return amount ? aimed[0](amount) : aimed[1];
  // THE ONE KIND WHOSE PHRASE NAMES A TARGET, and the one that was naming the wrong one.
  if (kind === "counter-placement" && target) {
    const n = amount === undefined ? "counters" : amount === "1" ? "a counter" : `${amount} counters`;
    return `puts ${n} on ${target}`;
  }
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
// Exported only so a completeness test can walk it against @edh-seer/tagger's VERB_VOCAB -- this table
// grows every time this project adds a verb, and the naive fallback below is wrong for every
// noun-shaped one, so a forgotten entry must fail a test rather than ship silently.
export const VERB_PHRASES: Record<string, string> = {
  enters: "enters",
  "enters-graveyard": "hits the graveyard",
  unlock: "is fully unlocked",
  dies: "dies",
  leaves: "leaves the battlefield",
  // A `leaves` demand whose subject names the graveyard (Desecrated Tomb, Fang) -- keyed apart from a
  // battlefield leave by `zoneEventKey` so the sentence cannot say "battlefield" about a graveyard.
  "leaves-graveyard": "leaves a graveyard",
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
 *  satisfies `dies:creature`). CEILING: a verb this map has never seen gets `verb + "s"`, which is
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
  /** Where a counter-placing effect actually puts them -- see `effectTargetNoun`. */
  effectTarget?: string;
  /** Who a draw or a life change goes to (`effect.subject.control`) -- see `RECIPIENT_PHRASES`. */
  effectRecipient?: string;
  /** WHAT THE EVENT HAPPENS TO, when it does not happen to the producer.
   *
   *  **A SORCERY CANNOT DIE.** Austere Command emits four `dies` events whose subjects are CLASSES
   *  it destroys (`{type: creature, scope: all}`), not itself — and this function rendered every one
   *  as *"When Austere Command dies, Grim Haruspex draws you 1 card"*, about a `{4}{W}{W}` Sorcery.
   *  It was the deck's four highest-rated rows, and the skeptic, the tuner and the precon player
   *  each flagged it independently on 2026-08-27. The same shape made *"When Grim Hireling dies"*
   *  out of an emit about its TREASURES.
   *
   *  **THE EDGE WAS ALWAYS RIGHT AND ONLY THE SENTENCE WAS WRONG** — a board wipe really does make
   *  creatures die, and that really does feed a death payoff. What the prose did was name the wrong
   *  dying object, which on a product whose whole pitch is "we tell you WHY" is the failure mode
   *  that matters most: the relation looks plausible and the mechanism is fiction.
   *
   *  Absent when the producer's emit is about ITSELF (every implied event, and any authored emit
   *  carrying `subject.self`), which is the case the old wording was written for and still fits. */
  subjectNoun?: string;
}): string {
  const verb = eventVerbPhrase(input.eventKey);
  const phrase = effectPhrase(input.effectKind, input.amount, input.effectTarget, input.effectRecipient);
  if (input.self) {
    const effect = phrase ? `it ${phrase}` : "it triggers";
    return `When ${input.consumer} ${verb} thanks to ${input.producer}, ${effect}`;
  }
  // ONE GRAMMAR FOR BOTH CAUSED CASES. "thanks to <producer>" is the same construction the self
  // branch above already uses, so the producer stays named as the cause while the SUBJECT of the
  // event is named as the thing it happens to.
  //
  // EXCEPT FOR `create-token`, THE ONE VERB WHOSE SUBJECT IS ITS OBJECT. Every other emit names the
  // thing the event HAPPENS TO -- a creature dies, an artifact enters -- so making it the
  // grammatical subject is right. A create-token emit names the thing CREATED while the verb
  // describes the maker's action, so the same construction produced "When a goblin makes a token
  // thanks to Krenko, Mob Boss": the token doing the making. MEASURED on the partner artifact
  // 2026-09-04, 7,050 of 91,061 rows (7.7%) across 2,671 cards. The producer takes the subject back
  // and the noun becomes what it always was, the token's own name.
  const cause = input.subjectNoun && input.eventKey.split(":")[0] === "create-token"
    // An untyped emit yields "a permanent", and "a permanent token" says nothing "a token" does not.
    ? `When ${input.producer} makes ${input.subjectNoun === "a permanent" ? "a token" : `${input.subjectNoun} token`}`
    : input.subjectNoun
    ? `When ${input.subjectNoun} ${verb} thanks to ${input.producer}`
    : `When ${input.producer} ${verb}`;
  return phrase ? `${cause}, ${input.consumer} ${phrase}` : `${cause}, ${input.consumer} triggers`;
}

/** The noun for a producer emit's subject — "a creature", "a Treasure", "a permanent".
 *
 *  Returns undefined when the event is about the PRODUCER ITSELF, which is what keeps every
 *  correct sentence in the corpus ("When Grim Haruspex dies…" about a creature that really can die)
 *  reading exactly as it did. A subtype is preferred over a card type because it is what a reader
 *  recognises — "a Treasure dies" says more than "an artifact dies" — and an untyped subject falls
 *  back to "a permanent" rather than to nothing, since the event still happened to SOMETHING. */
export function emitSubjectNoun(subject: {
  self?: boolean; subtype?: string | string[]; type?: string | string[];
} | undefined): string | undefined {
  if (!subject || subject.self === true) return undefined;
  const first = (v: string | string[] | undefined): string | undefined =>
    Array.isArray(v) ? v[0] : v;
  // A SUBTYPE IS A PROPER NOUN IN MAGIC and a card type is not: a Goblin, an Angel, a Treasure --
  // but a creature, an artifact. The derived tags are lowercase throughout, so the distinction has
  // to be restored here, at the one place that knows WHICH of the two it took. Noticed on a card
  // page printing both at once: `eventKeySentence` said "a Goblin creature token" one line above a
  // reason sentence saying "a goblin", which reads as two engines disagreeing about the same card.
  const subtype = first(subject.subtype);
  const noun = subtype !== undefined
    ? subtype.charAt(0).toUpperCase() + subtype.slice(1)
    : first(subject.type) ?? "permanent";
  return `${/^[aeiou]/i.test(noun) ? "an" : "a"} ${noun}`;
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

/** THE SAME SHAPE ONE ZONE OVER: a payoff that counts what you have ON THE BOARD, and a card that
 *  is one of them. Krenko, Mob Boss makes a Goblin token per Goblin you control, so every other
 *  Goblin in the deck makes him bigger -- a relation no event can express, because nothing fires.
 *
 *  "COUNTS IT" RATHER THAN "COUNTS GOBLINS", because the subject is already named by the row's own
 *  event line and repeating it here would say the same noun twice in two voices. */
const COUNT_GROWS: Record<string, string> = {
  "token-generation": "makes more tokens",
  "token-doubling": "makes more tokens",
  "deal-damage": "deals more damage",
  damage: "deals more damage",
  "draw-card": "draws more cards",
  lifegain: "gains more life",
  drain: "drains for more",
  "counter-placement": "puts on more counters",
  mill: "mills more",
  "add-mana": "adds more mana",
  "cost-reduction": "costs less",
  pump: "gets bigger",
};

export function boardCountFeedsScaling(
  producer: string, consumer: string, effectKind?: string,
): string {
  // "GETS BIGGER" WAS A WRONG CLAIM ON MOST OF THIS CHANNEL, reported by the precon reviewer against
  // the card printed beside it: Krenko's X counts Goblins to decide HOW MANY TOKENS he makes, and he
  // is a 3/3 either way. A reader who checks the sentence against the card -- which is the whole
  // point of printing a sentence -- finds it saying something the card does not say.
  //
  // The kind is what the count actually feeds, so the kind names the growth. An effect this map has
  // never seen says "does more", which is true of every scaling effect and claims nothing further.
  const grows = (effectKind && COUNT_GROWS[effectKind]) ?? "does more";
  // "YOU CONTROL", NOT "ON THE BATTLEFIELD" -- the skeptic held the sentence against the card six
  // inches away: Krenko counts "the number of Goblins YOU CONTROL", and an opponent's Goblin is on
  // the battlefield and counts for nothing. The engine's gate is control-aware already (the count's
  // `control` is kept when it is matched against a card's printed characteristics); only the prose
  // was stating the weaker condition.
  return `While you control ${producer}, ${consumer} counts it and ${grows}`;
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
  // "AN EXTRA ABILITY" AND NOT "AN EXTRA KEYWORD ABILITY" (roadmap J12). `grant-ability` covers
  // both a printed keyword and a whole quoted ability, and the kind alone cannot tell them apart —
  // Feywild Visitor hands its commander a combat-damage TRIGGER, which is not a keyword, so the
  // narrower word was a false sentence about it. The wider one is true of both: CR 702 makes a
  // keyword an ability, so nothing is lost on the cards the old phrase described correctly.
  "keyword-grant": "an extra ability",
  // "an extra TYPE", with the kind of type supplied by the caller (`typeGrantNoun`). The table
  // cannot say it: a `type-grant` reaches lands as readily as creatures, and this row read
  // "an extra creature type" about both -- Omo, Queen of Vesuva prints one static for each, so its
  // LAND grant said "Omo gives Glasspool Shore an extra creature type", a wrong noun on a true
  // claim (found 2026-08-28 while collapsing the MESHED double-count).
  "type-grant": "an extra type",
  "speed-increase": "haste",
  animate: "life as a creature",
  clone: "a copy of what it targets",
  proliferate: "the ability to proliferate",
  "enters-with-counters": "counters as it enters",
  untap: "an extra untap",
};

/** Replaces the ternary's non-cost-reduction branch, whose old text — "P's <kind> applies to C" —
 *  was the third of the three phrases the design named for removal ("'s static applies to"). */
export function staticGrantSentence(
  producer: string, consumer: string, kind: string, noun?: string,
): string {
  const phrase = kind === "type-grant" && noun
    ? `an extra ${noun} type`
    : GRANT_PHRASES[kind] ?? `its ${kind.replace(/-/g, " ")}`;
  return `${producer} gives ${consumer} ${phrase}`;
}

/** WHICH KIND OF TYPE a `type-grant` hands out, for the sentence only -- never for matching.
 *
 *  The SUBJECT decides when it names exactly one of the two card types this family reaches (Omo's
 *  two statics are `{type: land}` and `{type: creature}`). Otherwise the CONSUMER'S OWN type line
 *  does, which is the fact the sentence is about anyway: 6 of the 13 derived type-grants carry no
 *  type at all (Glasspool Mimic, Copy Land, Minas Morgul), and Eluge's derives a bare
 *  `{subtype: island}`.
 *
 *  UNDECIDED MEANS NO NOUN, never a guess. A consumer that is BOTH a land and a creature (Dryad
 *  Arbor) cannot be settled from either side, and "an extra type" is true of every card here. */
export function typeGrantNoun(
  subjectType: string | string[] | undefined, consumerTypes: readonly string[],
): string | undefined {
  const list = (v: string | string[] | undefined): string[] =>
    v === undefined ? [] : Array.isArray(v) ? v : [v];
  const only = (from: readonly string[]): string | undefined => {
    const hit = ["creature", "land"].filter((t) => from.includes(t));
    return hit.length === 1 ? hit[0] : undefined;
  };
  return only(list(subjectType)) ?? only(consumerTypes);
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

/** A conditional land's demand, stated as the relation it is: this land is better because that card
 *  carries the basic land type it names. Two templates, two different sentences — a check land is
 *  about ENTERING, a verge land is about ACTIVATING, and saying "enters untapped" about a verge is a
 *  wrong sentence. */
export function landConditionSentence(
  producer: string,
  consumer: string,
  subtype: string,
  kind: "check" | "verge" | "basic-type-demand",
): string {
  const type = subtype.charAt(0).toUpperCase() + subtype.slice(1);
  // The G family is the same demand on a card that is NOT a land, so its sentence says what the
  // card gets rather than how it enters — Summit Apes is bigger, not untapped.
  if (kind === "basic-type-demand") return `${consumer} is better while you control a ${type}, and ${producer} is one`;
  return kind === "check"
    ? `${consumer} enters untapped when you control a ${type}, and ${producer} is one`
    : `${consumer} can only use its second mana ability while you control a ${type}, and ${producer} is one`;
}

export function counterPresenceSentence(producer: string, consumer: string, counterKind: string): string {
  return `${consumer} benefits from ${counterKind} counters being on the board; ${producer} puts them there`;
}

/** THE DEMAND SIDE OF THE SAME FAMILY `counterPresenceSentence` states the supply side of.
 *
 *  The generic `reasonSentence` grammar reads "When <producer> <verb>, <consumer> triggers", which
 *  on a `counter-added` edge renders as *"When Virulent Silencer gets a counter, Radstorm
 *  triggers"* — false twice over. Virulent Silencer does not GET a counter; it puts poison counters
 *  on a PLAYER. And Radstorm is a sorcery you cast, which never triggers. `subjectNoun` cannot
 *  rescue it: a counter-added emit is routinely UNTYPED, so `producerCanBeSubject` cannot refuse a
 *  producer that really could carry a counter, which is the residual its own comment records.
 *
 *  Same failure the Austere Command fix named on 2026-08-27 — the edge is right and the prose names
 *  the wrong object — so it gets the same treatment: name what actually happens. */
export function proliferateSentence(producer: string, consumer: string): string {
  return `${producer} puts counters on the board, and ${consumer} proliferates them`;
}

/** WHY A CLONE WANTS TO BE BLINKED. The generic grammar renders a self trigger as "When <consumer>
 *  enters thanks to <producer>, it triggers" — and an enter-as-a-copy replacement (CR 614.1c) never
 *  triggers, it REPLACES. The value is that the copy choice is made again, against whatever is on
 *  the board now, which is the whole reason a blink deck runs one. */
export function enterAsCopySentence(producer: string, consumer: string): string {
  return `${producer} makes ${consumer} enter again, and it copies something new as it does`;
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
