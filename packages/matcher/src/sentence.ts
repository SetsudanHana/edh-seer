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
  // MAGIC'S OWN VERB (review 2026-09-24): "costs" reads as a payment; the card says "loses".
  // A NUMBER READS "lose 2 life"; A QUANTITY READS "lose life equal to Sarevok's power" -- "lose
  // Sarevok's power life" is not English.
  "player-life-loss": [(n) => (/^(\d+|X)$/.test(n) ? `makes each opponent lose ${n} life` : `makes each opponent lose life equal to ${n}`), "makes each opponent lose life"],
  "counter-placement": [(n) => (n === "1" ? "puts a counter on it" : `puts ${n} counters on it`), "puts counters on it"],
  "token-generation": [(n) => (n === "1" ? "makes a token" : `makes ${n} tokens`), "makes a token"],
  // CR 114.2's own verb. An emblem is not a token, and the row must not say it is.
  emblem: [() => "gets an emblem", "gets an emblem"],
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
  // Five phrases where there was one, since the kind split on 2026-09-07. Each says what its own
  // CR verb does rather than the generic "sets up the top", which was true of only one of the five.
  scry: [() => "scries", "scries"],
  surveil: [() => "surveils", "surveils"],
  mill: [() => "mills a card", "mills a card"],
  search: [() => "searches a library", "searches a library"],
  "top-set": [() => "sets the top of a library", "sets the top of a library"],
  "keyword-grant": [() => "grants a keyword", "grants a keyword"],
  untap: [() => "untaps a permanent", "untaps a permanent"],
  "speed-increase": [() => "grants haste", "grants haste"],
  // SPEED IS THE PLAYER'S (CR 702.179): the card raises yours, it does not gain one.
  speed: [() => "raises your speed", "raises your speed"],
  "copy-spell": [() => "copies a spell", "copies a spell"],
  "copy-ability": [() => "copies an ability", "copies an ability"],
  flicker: [() => "blinks a permanent", "blinks a permanent"],
  animate: [() => "turns something into a creature", "turns something into a creature"],
  "graveyard-hate": [() => "hits a graveyard", "hits a graveyard"],
  "exile-processing": [() => "processes an opponent's exiled card", "processes an opponent's exiled card"],
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
  // Chandra, Roaring Flame's −7 hands the emblem to each opponent she hits; the sentence has to say
  // so, because CR 114.2 makes that opponent its controller.
  emblem: {
    opp: [() => "gives each opponent an emblem", "gives each opponent an emblem"],
    any: [() => "gives a player an emblem", "gives a player an emblem"],
  },
};

const SELF_PHRASES: Record<string, string> = {
  untap: "untaps itself",
  flicker: "blinks itself",
  // "When Chandra is cast, Jaya's Phoenix brings a card back" read as the Phoenix returning Chandra;
  // it returns itself (issue #558).
  "graveyard-recursion": "returns itself from the graveyard",
};

const PROSE_AMOUNT = /\bfor each\b|\bequal to\b|\bwhere\b|\bthe number of\b/i;

/** A COST THAT SPENDS A COUNTER (issue #511): "O'aka removes a counter from Summon: Fenrir and draws
 *  you 1 card". `onItself` is whether the producer's counters sit on the producer; otherwise they are
 *  on some permanent it put them on, and the sentence says so. */
export function counterCostSentence(producer: string, consumer: string, onItself: boolean, phrase: string | null): string {
  const from = onItself ? producer : `a permanent ${producer} put counters on`;
  return `${consumer} removes a counter from ${from}${phrase ? ` and ${phrase}` : ""}`;
}

