/** A CARD'S CLAUSE RECORDS FROM ITS PRINTED TEXT ALONE (#896 task 7): the `ClauseRecord`s derive reads,
 *  built from the segmenter, the trigger grammar and the action grammar with no model answer.
 *
 *  A card is COMPLETE when every clause's trigger opening and every action phrase (its cost included)
 *  reads. Owner ruling 2026-10-02: a complete card derives from these records corpus-wide, the bought
 *  model answer kept only as the fallback for the rest. Until that switch this module is measured
 *  against the stored answers by `instruments/src/grammar-only.ts`. Pure and synchronous. */
import type { Action, ClauseRecord } from "../canonicalize.js";
import { interveningIfOf } from "../derive/intervening-if.js";
import { segment } from "../segment.js";
import { amountOf, parseActions, unreadPhrases, type ActionReading } from "./action.js";
import { effectText, printedPreamble } from "./preamble.js";
import { selfAsTilde } from "./self-as-tilde.js";
import { parseTrigger } from "./trigger.js";

export interface CardText { name: string; oracleText?: string; keywords?: string[]; typeLine?: string }
export interface GrammarRecords {
  records: ClauseRecord[];
  complete: boolean;
  /** Why not complete: the first clause that did not read, and how. */
  blocker?: { clause: number; kind: "trigger" | "action"; phrase?: string };
}

