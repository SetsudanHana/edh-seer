/** A CARD'S CLAUSE RECORDS FROM ITS PRINTED TEXT ALONE (#896 task 7): the `ClauseRecord`s derive reads,
 *  built from the segmenter, the trigger grammar and the action grammar with no model answer.
 *
 *  A card is COMPLETE when every clause's trigger opening and every action phrase (its cost included)
 *  reads. Owner ruling 2026-10-02: a complete card derives from these records corpus-wide, the bought
 *  model answer kept only as the fallback for the rest. Until that switch this module is measured
 *  against the stored answers by `instruments/src/grammar-only.ts`. Pure and synchronous. */
import type { Action, ClauseRecord } from "../canonicalize.js";
import { interveningIfOf } from "../derive/intervening-if.js";
import { SELF_REFERENCE } from "../derive/self-reference.js";
import { segment, STATION_BAR } from "../segment.js";
import { amountOf, parseActions, unreadPhrases, type ActionReading } from "./action.js";
import { effectText, missedCost, printedPreamble, withoutAbilityWord } from "./preamble.js";
import { selfAsTilde } from "./self-as-tilde.js";
import { parseTrigger, type TriggerReading } from "./trigger.js";

export interface CardText { name: string; oracleText?: string; keywords?: string[]; typeLine?: string }
export interface GrammarRecords {
  records: ClauseRecord[];
  complete: boolean;
  /** Why not complete: the first clause that did not read, and how. */
  blocker?: { clause: number; kind: "trigger" | "action"; phrase?: string };
  /** Clause id -> the trigger and action grammar readings this function already computed while
   *  building `records` (G-T3, F2: derive re-parses the same clause text when it derives from these
   *  records). Threaded through `deriveInputOf` as `DeriveInput.readings`; `withGrammarActions` and
   *  `grammarTriggersOf` in `derive/derive.ts` use them instead of calling `parseActions` /
   *  `parseTrigger` again when they are present and safe to reuse verbatim. */
  readings?: Record<number, { trigger?: TriggerReading[]; actions?: ActionReading[] }>;
}