export function effectPhrase(
  kind: string | undefined, amount: string | undefined, target?: string, recipient?: string, counterKind?: string,
): string | null {
  if (!kind) return null;
  // PROSE IS NOT AN AMOUNT. Hateful Eidolon's draw carries `amount: "for each Aura you controlled
  // that was attached to it"`, and the template printed "draws you for each Aura ... cards" (UX
  // sweep 2026-09-06, E3). A number, an X, "up to two", a P/T pair or a mana symbol reads inside the
  // sentence; a CLAUSE -- "for each …", "equal to …", "X where X is …", "the number of …" -- takes
  // the amountless phrase. `pump` and `cost-reduction` place their own prose and keep it.
  if (amount !== undefined && PROSE_AMOUNT.test(amount) && kind !== "pump" && kind !== "cost-reduction") amount = undefined;
  const aimed = recipient ? RECIPIENT_PHRASES[kind]?.[recipient] : undefined;
  if (aimed) return amount ? aimed[0](amount) : aimed[1];
  // THE CARD DOES IT TO ITSELF. "Untap Chandra" is not "untaps a permanent" (owner, 2026-09-08);
  // the two kinds a card routinely does to itself get the reflexive phrase, the rest keep theirs.
  if (target === "itself" && SELF_PHRASES[kind]) return SELF_PHRASES[kind]!;
  // A PUMP ON ITSELF "gets" its amount -- prowess's +1/+1 -- rather than "gives" it to a class.
  if (target === "itself" && kind === "pump") return amount && amount.includes("/") ? `gets ${amount}` : "gets bigger";
  // THE ONE KIND WHOSE PHRASE NAMES A TARGET, and the one that was naming the wrong one.
  if (kind === "counter-placement" && target) {
    // A QUANTITY THAT REFERS TO A COUNT ELSEWHERE IN THE SENTENCE NEEDS "of" TO ATTACH TO ITS NOUN.
    // Yuna, Grand Summoner puts "that number" of counters -- the count the dying permanent had --
    // and the template read "puts that number counters on a permanent" (AL4). "that many" is a
    // determiner and already attaches, so only the noun form takes the preposition.
    // THE KIND, when the trigger names it (issue #503): The Earth Crystal doubles +1/+1 counters only.
    const kindWord = counterKind ? `${counterKind} ` : "";
    // A REPLACEMENT THAT ADDS ONE (issue #518): Hardened Scales' amount arrives as "N+1", "that many
    // plus one" or "X plus one", and "N" was never defined on the page. What it adds is one more.
    const more = amount?.match(/^(?:N|X|that many)\s*(?:\+|plus)\s*(one|\d+)$/i)?.[1];
    if (more !== undefined) {
      return more === "one" || more === "1" ? `puts one more ${kindWord}counter on ${target}` : `puts ${more} more ${kindWord}counters on ${target}`;
    }
    const n = amount === undefined ? `${kindWord}counters`
      : amount === "1" ? `a ${kindWord}counter`
      // THE AMOUNT IS ALREADY THE NOUN. Resourceful Defense moves "those counters" themselves, not a
      // count of them, and the template doubled the word.
      : /\bcounters?$/i.test(amount) ? amount
      : /\bnumber$/i.test(amount) ? `${amount} of ${kindWord}counters`
      : `${amount} ${kindWord}counters`;
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
  "counter-removed": "loses a counter",
  // AC11 batch 2, the object events.
  shuffle: "shuffles a library",
  transform: "transforms",
  "turned-face-up": "is turned face up",
  copy: "is copied",
  reveal: "is revealed",
  attached: "becomes attached",
  unattached: "becomes unattached",
  "gains-control": "changes control",
  "phases-out": "phases out",
  regenerate: "regenerates",
  prevented: "has damage prevented",
  exchange: "is exchanged",
  double: "is doubled",
  triple: "is tripled",
  // AC11 batch 3, the keyword actions.
  goad: "goads a creature",
  exert: "exerts a creature",
  detain: "detains something",
  suspect: "suspects a creature",
  harness: "harnesses something",
  vote: "holds a vote",
  clash: "clashes",
  fateseal: "fateseals",
  behold: "beholds",
  heal: "heals",
  convert: "converts",
  explore: "explores",
  endure: "endures",
  learn: "learns",
  forage: "forages",
  "time-travel": "time travels",
  "collect-evidence": "collects evidence",
  "venture-into-the-dungeon": "ventures into the dungeon",
  "face-a-villainous-choice": "poses a villainous choice",
  airbend: "airbends",
  waterbend: "waterbends",
  foretell: "foretells",
  // AC11 batch 4, the designations.
  "flip-coin": "flips a coin",
  monarch: "makes you the monarch",
  initiative: "gives you the initiative",
  "city-blessing": "gives you the city's blessing",
  "ring-tempts": "has the Ring tempt you",
  // CR 722.3a, Reality Fracture.
  prepared: "becomes prepared",
  "loses-game": "makes a player lose the game",
  "gain-life": "gains life",
  "lose-life": "makes a player lose life",
  sacrifice: "sacrifices something",
  "create-token": "makes a token",
  proliferate: "proliferates",
  // The rest of VERB_VOCAB: nouns wearing a verb's job, where "verb + s" reads as nonsense
  // ("combat-damages", "land-plays", "dice-rolleds").
  "combat-damage": "deals combat damage",
  "non-combat-damage": "deals noncombat damage",
  damaged: "is dealt damage",
  exiled: "is exiled",
  draw: "draws a card",
  discard: "discards a card",
  mill: "mills a card",
  // CR 701.22 / 701.25 / 701.23, added 2026-09-07 with the verbs. The naive fallback below would
  // have shipped "scrys" and "searchs" -- which is the exact silent defect the VERB_PHRASES
  // coverage test exists to catch, and it caught these.
  scry: "scries",
  surveil: "surveils",
  // Not "searches" alone: the sentence reads "When X searches a library, Y ...", and every consumer
  // of this event names a library (three watch an opponent's, one your own).
  search: "searches a library",
  // CR 701.5, 2026-09-09: the consumer sentence reads "When X counters a spell, Y ...".
  "counter-spell": "counters a spell",
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
  const [verb = key, subject] = key.split(":");
  // "DIES" IS A CREATURE'S OR A PLANESWALKER'S WORD (CR 700.4). Any other subject -- an artifact, an
  // enchantment, "any" permanent -- takes the rules' own long form, which is true of every death, so
  // it is never wrong even when the producer turns out to be a creature.
  if (verb === "dies" && subject !== undefined && subject !== "creature" && subject !== "planeswalker") {
    return "is put into a graveyard from the battlefield";
  }
  // A CARD NEVER DRAWS, A PLAYER DOES (persona round 2026-09-25): "When Memory Worm draws a card"
  // contradicted "Memory Worm makes a player draw" one step earlier. Draw, discard and mill name the
  // player the subject half says, as lose-life already does.
  const CARD_FLOW: Record<string, string> = { draw: "draw", discard: "discard", mill: "mill" };
  if (CARD_FLOW[verb]) {
    const who = subject === "you" ? "you" : subject === "opp" ? "an opponent" : "a player";
    return `makes ${who} ${CARD_FLOW[verb]} a card`;
  }
  return VERB_PHRASES[verb] ?? `${verb.replace(/-/g, " ")}s`;
}

interface EmitLike { verb: string; subject: { self?: boolean; ref?: "trigger"; control?: string; token?: boolean | null; subtype?: string | string[]; type?: string | string[]; fromZone?: string } }

/** THE EFFECT READ OFF WHAT THE ABILITY DOES, when derive left its kind blank (#647 item 5). 5,480
 *  of 67,734 reasons on the 71 decks ended "<card> triggers" and wore "what it does isn't read yet"
 *  -- on Mari's exile, Fear of Sleep Paralysis's tap, Kodama's put -- while the emits said exactly
 *  what happens. Only verbs that read one way are phrased; a lone `discard` is a loot's second half
 *  as often as an opponent's discard, `shuffle`, `transform` and `attached` say nothing a player
 *  wants, and they keep the fallback. A FLICKER is an exile whose clause returns the card (Displacer
 *  Kitten's return is a sibling ability of the same clause), never "exiles a permanent you control". */
export function emitPhrase(emits: readonly EmitLike[], triggerObject: "it" | "itself" = "it"): string | null {
  const has = (v: string) => emits.find((e) => e.verb === v);
  const noun = (e: EmitLike, own = true): string => {
    if (e.subject.self === true) return "itself";
    // THE TRIGGERING OBJECT ITSELF (#823): Mari exiles the creature that died, not "a creature an
    // opponent controls" -- a second one. The sentence already named it ("When a creature dies"), so
    // it is "it"; when the consumer is what triggered, "itself".
    if (e.subject.ref === "trigger") return triggerObject;
    const n = emitSubjectNoun(e.subject) ?? "a permanent";
    if (!own) return n;
    return e.subject.control === "you" ? `${n} you control` : e.subject.control === "opp" ? `${n} an opponent controls` : n;
  };
  const who = (e: EmitLike): string | null => e.subject.control === "you" ? "you" : e.subject.control === "opp" ? "an opponent" : null;
  const exiled = has("exiled");
  if (exiled && emits.some((e) => e.verb === "enters" && e.subject.fromZone === "exile")) return `flickers ${noun(exiled)}`;
  const sac = has("sacrifice");
  if (sac) {
    if (sac.subject.self === true || sac.subject.control === "you") return `sacrifices ${noun(sac, false)}`;
    return `makes ${sac.subject.control === "opp" ? "an opponent" : "a player"} sacrifice ${noun(sac, false)}`;
  }
  // AN EXILE SAYS WHERE FROM: Necropotence exiles from a graveyard, Gonti and Valakut Exploration from
  // a library, and "exiles a permanent" was a claim about the board. Untyped with no zone (Agent of
  // Erebos's "target player's graveyard") is not phrased.
  if (exiled) {
    if (exiled.subject.ref === "trigger") return `exiles ${noun(exiled)}`;
    const zone = exiled.subject.fromZone;
    const owner = who(exiled) === "you" ? "your" : who(exiled) === "an opponent" ? "an opponent's" : "a";
    if (zone === "graveyard") return `exiles a card from ${owner} graveyard`;
    if (zone === "library") return `exiles a card from ${owner} library`;
    if (zone === "battlefield" || (zone === undefined && (exiled.subject.type !== undefined || exiled.subject.subtype !== undefined || exiled.subject.self === true))) {
      return `exiles ${noun(exiled)}`;
    }
  }
  const dies = has("dies");
  if (dies && dies.subject.self !== true) return `kills ${noun(dies)}`;
  // A CONTROL CHANGE AN OPPONENT GAINS IS A GIFT (#681): derive names the GAINER, and for Donate
  // that is the opponent -- "gains control of a permanent an opponent controls" said the opposite.
  const given = emits.find((e) => e.verb === "gains-control" && e.subject.control === "opp");
  if (given) return `gives an opponent control of ${noun(given, false)}`;
  for (const [verb, phrase] of [["taps", "taps"], ["untaps", "untaps"], ["gains-control", "gains control of"]] as const) {
    const e = has(verb);
    // Taking control of what you already control is a misread (Misleading Signpost redirects an attack).
    if (e && !(verb === "gains-control" && e.subject.control === "you")) return `${phrase} ${noun(e)}`;
  }
  const counter = has("counter-added");
  if (counter) return `puts a counter on ${noun(counter)}`;
  const put = emits.find((e) => e.verb === "enters" && e.subject.token !== true && ["hand", "graveyard", "library"].includes(e.subject.fromZone ?? ""));
  if (put) return `${put.subject.fromZone === "graveyard" ? "returns" : "puts"} ${noun(put, false)} onto the battlefield`;
  if (has("draw") && has("discard")) return "draws and discards";
  // CR 722.3a: "enters prepared" / "target creature becomes prepared".
  const prep = has("prepared");
  if (prep) return prep.subject.self === true ? "becomes prepared" : `prepares ${noun(prep)}`;
  // The implied prepare ability (implied.ts `preparedAbilities`): being prepared lets it cast its spell.
  if (emits.some((e) => e.verb === "cast" && (e.subject as { prepared?: boolean }).prepared === true)) return "can cast its prepare spell";
  const discard = has("discard");
  if (discard && discard.subject.control === "opp") return "makes an opponent discard a card";
  const lose = has("lose-life");
  if (lose && who(lose)) return `makes ${who(lose)} lose life`;
  if (has("non-combat-damage")) return "deals damage";
  for (const v of ["counter-spell", "monarch", "initiative", "ring-tempts", "city-blessing", "proliferate", "scry", "surveil", "dice-rolled", "flip-coin"]) {
    if (has(v)) return VERB_PHRASES[v]!;
  }
  return null;
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
  /** The counter KIND a counter-placing effect puts, when the trigger names it ("+1/+1"). */
  counterKind?: string;
  /** The consumer ability's emits, and its clause siblings', for `emitPhrase` when `effectKind` is blank. */
  emits?: readonly EmitLike[];
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
  /** WHAT A SAC OUTLET'S COST TAKES ("a creature"), when the event is the death or sacrifice that
   *  cost pays (#799). "When Carrion Feeder dies" was about a card that is the OUTLET, not the thing
   *  dying: the sentence says the owner chose the death, and to which card. */
  sacrificedTo?: string;
  /** The keywords a `keyword-grant` hands out (`Ability.grants`): "grants flying" over "grants a keyword". */
  keywords?: readonly string[];
}): string {
  const verb = eventVerbPhrase(input.eventKey);
  const phrase = (input.effectKind === "keyword-grant" && input.keywords?.length ? `grants ${keywordList(input.keywords)}` : undefined)
    ?? effectPhrase(input.effectKind, input.amount, input.effectTarget, input.effectRecipient, input.counterKind)
    ?? emitPhrase(input.emits ?? [], input.self ? "itself" : "it");
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
  const cause = input.sacrificedTo ? `When you sacrifice ${input.sacrificedTo} to ${input.producer}`
    : input.subjectNoun && input.eventKey.split(":")[0] === "create-token"
    // An untyped emit yields "a permanent", and "a permanent token" says nothing "a token" does not.
    ? `When ${input.producer} makes ${input.subjectNoun === "a permanent" ? "a token" : `${input.subjectNoun} token`}`
    : input.subjectNoun
    ? `When ${input.subjectNoun} ${verb} thanks to ${input.producer}`
    : `When ${input.producer} ${verb}`;
  // THE CAST CARD IS WHAT ARRIVES WITH COUNTERS (overview persona rounds 2026-09-25, item 2a): Yuna's
  // "that creature enters with two additional +1/+1 counters" puts them on the spell just cast, so
  // the consumer is the cause, not the subject.
  if (input.effectKind === "enters-with-counters" && input.eventKey.split(":")[0] === "cast" && !input.subjectNoun) {
    return `${cause}, it arrives with counters thanks to ${input.consumer}`;
  }
  return phrase ? `${cause}, ${input.consumer} ${phrase}` : `${cause}, ${input.consumer} triggers`;
}