/** The verbs a trigger opening's event is printed with, to cut its subject off the front. */
const EVENT_VERB = /\s(?:dies|die|enters|enter|attacks|attack|blocks|block|becomes|become|is|are|deals|deal|casts|cast|gains|gain|loses|lose|draws|draw|discards|discard|sacrifices|sacrifice|leaves|leave|gets|get|puts|put|plays|play|activates|activate|creates|create|mills|mill|explores|explore|taps|tap|untaps|untap|searches|search|cycles|cycle|scries|scry|surveils|surveil|exiles|exile|returns|return|fights|fight|transforms|transform|copies|copy|counters|was|were|has|have|would|can't|connives|proliferates?|expends|commits?|ventures?|completes?|crews?|saddles?|chooses?|reveals?|wins?|pays?|spends?|finishes?|unlocks?|opens?|rolls?|flips?|shuffles?|investigates?|forages?|descends?)\b/;
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
export function triggerSubjectText(preamble: string): string {
  // A PHASE TRIGGER names whose phase: "your upkeep" is yours, "each upkeep" / "the end step" anyone's.
  const phase = /^at the beginning of (your|each|the|each player's|each opponent's|that player's)\b/i.exec(preamble);
  if (phase) return /^your$/i.test(phase[1]!) ? "you" : /opponent/i.test(phase[1]!) ? "each opponent" : "each player";
  const rest = preamble.replace(/^(?:when|whenever|at)\s+/i, "");
  const v = EVENT_VERB.exec(rest);
  const head = (v ? rest.slice(0, v.index) : rest).trim();
  if (v && PLAYER.test(head)) {
    // "you cast or cycle ~": the second verb is the event's, not the object's.
    const obj = rest.slice(v.index + v[0].length).trim().replace(/^or \w+ /i, "");
    // "you put one or more counters on a creature you don't control": the store names the creature.
    const on = /\bcounters? on (.+)$/i.exec(obj);
    if (on) return on[1]!;
    if (obj) return obj;
  }
  return head;
}

const SELF_SUBJECT = /^(?:~|this [a-z]+)$/i;
/** Verbs the player does with nothing after them, whose stored object is "you". */
const NO_OBJECT_YOU = new Set(["monarch", "initiative", "ring-tempts", "learn", "venture-into-the-dungeon", "manifest-dread", "investigate", "populate", "win-game", "lose-game"]);
/** Verbs whose stored object can be the PLAYER it happens to ("target player mills two cards" ->
 *  "target player"), the convention derive's `PLAYER_OBJECT_VERBS` reads. */
const PLAYER_VERBS = new Set(["draw", "mill", "discard", "scry", "surveil", "gain-life", "lose-life"]);
const ZONE_VERBS = new Set(["destroy", "exile", "sacrifice", "return", "put", "shuffle"]);
// "put that card ON TOP" (Cruel Tutor): where it goes is no part of which card it is.
const BACK_REFERENCE = /^(?:it|them|him|her|that card|those cards|that creature|that permanent|the card|the cards|one|the other|the rest|one of them|those)(?: on (?:top|the bottom)(?: of (?:your|their|its owner's) library)?)?$/i;

/** A reading's object as the store writes it: the printed object words, without a zone move's
 *  destination ("that card into your graveyard" -> "that card"). */
function objectWords(r: ActionReading): string {
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
  const at = p.search(/ (?:onto|into|on top of|on the bottom of) |(?<!\bup) to /);
  return (at > 0 ? p.slice(0, at) : p).replace(/ (?:tapped|face down)$/, "");
}

/** "unless that player pays {X}", "unless you pay {W}": the store's `unless` (CR 118.12a), its payer
 *  "you" or the other player ("controller"). */
function unlessOf(condition: string | undefined): Action["unless"] | undefined {
  const m = condition ? /(?:^|, )unless (.+?) (?:pays?) (.+)$/i.exec(condition) : null;
  // "unless that player pays {1}" (Rhystic Study): the opponent the trigger named.
  return m ? { cost: m[2]!.trim(), payer: /^you$/i.test(m[1]!) ? "you" : /^(?:that player|that opponent|they)$/i.test(m[1]!) ? "opponent" : "controller" } : undefined;
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
  for (const r of readings) {
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
    const object = PLAYER_VERBS.has(r.verb) ? (r.actor?.text !== undefined && (r.actor.scope !== "that" || /'s (?:controller|owner)$/i.test(r.actor.text)) ? r.actor.text : words || "you")
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
    // "Until end of turn, you may cast THAT CARD" after an exile: from exile, as the store writes it.
    const castRef = (r.verb === "cast" || r.verb === "play") && ref && before?.verb === "exile" ? "exile"
      // "reveal the top card of your library ... cast that card" (Powerbalance); "cast the exiled card",
      // "cast any number of cards exiled with this creature" (Izzet Chemister, Smuggler's Buggy).
      : (r.verb === "cast" || r.verb === "play") && ref && before === undefined && revealedFrom ? revealedFrom
      : (r.verb === "cast" || r.verb === "play") && /\bexiled\b/i.test(object) && !/\bthis way\b/i.test(object) ? "exile" : null;
    // "return this enchantment to its owner's hand": the card itself leaves the battlefield.
    const selfBounce = ((r.verb === "return" || r.verb === "put") && (r.object?.self === true || selfIt) && (r.toZone === "hand" || r.toZone === "library") ? "battlefield"
      // "Exile any number of target spells" (Mindbreak Trap): spells are on the stack.
      : r.verb === "exile" && /\btarget (?:[\w ]+ )?spells?\b/i.test(object) ? "stack"
      // "Exile this enchantment" (Sapling Nursery, Lantern of the Lost): a permanent exiling itself.
      : r.verb === "exile" && r.object?.self === true && type !== "spell" && !/\bcard\b/i.test(object) ? "battlefield"
      // "return that creature to its owner's hand" with nothing searched or exiled before: a permanent.
      : r.verb === "return" && r.toZone === "hand" && /^that (?:creature|permanent)$/i.test(object) && before === undefined ? "battlefield"
      // "Shuffle Beacon of Immortality into its owner's library": a spell shuffles itself from the stack.
      : r.verb === "shuffle" && r.object?.self === true && type === "spell" ? "stack" : null);
    const from = r.fromZone ?? castRef ?? selfBounce ?? (!ZONE_VERBS.has(r.verb) || r.verb === "shuffle" ? null
      : ref ? (before?.verb === "search" ? "library" : before?.verb === "exile" ? "exile" : before !== undefined ? null
        // "When enchanted creature dies, return that card": the card the trigger put in the graveyard.
        // "Counter target spell. If that spell is countered this way, exile it instead": still on the stack.
        : r.verb === "exile" && out.some((a) => a.verb === "counter-spell") ? "stack"
        : revealedFrom ?? (/^(?:dies|sacrificed|put-into-graveyard|discarded|milled)$/.test(triggerEvent ?? "") && out.length === 0 ? "graveyard" : null))
      // "that many cards from the bottom of your library": the library the words name.
      : /\b(?:top|bottom) of (?:your|their|its owner's|that player's|target player's) library\b/i.test(r.phrase ?? r.text ?? "") ? "library"
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
    const target = pronoun && out.length > 0 ? [...out].reverse().map((a) => /^((?:up to (?:one|two|three) )?(?:another )?targets? [^,]+)/i.exec(a.object ?? "")?.[1])
      .find((t) => t && (!noun || new RegExp(`\\b${noun}`, "i").test(t))) : undefined;
    const named = target ?? (!pronoun ? undefined : out.length > 0 && selfTrigger ? selfTrigger
      : /^(?:enchanted|equipped) [a-z]+$/i.test(triggerSubject ?? "") ? triggerSubject : undefined);
    const itsAntecedent = named ?? "";
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
      verb: r.verb, object: itsAntecedent || object || tapped || (NO_OBJECT_YOU.has(r.verb) ? r.actor?.text ?? "you" : r.verb === "proliferate" ? "any" : object),
      fromZone: from, toZone: r.toZone ?? null,
      ...(r.amount !== undefined ? { amount: r.amount } : wordsAmount(r.verb, object) !== undefined ? { amount: wordsAmount(r.verb, object) } : {}),
      optional: r.optional === true,
      ...(unlessOf(r.condition) ? { unless: unlessOf(r.condition) } : {}),
    } as Action);
    if (transformed) out.push({ verb: "transform", object, fromZone: null, toZone: null, optional: false } as Action);
  }
  return out;
}

export function grammarClauseRecords(card: CardText): GrammarRecords {
  const records: ClauseRecord[] = [];
  const clauses = segment(card.oracleText ?? "", card.keywords ?? [], card.typeLine ?? "");
  // A TWO-EVENT TRIGGER ("enters or leaves the battlefield", "attacks or blocks") is two records, the
  // second numbered after the card's last clause -- the store's convention (`validate-clauses.ts`),
  // which derive reads back to the parent's text.
  const overflow: ClauseRecord[] = [];
  let nextId = Math.max(0, ...clauses.map((c) => c.id)) + 1;
  for (const c of clauses) {
    if (c.kind === "reminder") continue;
    if (c.kind === "keyword") { records.push({ id: c.id, abilityType: "none", actions: [{ verb: "none", object: c.text } as Action] }); continue; }
    const type = c.abilityType ?? "static";
    const record: ClauseRecord = { id: c.id, abilityType: type, actions: [] };
    if (type === "triggered") {
      const preamble = printedPreamble(c.text, card.name);
      const read = preamble ? parseTrigger(preamble, interveningIfOf(selfAsTilde(c.text, card.name))) : null;
      if (!read) return { records, complete: false, blocker: { clause: c.id, kind: "trigger", ...(preamble ? { phrase: preamble } : {}) } };
      const reads = [read].flat();
      const first = reads[0]!;
      const phaseTrigger = /^at the beginning of\b/i.test(preamble!);
      record.trigger = { event: first.event, subject: triggerSubjectText(preamble!), control: phaseTrigger ? phaseControl(preamble!) : first.control ?? "any" };
      // "When Brinelin enters AND WHENEVER you cast a spell with mana value 6 or greater": the second
      // event has its own subject; "enters or attacks" shares the first's.
      const second = /\b(?:and|or) whenever (.+)$/i.exec(preamble!)?.[1];
      if (c.multiTrigger) for (const r of reads.slice(1)) if (r.event !== first.event) overflow.push({ id: nextId++, abilityType: type, trigger: { event: r.event, subject: second ? triggerSubjectText(`Whenever ${second}`) : record.trigger.subject, control: r.control ?? record.trigger.control ?? "any" }, actions: [] });
    }
    const effect = effectText(c.text, card.name);
    // A DELAYED TRIGGER that is the whole clause ("{1}{W}{B}: Whenever you gain life this turn, each
    // opponent loses that much life"): the store records it as the clause's trigger. Not "at the
    // beginning of the next end step" mid-sentence: that times one action, and a clause trigger would
    // put the whole clause there (Teferi's Time Twist's exile happens now).
    const delayed = type !== "triggered" ? /^(whenever [^,]+? this turn)(?=,)/i.exec(c.text) : null;
    if (delayed) {
      const read = [parseTrigger(delayed[1]!, null) ?? []].flat()[0];
      if (read) record.trigger = { event: read.event, subject: triggerSubjectText(delayed[1]!), control: read.control ?? "any" };
    }
    const cost = c.cost;
    const unread = unreadPhrases(effect, type, cost);
    if (unread.length) return { records, complete: false, blocker: { clause: c.id, kind: "action", phrase: unread[0]! } };
    const readings = parseActions(effect, type, cost);
    // A KEYWORD LINE the segmenter left as an ability ("Suspend 4—{U}", its reminder stripped): the
    // card's own keywords, which the store records as no action, as it does a keyword clause.
    if (type !== "triggered" && !cost && readings.length > 0 && !/\b(?:has|have|gains?|gets?|is|are|becomes?)\b|^equip\b/i.test(effect)
      && readings.every((r) => r.verb === "grant-ability" && r.object?.self === true)) {
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
    record.actions = actionsOf(readings, selfNoun === "~" ? "this" : selfNoun, type, selfWord, record.trigger?.subject, record.trigger?.event);
    if (record.actions.length === 0 && type !== "static") record.actions = [{ verb: "none", object: "" } as Action];
    records.push(record);
    for (const o of overflow) if (o.actions!.length === 0 && o.trigger) o.actions = record.actions;
  }
  return { records: [...records, ...overflow], complete: true };
}
