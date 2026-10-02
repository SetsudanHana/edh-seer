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
import { parseActions, unreadPhrases, type ActionReading } from "./action.js";
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
    const obj = rest.slice(v.index + v[0].length).trim();
    if (obj) return obj;
  }
  return head;
}

const SELF_SUBJECT = /^(?:~|this [a-z]+)$/i;
/** Verbs the player does with nothing after them, whose stored object is "you". */
const NO_OBJECT_YOU = new Set(["monarch", "initiative", "ring-tempts", "learn", "venture-into-the-dungeon", "manifest-dread", "proliferate", "investigate", "populate", "win-game", "lose-game"]);
/** Verbs whose stored object can be the PLAYER it happens to ("target player mills two cards" ->
 *  "target player"), the convention derive's `PLAYER_OBJECT_VERBS` reads. */
const PLAYER_VERBS = new Set(["draw", "mill", "discard", "scry", "surveil", "gain-life", "lose-life"]);
const ZONE_VERBS = new Set(["destroy", "exile", "sacrifice", "return", "put", "shuffle"]);
const BACK_REFERENCE = /^(?:it|them|that card|those cards|that creature|that permanent|the card|the cards|one|the other|the rest|one of them|those)$/i;

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
  if (r.text !== undefined) return r.text === "~" ? "this" : r.text;
  const p = (r.phrase ?? "").replace(/ until end of turn$/i, "");
  if (!ZONE_VERBS.has(r.verb)) return p;
  const at = p.search(/ (?:onto|into|to|on top of|on the bottom of|from) /);
  return (at > 0 ? p.slice(0, at) : p).replace(/ (?:tapped|face down)$/, "");
}

/** "unless that player pays {X}", "unless you pay {W}": the store's `unless` (CR 118.12a), its payer
 *  "you" or the other player ("controller"). */
function unlessOf(condition: string | undefined): Action["unless"] | undefined {
  const m = condition ? /(?:^|, )unless (.+?) (?:pays?) (.+)$/i.exec(condition) : null;
  return m ? { cost: m[2]!, payer: /^you$/i.test(m[1]!) ? "you" : "controller" } : undefined;
}

/** One clause's readings as `Action`s. A back-referenced object moved after a search comes from the
 *  library, the zone the store writes for it (Farseek, Entomb, every fetchland). */
function actionsOf(readings: ActionReading[], selfTrigger: string | undefined): Action[] {
  const out: Action[] = [];
  for (const r of readings) {
    // "Reveal it" is bookkeeping the store drops (canonicalize's DROPPED_VERBS).
    if (r.verb === "reveal") continue;
    // "When this creature blocks, return IT": with nothing before it, "it" is the card itself, written
    // as the trigger names it ("this creature"), which derive's self and type readings key on.
    // As derive's grammar switch writes a player verb's object: a named actor ("target player mills")
    // is the object, a back-referenced one ("that player") or none leaves the printed words.
    const object = PLAYER_VERBS.has(r.verb) ? (r.actor?.text !== undefined && r.actor.scope !== "that" ? r.actor.text : objectWords(r) || "you")
      : selfTrigger && out.length === 0 && /^(?:it|itself)$/i.test(objectWords(r)) ? selfTrigger : objectWords(r);
    // WHERE A MOVED THING COMES FROM, when the phrase does not say, as the store writes it: a
    // back-reference after a search comes from the library, after an exile from exile ("exile ...,
    // then return that card", Thassa). A permanent named outright is left unstated, as the store
    // mostly leaves it (Beast Within; defaulting it to the battlefield moved 2,348 cards).
    const ref = BACK_REFERENCE.test(object);
    const before = [...out].reverse().find((a) => a.verb === "search" || a.verb === "exile");
    // "Until end of turn, you may cast THAT CARD" after an exile: from exile, as the store writes it.
    const castRef = (r.verb === "cast" || r.verb === "play") && ref && before?.verb === "exile" ? "exile" : null;
    // "return this enchantment to its owner's hand": the card itself leaves the battlefield.
    const selfBounce = (r.verb === "return" || r.verb === "put") && r.object?.self === true && (r.toZone === "hand" || r.toZone === "library") ? "battlefield" : null;
    const from = r.fromZone ?? castRef ?? selfBounce ?? (!ZONE_VERBS.has(r.verb) || r.verb === "shuffle" ? null
      : ref ? (before?.verb === "search" ? "library" : before?.verb === "exile" ? "exile" : null)
      // "that many cards from the bottom of your library": the library the words name.
      : /\b(?:top|bottom) of (?:your|their|its owner's|that player's|target player's) library\b/i.test(r.phrase ?? r.text ?? "") ? "library"
      // An EXILE of a permanent named outright leaves the battlefield, the zone the store writes for an
      // exile (Baleful Mastery, Thassa); a destroy or sacrifice it leaves unstated, so they are not.
      : r.verb === "exile" && r.object && !r.object.ref && !r.object.self && !/\bcards?\b|\bspells?\b/i.test(object) && r.object.zone === undefined ? "battlefield" : null);
    // "put one onto the battlefield TAPPED": the tap is on what just moved, written as the store does.
    const tapped = r.verb === "tap" && !object && out.length > 0 ? out[out.length - 1]!.object ?? "" : "";
    out.push({
      verb: r.verb, object: object || tapped || (NO_OBJECT_YOU.has(r.verb) ? "you" : object),
      fromZone: from, toZone: r.toZone ?? null,
      ...(r.amount !== undefined ? { amount: r.amount } : {}),
      optional: r.optional === true,
      ...(unlessOf(r.condition) ? { unless: unlessOf(r.condition) } : {}),
    } as Action);
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
      record.trigger = { event: first.event, subject: triggerSubjectText(preamble!), control: first.control ?? "any" };
      if (c.multiTrigger) for (const r of reads.slice(1)) if (r.event !== first.event) overflow.push({ id: nextId++, abilityType: type, trigger: { event: r.event, subject: record.trigger.subject, control: r.control ?? "any" }, actions: [] });
    }
    const effect = effectText(c.text, card.name);
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
    record.actions = actionsOf(readings, selfNoun);
    if (record.actions.length === 0 && type !== "static") record.actions = [{ verb: "none", object: "" } as Action];
    records.push(record);
    for (const o of overflow) if (o.actions!.length === 0 && o.trigger) o.actions = record.actions;
  }
  return { records: [...records, ...overflow], complete: true };
}