/** The verbs a trigger opening's event is printed with, to cut its subject off the front. */
const EVENT_VERB = /\s(?:dies|die|enters|enter|attacks|attack|blocks|block|becomes|become|is|are|deals|deal|casts|cast|gains|gain|loses|lose|draws|draw|discards|discard|sacrifices|sacrifice|leaves|leave|phases|gets|get|puts|put|plays|play|activates|activate|creates|create|mills|mill|explores|explore|taps|tap|untaps|untap|searches|search|cycles|cycle|scries|scry|surveils|surveil|exiles|exile|returns|return|fights|fight|transforms|transform|copies|copy|counters|was|were|has|have|would|can't|connives|proliferates?|expends|commits?|ventures?|completes?|crews?|saddles?|chooses?|reveals?|wins?|pays?|spends?|finishes?|unlocks?|opens?|rolls?|flips?|shuffles?|investigates?|forages?|descends?|faces?(?= a dilemma))\b/;
const PLAYER = /^(?:you|a player|an opponent|each player|each opponent|target opponent|that player|one or more players|another player)$/i;

/** WHOSE PHASE a phase trigger watches, which derive's repeats labeller reads: your turns only is
 *  once a round (per-cycle), anyone's ("each upkeep", "each combat", "the end step") once a turn. */
export function phaseControl(preamble: string): "you" | "opp" | "any" {
  if (/^at the beginning of (?:your|each of your)\b|\bon your turns?\b/i.test(preamble)) return "you";
  if (/^at the beginning of (?:each opponent's|each of your opponents')|\bon each opponent's turn\b|\bon an opponent's turn\b/i.test(preamble)) return "opp";
  return "any";
}

/** The store's `trigger.subject`: what the event happens to, and for an ACTOR trigger ("you discard a
 *  card", "an opponent casts a spell") the OBJECT, which is what derive's self and antecedent readings
 *  key on. */
/** `^a spell or ability(?: an opponent controls| you control)? causes? (.+?) to (be )?(.+)$`, read by string
 *  search: the regex form backtracks polynomially on repeated "a to a" (CodeQL js/polynomial-redos). Returns
 *  [whole, object, "be " | undefined, event] like the regex's exec, or null. */
function causedEventParts(rest: string): [string, string, string | undefined, string] | null {
  const lower = rest.toLowerCase();
  let at = -1;
  for (const head of ["a spell or ability an opponent controls ", "a spell or ability you control ", "a spell or ability "]) {
    if (!lower.startsWith(head)) continue;
    const tail = lower.slice(head.length);
    const verb = tail.startsWith("causes ") ? 7 : tail.startsWith("cause ") ? 6 : -1;
    if (verb >= 0) { at = head.length + verb; break; }
  }
  if (at < 0) return null;
  const to = lower.indexOf(" to ", at + 1);
  if (to < 0) return null;
  const object = rest.slice(at, to);
  let event = rest.slice(to + 4);
  const be = /^be /i.test(event) ? event.slice(0, 3) : undefined;
  if (be) event = event.slice(3);
  if (!event) return null;
  return [rest, object, be, event];
}

export function triggerSubjectText(preamble: string): string {
  // A PHASE TRIGGER names whose phase: "your upkeep" is yours, "each upkeep" / "the end step" anyone's.
  const phase = /^at the beginning of (your|each|the|each player's|each opponent's|that player's)\b/i.exec(preamble);
  if (phase) return /^your$/i.test(phase[1]!) ? "you" : /opponent/i.test(phase[1]!) ? "each opponent" : "each player";
  let rest = preamble.replace(/^(?:when|whenever|at)\s+/i, "");
  // "A SPELL OR ABILITY AN OPPONENT CONTROLS CAUSES A LAND TO BE PUT into your graveyard" (Sacred Ground,
  // #1253): the cause is no part of the subject. Cut at the first event verb, the head was the whole
  // cause plus half the event ("a spell or ability an opponent controls causes a land to be"), and
  // derive read "an opponent controls" as the LAND's controller. The caused event reads as its own
  // sentence, the way the trigger grammar reads it (`causedEvent`): "a land is put into ...", "you
  // discard this card".
  const caused = causedEventParts(rest);
  if (caused) rest = `${caused[1]} ${caused[2] ? "is " : ""}${caused[3]}`;
  // The land is put into YOUR graveyard, so it is yours: the subject says so, as "a creature you control
  // dies" does (Koll). CEILING: a graveyard is its owner's, so a stolen land is yours only by ownership.
  const ownGraveyard = caused !== null && !!caused[2] && /\binto your graveyard\b/i.test(caused[3]!);
  const v = EVENT_VERB.exec(rest);
  const head = (v ? rest.slice(0, v.index) : rest).trim();
  // "a basic land is tapped for mana OF THE CHOSEN COLOR" (Gauntlet of Power): the colour is part of which taps the trigger hears, and the store keeps it in the subject
  // ("a basic land tapped for mana of the chosen color"). Cut at the verb it was dropped, and the mana line read an unconditional land trigger.
  const chosen = /\b(?:is|are) (tapped for mana of the chosen colou?r)$/i.exec(rest);
  if (chosen && v && head !== "" && /^(?:a|an|each) /i.test(head)) return `${head} ${chosen[1]}`;
  if (v && PLAYER.test(head)) {
    // "you cast or cycle ~": the second verb is the event's, not the object's.
    const obj = rest.slice(v.index + v[0].length).trim().replace(/^or \w+ /i, "");
    // "you put one or more counters on a creature you don't control": the store names the creature.
    const on = /\bcounters? on (.+)$/i.exec(obj);
    if (on) return on[1]!;
    if (obj) return obj;
  }
  return ownGraveyard && head !== "" ? `${head} you control` : head;
}

const SELF_SUBJECT = /^(?:~|this [a-z]+)$/i;
/** Verbs the player does with nothing after them, whose stored object is "you". */
const NO_OBJECT_YOU = new Set(["monarch", "initiative", "ring-tempts", "learn", "venture-into-the-dungeon", "manifest-dread", "investigate", "populate", "win-game", "lose-game", "time-travel"]);
/** Verbs whose stored object can be the PLAYER it happens to ("target player mills two cards" ->
 *  "target player"), the convention derive's `PLAYER_OBJECT_VERBS` reads. */
const PLAYER_VERBS = new Set(["draw", "mill", "discard", "scry", "surveil", "gain-life", "lose-life", "blight"]); // blight: "target opponent blights 2" names the opponent (Champion of the Weird); your own "blight 2" keeps its amount as the object
const ZONE_VERBS = new Set(["destroy", "exile", "sacrifice", "return", "put", "shuffle"]);
// "put that card ON TOP" (Cruel Tutor): where it goes is no part of which card it is.
const BACK_REFERENCE = /^(?:it|them|him|her|that card|those cards|that creature|that permanent|the card|the cards|one|the other|the rest|one of them|those)(?: on (?:top|the bottom)(?: of (?:your|their|its owner's) library)?)?$/i;

// One card, named by a back-reference: after an exile of "one of them" it is the exiled card (Discover the Impossible: "put that card into
// your hand"), where "the rest" / "the other" are still the looked-at library.
const SINGULAR_REF = /^(?:it|that card|the card)$/i;

/** A reading's object as the store writes it: the printed object words, without a zone move's
 *  destination ("that card into your graveyard" -> "that card"). */
function objectWords(r: ActionReading): string {
  const raw = objectWordsOf(r);
  if (!r.lookedAt) return raw;
  const w = raw.replace(/ back$/, "");
  // "If it's a creature card, ... put it into your hand": the store writes the condition's type as the object ("a creature card").
  // Here, not in parseActions: the reading keeps the printed "it", and this is where printed words become the store's.
  if (r.fromZone === "library" && BACK_REFERENCE.test(w) && r.condition !== undefined) {
    const t = /^if (?:it(?:'s| is) an?|that card is(?: an?)?) (.+?)(?: card)?$/i.exec(r.condition.trim());
    if (t && !/\b(?:card|with|mana)\b/i.test(t[1]!)) return `${/^[aeiou]/i.test(t[1]!) ? "an" : "a"} ${t[1]} card from ${r.lookedAt}`;
  }
  // "Otherwise, put it into your graveyard" / "If you don't put the card into your hand, put it into your graveyard": the card the condition
  // above did NOT take, so it is never the earlier put's type ("a creature card") -- the looked-at card, untyped, from your library.
  if (r.fromZone === "library" && SINGULAR_REF.test(w) && r.condition !== undefined && /^(?:otherwise|if you (?:don't|didn't|do not|did not)\b)/i.test(r.condition.trim())) return r.lookedAt;
  // The look's library, in the words the store uses: "the rest of the top four cards of your library".
  if (/^the rest$/i.test(w)) return `${w} of ${r.lookedAt}`;
  const some = /^(.+) of (?:them|those cards)$/i.exec(w);
  if (some) return `${some[1]} of ${r.lookedAt}`;
  return r.text !== undefined ? `${w} from ${r.lookedAt}` : w;
}

function objectWordsOf(r: ActionReading): string {
  // A COUNTER's object is its kind, the recipient in front when it is named and not the card itself
  // ("target creature, +1/+1") -- exactly the form derive's grammar switch writes for a stored one.
  if (r.counter !== undefined) {
    // The store writes a named kind as "charge counter" and a P/T kind bare ("+1/+1").
    const kind = /^[+-]/.test(r.counter) ? r.counter : `${r.counter} counter`;
    return r.text !== undefined && r.object?.self !== true ? `${r.text}, ${r.counter}` : kind;
  }
  // The card itself: "~" is the census's spelling, "this" the store's, which derive's self reading keys on.
  // "this creature" too: derive would type the self ("creature") and lose an artifact creature's
  // artifact side (Coretapper's sacrifice feeding artifact recursion).
  if (r.text !== undefined) return r.text === "~" ? "this" : r.text;
  // "cast that card WITHOUT PAYING ITS MANA COST" (Sunforger): the tail is how, not which card.
  const p = (r.phrase ?? "").replace(/ until end of turn$/i, "").replace(/ without paying (?:its|their) mana costs?$| for as long as (?:it|they) remains? exiled$/i, "").replace(/ instead of putting (?:it|them) .*$/i, "");
  if (!ZONE_VERBS.has(r.verb)) return p;
  // Not the "to" of "up to four target cards" (Stream of Consciousness).
  // Not "from their graveyard": where it comes from is part of the object, as the store writes it (Exhume).
  // Not the "to" of "up to four target cards" (Stream of Consciousness, Wakka).
  // ...and "on the bottom" with no library after it ("Put the rest on the bottom in a random order", There's Coffee in that Nebula): where the rest goes, not which cards.
  const at = p.search(/ (?:onto|into|on top of|on the bottom(?: of)?) |(?<!\bup) to /);
  return (at > 0 ? p.slice(0, at) : p).replace(/ (?:tapped|face down)$/, "");
}

/** "unless that player pays {X}", "unless you pay {W}": the store's `unless` (CR 118.12a), its payer
 *  "you" or the other player ("controller"). */
function unlessOf(condition: string | undefined): Action["unless"] | undefined {
  const m = condition ? /(?:^|, )unless (.+?) (?:pays?) (.+)$/i.exec(condition) : null;
  // "unless that player pays {1}" (Rhystic Study): the opponent the trigger named.
  // "unless any player pays {1}" (Rhystic Cave) is anyone's payment, which the schema's closed set names "any" (and the stored answer writes).
  return m ? { cost: m[2]!.trim(), payer: /^you$/i.test(m[1]!) ? "you" : /^(?:that player|that opponent|they)$/i.test(m[1]!) ? "opponent" : /^any player$/i.test(m[1]!) ? "any" : "controller" } : undefined;
}

/** The count an object's words state when the reading carries none, as the store writes it: "the top
 *  two cards of your library" 2, "the next 2 damage" 2, "X mana of any one color" X, "an additional
 *  land" 1. */
function wordsAmount(verb: string, object: string): string | undefined {
  // An X the sentence defines ("X mana ..., where X is the greatest toughness") is no X paid: the
  // amount stays off, or derive reads it as the spell's X (Arbor Adherent).
  if (/, where x is\b/i.test(object)) return undefined;
  const top = /^the (?:top|bottom) (\w+) cards?\b/i.exec(object) ?? /^the next (\w+) damage\b/i.exec(object);
  if (top) return amountOf(top[1]!) ?? (/^x$/i.test(top[1]!) ? "X" : undefined);
  if (verb === "add-mana" && /^x mana\b/i.test(object)) return "X";
  if (verb === "play" && /^an additional land$/i.test(object)) return "1";
  return undefined;
}

/** A damage reading's recipient when its words carry the damage too: "10 damage to that player",
 *  "damage equal to the number of cards in target player's hand to that player" -> "that player";
 *  a bare "2 damage" ("deals 2 damage instead") is the recipient of the damage before it. */
function damageWords(words: string, out: Action[]): string {
  const to = /^(?:(?:\d+|x) )?damage(?: equal to .+?)? to (.+?)(?: equal to .+)?$/i.exec(words);
  if (to) return to[1]!;
  if (/^(?:\d+|x) damage$/i.test(words)) return [...out].reverse().find((a) => a.verb === "deal-damage")?.object ?? words;
  return words;
}

/** One clause's readings as `Action`s. A back-referenced object moved after a search comes from the
 *  library, the zone the store writes for it (Farseek, Entomb, every fetchland). */
function actionsOf(readings: ActionReading[], selfTrigger: string | undefined, type?: string, selfWord = "this", triggerSubject?: string, triggerEvent?: string): Action[] {
  const out: Action[] = [];
  // "Reveal a card IN YOUR HAND, then put that card onto the battlefield": the reveal is dropped, its
  // zone is the antecedent's (Retraced Image).
  let revealedFrom: string | null = null;
  for (const reading of readings) {
    // "It becomes a 0/0 Spirit creature in addition to its other types" (#1352): an animate whose words carry its becomes-phrase. "It" is resolved EXACTLY as the bare
    // pronoun is (the card itself, or the target the clause named before: Tawnos's Tinkering), and the phrase is put back after the resolved object.
    const becomesHead = reading.verb === "animate" && reading.text === undefined ? ["it", "that land", "that creature", "that permanent", "that artifact"].find((h) => reading.phrase?.startsWith(`${h} becomes `)) : undefined;
    const itBecomes = becomesHead !== undefined ? reading.phrase!.slice(becomesHead.length) : "";
    // "that land becomes ..." keeps its own words when no earlier action names the class (the words are already the object); "it" is re-attached to what it resolves to.
    const r: ActionReading = becomesHead === "it" ? { ...reading, phrase: "it" } : reading;
    // "Reveal it" is bookkeeping the store drops (canonicalize's DROPPED_VERBS).
    // "reveal the top card of your library. If it's a land card, put it onto the battlefield" (Thrasios).
    if (r.verb === "reveal") { const rv = r.phrase ?? r.text ?? ""; revealedFrom = /\b(?:in|from) your hand\b/i.test(rv) ? "hand" : /\btop (?:\w+ )?cards? of (?:your|their) library\b/i.test(rv) ? "library" : null; continue; }
    // "When this creature blocks, return IT": with nothing before it, "it" is the card itself, written
    // as the trigger names it ("this creature"), which derive's self and type readings key on.
    // As derive's grammar switch writes a player verb's object: a named actor ("target player mills")
    // is the object, a back-referenced one ("that player") or none leaves the printed words.
    // "At the beginning of your end step, if THIS CREATURE didn't enter ..., return IT" (Cactuar): a
    // first "it" with no trigger object to name is the clause's own "this creature".
    const selfIt = out.length === 0 && !selfTrigger && selfWord !== "this" && /^it$/i.test(objectWords(r)) && !r.actor
      && (triggerSubject === undefined || /^(?:you|each player|each opponent)$/i.test(triggerSubject));
    // "put that card on top" (Enlightened Tutor): on top of YOUR library, as the store writes it.
    // "Target player takes an extra turn" (Walk the Aeons): the player is the object, as stored.
    // "Exile this card from your graveyard" (a cost): the card itself, its zone stated apart.
    const words0 = r.verb === "extra-turn" && r.actor?.text && r.actor.scope !== "that" ? r.actor.text
      : r.verb === "deal-damage" ? damageWords(objectWords(r), out) : selfIt ? selfWord : objectWords(r) === "~" ? "this" : objectWords(r).replace(/^(that card|it|them|those cards) on top$/i, "$1 on top of your library");
    const words = words0.replace(/^(this (?:card|creature|artifact|enchantment|land)) from your graveyard$/i, "$1");
    // "that creature's controller mills two cards" (Riddlekeeper): a player named through an object is
    // named outright too; a bare "that player" leaves the printed words.
    const object = PLAYER_VERBS.has(r.verb) ? (r.actor?.text !== undefined && !(r.verb === "blight" && /^you$/i.test(r.actor.text)) && (r.actor.scope !== "that" || /'s (?:controller|owner)$/i.test(r.actor.text)) ? r.actor.text : words || "you")
      : selfTrigger && out.length === 0 && /^(?:it|itself)$/i.test(words) ? selfTrigger
      // "this creature becomes prepared", "it explores" (Jenny): a subject action of the card itself.
      : !words && r.object?.self === true ? selfTrigger ?? selfWord
      : !words && selfTrigger && r.object?.ref && out.length === 0 ? selfTrigger
      // "defending player exiles two permanents THEY control": the actor's, as the store names it.
      // "target player exiles a card from THEIR graveyard" (Scrabbling Claws): the actor's, as the store names it.
      : r.actor?.text && r.actor.control !== "you" ? words.replace(/\bthey control$/i, `${r.actor.text} controls`).replace(/\btheir (graveyard|hand|library)\b/i, `${r.actor.text}'s $1`) : words;
    // WHERE A MOVED THING COMES FROM, when the phrase does not say, as the store writes it: a
    // back-reference after a search comes from the library, after an exile from exile ("exile ...,
    // then return that card", Thassa). A permanent named outright is left unstated, as the store
    // mostly leaves it (Beast Within; defaulting it to the battlefield moved 2,348 cards).
    const ref = BACK_REFERENCE.test(object);
    const before = [...out].reverse().find((a) => a.verb === "search" || a.verb === "exile");
    // An exile "from among them" of a looked-at library leaves the rest in the library; an exile that
    // MOVED the top cards ("Exile the top three cards of your library") leaves the rest in exile.
    const looksAtLibrary = readings.slice(0, readings.indexOf(r)).reverse().find((x) => x.verb === "search" || x.verb === "exile")?.lookedAt !== undefined;
    // "Until end of turn, you may cast THAT CARD" after an exile: from exile, as the store writes it.
    const castRef = (r.verb === "cast" || r.verb === "play") && ref && before?.verb === "exile" ? "exile"
      // "reveal the top card of your library ... cast that card" (Powerbalance); "cast the exiled card",
      // "cast any number of cards exiled with this creature" (Izzet Chemister, Smuggler's Buggy).
      : (r.verb === "cast" || r.verb === "play") && ref && before === undefined && revealedFrom ? revealedFrom
      : (r.verb === "cast" || r.verb === "play") && /\bexiled\b/i.test(object) && !/\bthis way\b/i.test(object) ? "exile" : null;
    // "return this enchantment to its owner's hand": the card itself leaves the battlefield.
    const selfBounce = ((r.verb === "return" || r.verb === "put") && (r.object?.self === true || selfIt) && (r.toZone === "hand" || r.toZone === "library") ? (type === "spell" ? "stack" : "battlefield")
      // "Exile any number of target spells" (Mindbreak Trap): spells are on the stack.
      : r.verb === "exile" && /\btarget (?:[\w ]+ )?spells?\b/i.test(object) ? "stack"
      // "Exile this enchantment" (Sapling Nursery, Lantern of the Lost): a permanent exiling itself.
      : r.verb === "exile" && r.object?.self === true && type !== "spell" && !/\bcard\b/i.test(object) ? "battlefield"
      // "return that creature to its owner's hand" with nothing searched or exiled before: a permanent.
      : r.verb === "return" && r.toZone === "hand" && /^that (?:creature|permanent)$/i.test(object) && before === undefined ? "battlefield"
      // "Shuffle Beacon of Immortality into its owner's library": a spell shuffles itself from the stack.
      : r.verb === "shuffle" && r.object?.self === true && type === "spell" ? "stack" : null);
    // "put it back on top of your library" (Triumph of Saint Katherine), "put the chosen cards on top of your library"
    // (Doomsday): the player restacking cards of THEIR library, a library to library put. Read by the DESTINATION
    // "on top of", never "bottom of": "put each other card exiled this way on the bottom of your library" (Codie) comes from exile.
    // A bare pronoun needs "back" and a pile shuffled before it: "Exile target creature. Put it on top of its owner's library"
    // is the exiled creature, from exile, and the back-reference branch below keeps that reading.
    // CEILING: Gishath's "Dinosaur creature cards from among them" put has no sentence naming its source, so its
    // fromZone stays null, and Codie's "each other card exiled this way ... bottom" is null by the same strictness.
    const topPut = r.verb === "put" && r.toZone === "library"
      && (/^(?:that pile|the chosen cards|those cards)$/i.test(object) || (/^(?:it|them) back$/i.test(object) && out.some((a) => a.verb === "shuffle")))
      && /\bon top of (?:your|their|its owner's) library\b/i.test(r.phrase ?? r.text ?? "") ? "library" : null;
    const from = r.fromZone ?? castRef ?? selfBounce ?? topPut ?? (!ZONE_VERBS.has(r.verb) || r.verb === "shuffle" ? null
      : ref ? (before?.verb === "search" ? "library" : before?.verb === "exile" ? (looksAtLibrary && !SINGULAR_REF.test(object) ? "library" : "exile") : before !== undefined ? null
        // "When enchanted creature dies, return that card": the card the trigger put in the graveyard.
        // "Counter target spell. If that spell is countered this way, exile it instead": still on the stack.
        : r.verb === "exile" && out.some((a) => a.verb === "counter-spell") ? "stack"
        : revealedFrom ?? (/^(?:dies|sacrificed|put-into-graveyard|discarded|milled)$/.test(triggerEvent ?? "") && out.length === 0 ? "graveyard" : null))
      // "that many cards from the bottom of your library": the library the words name.
      // "target exiled card with warp", "target card you own in exile": it leaves exile, wherever it lands.
      : /\b(?:exiled cards?|in exile)\b/i.test(object) ? "exile"
      // Only a SOURCE: "on the bottom of its owner's library" is where a card lands, not where it was.
      : /\bfrom the (?:top|bottom) of (?:your|their|its owner's|that player's|target player's) library\b/i.test(r.phrase ?? r.text ?? "") ? "library"
      // A set the sentence made: cards milled are in the graveyard, cards revealed in the library
      // (Szarekh's "from among the cards milled this way", Glint Raker's "revealed this way" and "the rest").
      : /\bmilled\b/i.test(object) ? "graveyard"
      // "exile up to two target cards from a single graveyard" (Faerie Macabre, Shred Memory).
      : /\bfrom (?:a single |target player's |an opponent's |each opponent's |any )?graveyards?\b/i.test(object) ? "graveyard"
      // "return the exiled card" (Champion of the Path), "cast any number of cards exiled with this
      // creature" (Izzet Chemister), "target face-up exiled card": from exile.
      : /\bexiled\b/i.test(object) && !/\bthis way\b/i.test(object) ? "exile"
      // "return target creature that player controls to its owner's hand": a permanent, so from the battlefield.
      : r.verb === "return" && r.toZone === "hand" && /\bcontrols?\b/i.test(object) && !/\bcards?\b/i.test(object) ? "battlefield"
      : (/\brevealed this way\b/i.test(object) || (/^the rest$/i.test(object) && before === undefined && out.some((a) => /\brevealed this way\b/i.test(a.object ?? "")))) ? "library"
      // An EXILE of a permanent named outright leaves the battlefield, the zone the store writes for an
      // exile (Baleful Mastery, Thassa); a destroy or sacrifice it leaves unstated, so they are not.
      : r.verb === "exile" && r.object && !r.object.ref && !r.object.self && !/\bcards?\b|\bspells?\b/i.test(object) && r.object.zone === undefined ? "battlefield" : null);
    // "put one onto the battlefield TAPPED": the tap is on what just moved, written as the store does.
    // "Put two +1/+1 counters on target creature and UNTAP IT", "If that creature is a Snake, IT gets
    // +2/+2": "it" is the target the clause named before, as the store writes it.
    // "Goad THEM", "gain control OF IT", and "it" after the first action of a self trigger (Slimy Piper)
    // or an Aura's trigger on its host (Bestial Fury) too.
    // "untap THAT CREATURE", "deals 10 damage to THAT PLAYER": the target named before, as the store writes it.
    const pronoun = /^(?:it|them|control of (?:it|them|that creature))$/i.test(object) && !ZONE_VERBS.has(r.verb);
    // "that player" names only a target player, "that creature" only a target creature.
    const noun = /\bthat (creature|player)$/i.exec(object)?.[1];
    const target = pronoun && out.length > 0 ? [...out].reverse().map((a) => /^((?:up to (?:one|two|three) )?(?:another )?targets? [^,]+)/i.exec(a.object ?? "")?.[1]?.split(" becomes ")[0])
      .find((t) => t && (!noun || new RegExp(`\\b${noun}`, "i").test(t))) : undefined;
    // "Exile a creature card from the top four cards ... you may cast IT" (Durnan): the exiled card, never the
    // trigger's own card.
    const exiledBefore = pronoun && r.verb === "cast" ? /^an? (?:([\w -]+?) )?card\b/i.exec([...out].reverse().find((a) => a.verb === "exile")?.object ?? "") : null;
    const exiledCard = exiledBefore ? `the exiled ${exiledBefore[1] ? `${exiledBefore[1]} ` : ""}card` : undefined;
    const named = target ?? exiledCard ?? (!pronoun ? undefined : out.length > 0 && selfTrigger ? selfTrigger
      : /^(?:enchanted|equipped) [a-z]+$/i.test(triggerSubject ?? "") ? triggerSubject : undefined);
    // The whole target class, "target artifact, creature, or land you control", less the counter kind a put's object appends: the store's object for the animate.
    const wholeClass = itBecomes && (becomesHead !== "it" || (named !== undefined && named !== selfTrigger))
      ? [...out].reverse().map((a) => a.object ?? "").find((o) => /^(?:up to (?:one|two|three) )?(?:another )?targets? /i.test(o))?.split(" becomes ")[0]?.replace(/, (?:[+-]\d+\/[+-]\d+|[\w-]+ counter)$/i, "") : undefined;
    const itsAntecedent = wholeClass ?? named ?? "";
    // ...and the card itself when nothing names another: the first action of a clause naming "this <noun>" (the Opal cycle's "if this permanent is an enchantment, it becomes a 3/4
    // Gargoyle creature"), or an antecedent that already is "this <noun>". The store's spelling is a bare "this".
    const selfItBecomes = itBecomes !== "" && becomesHead === "it" && (selfOnly(itsAntecedent || object) || (out.length === 0 && !selfTrigger && selfWord !== "this" && !itsAntecedent));
    const tapped = r.verb === "tap" && !object && out.length > 0 ? out[out.length - 1]!.object ?? "" : "";
    // "from your hand and/or graveyard": one move from each, as the store writes it (Worldsoul's Rage).
    // "all cards from all hands and graveyards" (Worldfire) too: one exile from each.
    const both = /^(.+?) from your hand and\/or graveyard$/i.exec(object) ?? /^(.+?) from all hands and graveyards$/i.exec(object);
    if (both && !r.fromZone) {
      const all = /all hands/i.test(object);
      for (const zone of ["hand", "graveyard"]) out.push({ verb: r.verb, object: all ? `${both[1]} from all ${zone === "hand" ? "hands" : "graveyards"}` : object, fromZone: zone, toZone: r.toZone ?? null, ...(r.amount !== undefined ? { amount: r.amount } : {}), optional: r.optional === true } as Action);
      continue;
    }
    // "return her to the battlefield TRANSFORMED" (Liliana, Heretical Healer): the store's transform too.
    const transformed = (r.verb === "return" || r.verb === "put") && /\bto the battlefield (?:under [\w' ]+ control )?transformed\b/i.test(r.phrase ?? "");
    // "Creatures can't attack you unless their controller pays {2} ..." (Propaganda): the payment is
    // the action's `unless`, as the store writes it, not part of what can't happen.
    const cantUnless = r.verb === "cant" && !r.condition ? /^(.+?) (unless .+? pays? .+)$/i.exec(object) : null;
    if (cantUnless) {
      out.push({ verb: r.verb, object: cantUnless[1]!, fromZone: null, toZone: null, optional: r.optional === true, unless: unlessOf(cantUnless[2]!) } as Action);
      continue;
    }
    out.push({
      // A proliferate chooses any permanents and players (CR 701.34a), not only yours.
      // "Its controller investigates" (Fateful Absence): the named actor, else you.
      verb: r.verb, object: `${itBecomes && selfItBecomes ? "this" : itsAntecedent || object || tapped || (NO_OBJECT_YOU.has(r.verb) ? r.actor?.text ?? "you" : r.verb === "proliferate" ? "any" : object)}${itBecomes && (becomesHead === "it" || wholeClass !== undefined) ? (selfItBecomes ? itBecomes.replace(/ in addition to (?:its|their) other types$/i, "") : itBecomes) : ""}`,
      fromZone: from, toZone: r.toZone ?? null,
      ...(r.amount !== undefined ? { amount: r.amount } : wordsAmount(r.verb, object) !== undefined ? { amount: wordsAmount(r.verb, object) } : {}),
      optional: r.optional === true,
      ...(unlessOf(r.condition) ? { unless: unlessOf(r.condition) } : {}),
    } as Action);
    if (transformed) out.push({ verb: "transform", object, fromZone: null, toZone: null, optional: false } as Action);
  }
  return out;
}

/** The card itself ("this land", "this creature") and nothing after it. An animate's words open with a bare "this" then, the store's spelling: derive cuts "this land becomes ..." at the
 *  self-reference and drops the result (`SELF_REFERENCE`, derive.ts). */
function selfOnly(object: string): boolean {
  const m = SELF_REFERENCE.exec(object);
  return m !== null && m[0].length === object.length;
}

/** A trigger word inside a sentence: the "whenever" of a delayed trigger a chapter creates. */
const DELAYED_TRIGGER_WORD = /\b(?:whenever|when|at the beginning of|at the end of|at end of)\b/i;

/** A STATION ROW'S "Flying, first strike" is ONE grant of a keyword list, as the store writes it for Wedgelight Rammer: derive reads the whole
 *  list off each grant-ability action, so one action per keyword derived the same gated keyword-grant once per keyword. Plain keywords, side by side.
 *  CEILING: only a Station row. Elsewhere the store mostly writes one action per keyword ("gain vigilance, trample, and indestructible" derives the
 *  grant three times: Song of Freyalise, Entropic Battlecruiser, some 450 bought cards), and merging them made 340 bought cards switch to the grammar
 *  (measured 2026-10-26, 34 of them losing an ability), so the grammar keeps the duplicates the store has. */
const PLAIN_KEYWORD = /^[a-z]+(?:, [a-z]+| [a-z]+)*$/i;
function mergeKeywordGrants(actions: Action[]): Action[] {
  const merged: Action[] = [];
  for (const a of actions) {
    const last = merged[merged.length - 1];
    if (last && a.verb === "grant-ability" && last.verb === "grant-ability" && PLAIN_KEYWORD.test(a.object ?? "") && PLAIN_KEYWORD.test(last.object ?? "")
      && a.unless === undefined && last.unless === undefined && a.optional === last.optional) { merged[merged.length - 1] = { ...last, object: `${last.object}, ${a.object}` } as Action; continue; }
    merged.push(a);
  }
  return merged;
}

export function grammarClauseRecords(card: CardText): GrammarRecords {
  const records: ClauseRecord[] = [];
  const clauses = segment(card.oracleText ?? "", card.keywords ?? [], card.typeLine ?? "");
  // A TWO-EVENT TRIGGER ("enters or leaves the battlefield", "attacks or blocks") is two records, the
  // second numbered after the card's last clause -- the store's convention (`validate-clauses.ts`),
  // which derive reads back to the parent's text.
  // CEILING: when the first record's own reading already yields the second event ("Whenever you attack ... and whenever a God dies", Kratos), the overflow
  // record reads it a second time: a harmless twin, kept because the store's convention numbers it.
  const overflow: ClauseRecord[] = [];
  let nextId = Math.max(0, ...clauses.map((c) => c.id)) + 1;
  const readings: Record<number, { trigger?: TriggerReading[]; actions?: ActionReading[] }> = {};
  for (const c of clauses) {
    // A SAGA'S REMINDER LINE ("(As this Saga enters and after your draw step, add a lore counter. Sacrifice after III.)") is the store's
    // inert record, the text as printed (CR 714.3 and 704.5s are what it reminds of). Any other reminder-only line states nothing and has no record.
    if (c.kind === "reminder") {
      if (/^\(As this Saga enters\b/.test(c.text)) records.push({ id: c.id, abilityType: "none", actions: [{ verb: "none", object: c.text } as Action] });
      continue;
    }
    if (c.kind === "keyword") { records.push({ id: c.id, abilityType: "none", actions: [{ verb: "none", object: c.text } as Action] }); continue; }
    // A mana cost behind a label the segmenter missed makes the clause ACTIVATED, carrying that cost.
    const labelled = !c.cost && (c.abilityType ?? "static") === "static" ? missedCost(c.text) : null;
    const type = labelled ? "activated" : c.abilityType ?? "static";
    const record: ClauseRecord = { id: c.id, abilityType: type, actions: [] };
    // A SAGA CHAPTER ("I, II — ...") is fired by the lore counter reaching its number (CR 714.2b: "{rN}—[Effect]"), not by an event the trigger
    // grammar reads: the store writes `{event: "chapter", subject: "chapter <marker>", control: "you"}` (385 of 571 stored chapters; 186 write the bare marker) and derive reads the event as "once" (repeats.ts).
    // A chapter whose text OPENS with a trigger word ("II, III — Whenever you cast a noncreature spell this turn, ...") keeps its printed
    // trigger, as before: the store has that chapter's trigger as the cast, not the chapter.
    // CEILING: a chapter that states a trigger further in ("III — Until end of turn, whenever a Salamander deals combat damage to a player,
    // it deals that much damage ...", Nightmares and Daydreams) is REFUSED, not read as a chapter: read so, its effect would fire at the chapter
    // with the "whenever" dropped, a claim the text does not make (the stored answer keeps it unclaimed or triggered).
    const bareChapter = c.kind === "chapter" && type === "triggered" && c.marker !== undefined && printedPreamble(c.text, card.name) === null;
    const delayedWord = bareChapter ? DELAYED_TRIGGER_WORD.exec(c.text.replace(/"[^"]*"/g, " ")) : null;
    if (delayedWord) {
      const rest = c.text.slice(c.text.toLowerCase().indexOf(delayedWord[0].toLowerCase()));
      const comma = rest.indexOf(",");
      return { records, complete: false, blocker: { clause: c.id, kind: "trigger", phrase: comma > 0 ? rest.slice(0, comma) : rest } };
    }
    // A REFLEXIVE "When you do" after a chapter's first sentence ("I — Mill five cards. When you do, this Saga deals damage ...", Kraven's Last
    // Hunt; the segmenter makes it a clause of its own) is that chapter's own ability (CR 603.12), so once: the chapter's trigger, as the store has it.
    // So is the ONE delayed trigger the chapter sets up ("... At the beginning of the next combat this turn, gain control of that creature", The Wrath
    // of Khan): read as a phase trigger on anyone's combat it fired every turn (per-turn), where it fires the once.
    const reflexiveChapter = c.kind === "chapter" && c.marker === undefined && type === "triggered" && /^(?:when you do,|at the beginning of the next )/i.test(c.text);
    const parentMarker = reflexiveChapter ? [...clauses].reverse().find((p) => p.id < c.id && p.kind === "chapter" && p.marker !== undefined)?.marker : undefined;
    const chapterOnly = bareChapter || (reflexiveChapter && parentMarker !== undefined);
    if (chapterOnly) record.trigger = { event: "chapter", subject: `chapter ${c.marker ?? parentMarker!}`, control: "you" };
    // A MODE of a triggered modal ability is typed triggered (the store's convention) but has no trigger of
    // its own: the parent's trigger is its trigger. Only a mode that prints its own ("When ..., ...") reads one.
    if (!chapterOnly && type === "triggered" && !(c.kind === "mode" && !/^\s*(?:whenever|when|at the beginning of|at end of)\b/i.test(c.text))) {
      const preamble = printedPreamble(c.text, card.name);
      const read = preamble ? parseTrigger(preamble, interveningIfOf(selfAsTilde(c.text, card.name))) : null;
      if (!read) return { records, complete: false, blocker: { clause: c.id, kind: "trigger", ...(preamble ? { phrase: preamble } : {}) } };
      const reads = [read].flat();
      readings[c.id] = { trigger: reads };
      const first = reads[0]!;
      const phaseTrigger = /^at the beginning of\b/i.test(preamble!);
      record.trigger = { event: first.event, subject: triggerSubjectText(preamble!), control: phaseTrigger ? phaseControl(preamble!) : first.control ?? "any" };
      // "When Brinelin enters AND WHENEVER you cast a spell with mana value 6 or greater": the second
      // event has its own subject; "enters or attacks" shares the first's.
      const second = /\b(?:and|or) whenever (.+)$/i.exec(preamble!)?.[1];
      // The segmenter's two-event flag is anchored at the front and stops at the first comma, so a label
      // ("Do You Like Squirrels? — ") or a comma in the card's name ("Wernog, Rider's Chaplain") hides it.
      // Ask it again about the text with the label cut and the name as "~".
      const multi = c.multiTrigger || (reads.length > 1 && segment(withoutAbilityWord(selfAsTilde(c.text, card.name)), [], "Creature")[0]?.multiTrigger === true);
      if (multi) for (const r of reads.slice(1)) if (r.event !== first.event) overflow.push({ id: nextId++, abilityType: type, trigger: { event: r.event, subject: second ? triggerSubjectText(`Whenever ${second}`) : record.trigger.subject, control: r.control ?? record.trigger.control ?? "any" }, actions: [] });
    }
    let effect = labelled ? effectText(labelled.effect, card.name) : effectText(c.text, card.name);
    // "AFTER YOU ROLL A DIE, you may ...": no when/whenever/at, so no triggered ability -- it modifies
    // the roll (CR 706.2, a modifier to the natural result), a static clause. The roll it waits on is the
    // clause's trigger all the same, the whole-clause way a delayed "whenever ... this turn" is, so
    // derive links die-rollers to it.
    const afterRoll = type !== "triggered" ? /^after (you roll a die), /i.exec(effect) : null;
    if (afterRoll) {
      const read = [parseTrigger(`Whenever ${afterRoll[1]}`, null) ?? []].flat()[0];
      if (read) record.trigger = { event: read.event, subject: triggerSubjectText(`Whenever ${afterRoll[1]}`), control: read.control ?? "any" };
      effect = effect.slice(afterRoll[0].length);
    }
    // A DELAYED TRIGGER that is the whole clause ("{1}{W}{B}: Whenever you gain life this turn, each
    // opponent loses that much life"): the store records it as the clause's trigger. Not "at the
    // beginning of the next end step" mid-sentence: that times one action, and a clause trigger would
    // put the whole clause there (Teferi's Time Twist's exile happens now).
    const delayed = type !== "triggered" ? /^(whenever [^,]+? this turn)(?=,)/i.exec(c.text) : null;
    if (delayed) {
      const read = [parseTrigger(delayed[1]!, null) ?? []].flat()[0];
      if (read) record.trigger = { event: read.event, subject: triggerSubjectText(delayed[1]!), control: read.control ?? "any" };
    }
    // The card's own name in its cost ("{2}, Sacrifice Kirk:") is the card: "~", as in the effect.
    const rawCost = labelled ? labelled.cost : c.cost;
    const cost = rawCost ? selfAsTilde(rawCost, card.name) : rawCost;
    // AN ACTIVATED COST BEHIND A LABEL THE SEGMENTER MISSED ("Go for the Goal! — {3}, {T}: ..."): it
    // left the clause cost-less and static, and reading the text past the label would drop the cost and
    // bank a static grant. Refused, as before the label strip existed. A cost of mana alone ("I LOVE
    // Squirrels! — {1}{G}{G}{G}: Create ...") has no tap, sacrifice or other payment to lose, and reads.
    // That clause is recorded activated with its cost (`missedCost`), as `derive-input` carries it.
    const bare = withoutAbilityWord(c.text);
    const colon = bare !== c.text && !cost ? bare.indexOf(": ") : -1;
    if (colon > 0 && !/[."]/.test(bare.slice(0, colon)) && /^(?:\{|(?:Pay|Sacrifice|Discard|Exile|Tap|Remove|Return|Put)\b)/.test(bare)) {
      return { records, complete: false, blocker: { clause: c.id, kind: "action", phrase: bare.slice(0, colon) } };
    }
    const unread = unreadPhrases(effect, type, cost);
    if (unread.length) return { records, complete: false, blocker: { clause: c.id, kind: "action", phrase: unread[0]! } };
    const readingsHere = parseActions(effect, type, cost);
    // CEILING: one counter amount that swallowed a second counter clause ("a +1/+1 counter on it for each other red
    // creature you control AND a +1/+1 counter on it for each other green creature you control", Ulasht) is two
    // abilities read as one; the card is refused here rather than banked with half of it (the stored answer keeps both).
    const swallowed = readingsHere.find((r) => r.verb === "add-counter" && / and (?:an?|one|two|three|x) [^,]*?counters? on (?:it|them|him|her|~)(?!\w)/.test(r.amount ?? ""));
    if (swallowed) return { records, complete: false, blocker: { clause: c.id, kind: "action", phrase: effect } };
    // A MODE'S "IF <condition>" GATES ITS EFFECT (#1349 review): "Draw a card if you control a permanent with a counter on it"
    // (Federation Field Medic) is no unconditional draw, and the store has no slot for the condition, so the action would
    // be recorded as a plain draw. The mode is recorded as one `other` action instead, which derive leaves unclaimed and visible.
    // CEILING: only a mode (a non-modal conditional effect keeps its plain reading, as the stored answer has it: Roadside Reliquary), and the WHOLE
    // mode becomes the one `other`, its unconditional parts included (What Must Be Done's return is lost): a card with no model answer derives nothing for that mode.
    const gated = c.kind === "mode" ? readingsHere.find((r) => r.condition !== undefined && /^if /i.test(r.condition) && !/^if (?:you|they) (?:do|don't|did|didn't)\s*(?:[,.]|$)|^if able\b|\bwould\b|\binstead\b/i.test(r.condition)) : undefined;
    if (gated) {
      readings[c.id] = { ...readings[c.id], actions: [] };
      record.actions = [{ verb: "other", object: effect, fromZone: null, toZone: null, optional: false } as Action];
      records.push(record);
      for (const o of overflow) if (o.actions!.length === 0 && o.trigger) o.actions = record.actions;
      continue;
    }
    readings[c.id] = { ...readings[c.id], actions: readingsHere };
    // A KEYWORD LINE the segmenter left as an ability ("Suspend 4—{U}", its reminder stripped): the
    // card's own keywords, which the store records as no action, as it does a keyword clause.
    // A STATION ROW'S KEYWORDS ("8+ | Flying") are not the card's own keywords but a grant gated on charge counters (CR 721.2a): a static
    // grant, as the store records it, and derive stamps the row's threshold on it.
    if (type !== "triggered" && !cost && readingsHere.length > 0 && !/\b(?:has|have|gains?|gets?|is|are|becomes?)\b/i.test(effect) && !/^equip\b/i.test(c.text) && !STATION_BAR.test(c.text)
      && readingsHere.every((r) => r.verb === "grant-ability" && r.object?.self === true)) {
      records.push({ id: c.id, abilityType: "none", actions: [{ verb: "none", object: c.text } as Action] });
      continue;
    }
    // The card itself as "it": in a self trigger, and in a replacement about the card ("If this creature
    // would enter and it wasn't cast ..., exile it instead", Primeval Spawn).
    const selfNoun = SELF_SUBJECT.test(record.trigger?.subject ?? "") ? record.trigger!.subject!
      : /^if (~|this [a-z]+) would\b/i.exec(effect)?.[1];
    // The card's own name ("~") is written "this", the store's self spelling; a self subject action
    // with no trigger noun takes the clause's own "this creature".
    const selfWord = selfNoun && selfNoun !== "~" ? selfNoun : /\bthis (?:creature|artifact|enchantment|land|planeswalker|permanent|vehicle|card|spell|aura|equipment|battle)\b/i.exec(c.text)?.[0] ?? "this";
    record.actions = actionsOf(readingsHere, selfNoun === "~" ? "this" : selfNoun, type, selfWord, record.trigger?.subject, record.trigger?.event);
    if (STATION_BAR.test(c.text)) record.actions = mergeKeywordGrants(record.actions);
    if (record.actions.length === 0 && type !== "static") record.actions = [{ verb: "none", object: "" } as Action];
    records.push(record);
    for (const o of overflow) if (o.actions!.length === 0 && o.trigger) o.actions = record.actions;
  }
  return { records: [...records, ...overflow], complete: true, readings };
}