/** The noun for a producer emit's subject — "a creature", "a Treasure", "a permanent".
 *
 *  Returns undefined when the event is about the PRODUCER ITSELF, which is what keeps every
 *  correct sentence in the corpus ("When Grim Haruspex dies…" about a creature that really can die)
 *  reading exactly as it did. A subtype is preferred over a card type because it is what a reader
 *  recognises — "a Treasure dies" says more than "an artifact dies" — and an untyped subject falls
 *  back to "a permanent" rather than to nothing, since the event still happened to SOMETHING. */
type NounSubject = { subtype?: string | string[]; type?: string | string[] };
export function emitSubjectNoun(subject: NounSubject & {
  self?: boolean; anyOf?: readonly NounSubject[];
} | undefined): string | undefined {
  if (!subject || subject.self === true) return undefined;
  // A LIST NOBODY NARROWED IS NAMED WHOLE (#750). Bloodstained Mire finds "a Swamp or Mountain card";
  // when the caller cannot say which one the consumer took, "a Swamp" named the first branch as if it
  // were the one that entered, and an `anyOf` fetch fell through to "a permanent". A caller that CAN
  // say passes the one branch (`keyedOn`, `matchedBranch` in edges.ts).
  const words = (s: NounSubject): string[] => {
    const subs = [s.subtype ?? []].flat();
    return subs.length > 0 ? subs.map((w) => w.charAt(0).toUpperCase() + w.slice(1)) : [s.type ?? []].flat();
  };
  const branches = [...new Set((subject.anyOf ?? []).flatMap(words))];
  const own = words(subject);
  const all = branches.length > 0 && [subject.subtype ?? []].flat().length === 0 ? branches : own;
  if (all.length >= 2) {
    const joined = all.length === 2 ? all.join(" or ") : `${all.slice(0, -1).join(", ")} or ${all[all.length - 1]}`;
    return `${/^[aeiou]/i.test(all[0]) ? "an" : "a"} ${joined}`;
  }
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
export function graveyardEnablesRecursion(
  producer: string, consumer: string, fill: { producerItself: boolean; returnsItself: boolean },
): string {
  if (fill.producerItself) return `When ${producer} is in the graveyard, ${consumer} can bring it back`;
  // A FILL OF OTHER CARDS -- a discard, a mill, a sacrifice of something else -- never puts the
  // producer there, and "When Chandra's Regulator is in the graveyard, Chandra, Acolyte of Flame can
  // bring it back" claimed an artifact comes back through an instant-and-sorcery recursion (#558).
  if (fill.returnsItself) return `${producer} can put ${consumer} into the graveyard, and it returns itself`;
  return `${producer} puts cards into the graveyard that ${consumer} can bring back`;
}

/** The same enabling shape, for a payoff that merely gets BIGGER per card in the graveyard rather
 *  than returning one (Bonehoard). Not a trigger either — `effect.scaling` fires nothing. */
export function graveyardFeedsScaling(producer: string, consumer: string, producerItself: boolean): string {
  // Ruin Crab mills; it is never the card in the graveyard (#558, the recursion sentence's twin).
  return producerItself
    ? `When ${producer} is in the graveyard, ${consumer} gets bigger`
    : `${producer} puts cards into the graveyard, and ${consumer} gets bigger`;
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
  producer: string, consumer: string, effectKind?: string, makesTheCounted = false, countsWhenCast = false,
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
  // A MAKER IS NOT COUNTED, ITS TOKENS ARE (issue #502): "While you control Inalla, Redoubled
  // Stormsinger counts it" named the wrong object -- Inalla is a commander, her copies are counted.
  if (makesTheCounted) return `${producer} makes the tokens ${consumer} counts, so ${consumer} ${grows}`;
  // A SPELL COUNTS ONCE, AS IT IS CAST (issue #506): "While you control Rumor Gatherer, Thwart the
  // Grave counts it" described an ongoing relation next to a ONCE badge.
  if (countsWhenCast) return `When you cast ${consumer}, it counts ${producer} and ${grows}`;
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
 *  token-doubling, damage-multiplier, counter-placement, mana-generation,
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
  producer: string, consumer: string, kind: string, noun?: string, keywords?: readonly string[],
): string {
  const phrase = kind === "type-grant" && noun
    ? `an extra ${noun} type`
    : kind === "keyword-grant" && keywords?.length
      ? keywordList(keywords)
      : GRANT_PHRASES[kind] ?? `its ${kind.replace(/-/g, " ")}`;
  return `${producer} gives ${consumer} ${phrase}`;
}

/** THE KEYWORDS A GRANT HANDS OUT, AS PROSE (`Ability.grants`, #857): "reach", "flying and first
 *  strike", "flying, first strike and trample". Only CR keyword abilities are ever listed, so a quoted
 *  ability (Feywild Visitor's trigger, the J12 case) still reads "an extra ability". */
export function keywordList(keywords: readonly string[]): string {
  return keywords.length <= 1 ? keywords.join("") : `${keywords.slice(0, -1).join(", ")} and ${keywords[keywords.length - 1]}`;
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

/** The WHOSE axis: every trigger the consumer has, not one event's. */
export function doublesClassSentence(producer: string, consumer: string): string {
  // Worded after the printed card ("that ability triggers an additional time"), so it says what
  // happens and does not end on "triggers" -- the page's mark for an unread effect (overview
  // persona rounds 2026-09-25, item 10: every seat asked why a read effect was marked unread).
  return `${consumer}'s triggered abilities trigger an additional time thanks to ${producer}`;
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

/** A PROCESSOR (AF7b): the producer put an opponent's card into exile, and the consumer's whole
 *  ability is spending such a card. Not a trigger the producer fires -- the card sits in exile
 *  until the processor comes -- so the sentence is an enabling fact, the recursion shape. */
export function processorSentence(producer: string, consumer: string): string {
  return `When ${producer} exiles an opponent's card, ${consumer} can process it`;
}

/** CR 704.5m: an Aura whose host leaves goes to the graveyard with it. The producer never touches
 *  the Aura; it removes the thing the Aura is attached to, so the sentence names the host by the
 *  Aura's own Enchant line ("what it enchants") and states the rule, not a trigger the producer
 *  fires. */
export function auraHostSentence(producer: string, consumer: string, hostNoun: string): string {
  return `${producer} removes the ${hostNoun} ${consumer} enchants, and ${consumer} goes to the graveyard with it`;
}

/** A count the consumer is GATED on, not one it grows with: Gadrak "can't attack unless you control
 *  four or more artifacts", Chrome Steed "as long as you control three or more artifacts", Urza's
 *  Workshop "activate only if". The producer is one of the things counted, so the sentence says
 *  what the card says -- the number and the class -- and claims nothing about what turns on.
 *  `noun` is the count's own word, plural as the card prints it ("artifacts", "Merfolk"). */
export function thresholdSentence(producer: string, consumer: string, atLeast: number, noun: string): string {
  return `${producer} counts toward the ${atLeast} or more ${noun} ${consumer} needs`;
}

/** A GRAVEYARD COUNT the consumer is gated on (AF7c): the producer fills the graveyard the count
 *  is of, so the sentence names whose graveyard and what is counted, and claims nothing about what
 *  turns on. Untyped counts say "cards", typed ones "creature cards". */
export function graveyardThresholdSentence(
  producer: string, consumer: string, atLeast: number, counted: { control?: string; type?: string | string[] },
): string {
  const whose = counted.control === "opp" ? "an opponent's" : counted.control === "you" ? "your" : "a";
  const first = Array.isArray(counted.type) ? counted.type.join(" or ") : counted.type;
  const noun = first ? `${first} cards` : "cards";
  return `${producer} fills ${whose} graveyard toward the ${atLeast} or more ${noun} ${consumer} needs`;
}

/** The plural a card prints for a counted class. Subtypes are proper nouns ("Shrines", "Humans");
 *  card types are not ("artifacts"). CEILING: English plurals by suffix -- Merfolk, Elves, Dwarves
 *  and the sibilants are spelled; anything else takes an s, which is right for every type and for
 *  the great majority of the 300-odd subtypes. */
export function countedNounPlural(subject: { subtype?: string | string[]; type?: string | string[] }): string {
  const first = (v: string | string[] | undefined): string | undefined => Array.isArray(v) ? v[0] : v;
  const subtype = first(subject.subtype);
  const word = subtype !== undefined ? subtype.charAt(0).toUpperCase() + subtype.slice(1) : (first(subject.type) ?? "permanent");
  if (/(?:folk|fish|sheep|moose)$/i.test(word)) return word;
  if (/(?:elf|arf)$/i.test(word)) return word.replace(/f$/i, "ves");
  if (/(?:s|x|z|ch|sh)$/i.test(word)) return `${word}es`;
  if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`;
  return `${word}s`;
}

export function fetchSentence(producer: string, consumer: string): string {
  return `${producer} can fetch ${consumer}`;
}

/** A CLASS-RESTRICTED DIG IS NOT A SEARCH (#750): Eclipsed Flamekin looks at the top cards and may
 *  find an Elemental there, it never searches the library -- and effect kind `search` covers both
 *  since the 2026-09-16 ruling, so the printed text is what tells them apart. */
export function digsRatherThanSearches(oracleText: string | undefined): boolean {
  const t = oracleText ?? "";
  return !/\bsearch(?:es)? (?:your|their|its owner's|that player's) library\b/i.test(t)
    && /\b(?:look at|reveal|exile) the top\b|\breveal cards from the top\b/i.test(t);
}

export function tutorSentence(producer: string, consumer: string, dig = false): string {
  return dig ? `${producer} can dig for ${consumer}` : `${producer} can search up ${consumer}`;
}

/** A typed recursion and a card of its class: the recursion is the producer, the card it can
 *  return the consumer, the same way a tutor and the card it finds are. */
export function recursionTargetSentence(producer: string, consumer: string): string {
  return `${producer} can bring back ${consumer}`;
}

/** A play-from-top permission and a card of its class (#856, owner 2026-09-30). */
export function playFromTopSentence(producer: string, consumer: string, land = false): string {
  return `${producer} lets you ${land ? "play" : "cast"} ${consumer} from the top of your library`;
}

/** An extra loyalty activation and a planeswalker it reaches (#859, owner 2026-09-30). */
export function extraLoyaltySentence(producer: string, consumer: string): string {
  return `${producer} lets ${consumer} activate its loyalty abilities again`;
}

/** An imprint and a card of its class (#860, owner 2026-09-30). */
export function imprintSentence(producer: string, consumer: string): string {
  return `${producer} can imprint ${consumer} and cast copies of it`;
}

/** A fill and the delve spell it pays for (CR 702.66): the producer puts cards in your graveyard,
 *  the consumer exiles them as mana. */
export function delveSentence(producer: string, consumer: string): string {
  return `${producer} fills the graveyard ${consumer} delves from`;
}

/** A conditional land's demand, stated as the relation it is: this land is better because that card
 *  carries the basic land type it names. Two templates, two different sentences — a check land is
 *  about ENTERING, a verge land is about ACTIVATING, and saying "enters untapped" about a verge is a
 *  wrong sentence. */
/** "Multiclass Baldric is switched on while you control Rumor Gatherer, a Wizard" (issue #514). */
export function creatureConditionSentence(producer: string, consumer: string, subtype: string): string {
  const noun = subtype.charAt(0).toUpperCase() + subtype.slice(1);
  return `${consumer} is switched on while you control ${producer}, ${/^[aeiou]/i.test(noun) ? "an" : "a"} ${noun}`;
}

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

/** A clone that enters as a copy of this card (#712). */
export function entersAsCopyOfSentence(producer: string, consumer: string): string {
  return `${producer} can enter as a copy of ${consumer}`;
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
/** A temporary copy's departure (issue #501): "Inalla's copy of Watcher for Tomorrow is exiled at
 *  end of turn, so the copy's leave ability triggers". */
export function temporaryCopySentence(producer: string, consumer: string, how: "exiled" | "sacrificed", ability: "leave" | "death"): string {
  return `${producer}'s copy of ${consumer} is ${how} at end of turn, and the copy's own ${ability} ability triggers`;
}

export function copySentence(producer: string, consumer: string, eventKey: string, dies: boolean): string {
  return dies
    ? `${producer} copies ${consumer}; the legend rule puts one of them into the graveyard, triggering its death ability`
    : `When ${consumer} ${eventVerbPhrase(eventKey)} because ${producer} copies it, its ability triggers again`;
}
