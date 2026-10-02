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
  const rest = preamble.replace(/^(?:when|whenever|at)\s+/i, "");
  const v = EVENT_VERB.exec(rest);
  const head = (v ? rest.slice(0, v.index) : rest).trim();
  if (v && PLAYER.test(head)) {
    const obj = rest.slice(v.index + v[0].length).trim();
    if (obj) return obj;
  }
  return head;
}

const ZONE_VERBS = new Set(["destroy", "exile", "sacrifice", "return", "put", "shuffle"]);
const BACK_REFERENCE = /^(?:it|them|that card|those cards|that creature|that permanent|the card|the cards)$/i;

/** A reading's object as the store writes it: the printed object words, without a zone move's
 *  destination ("that card into your graveyard" -> "that card"). */
function objectWords(r: ActionReading): string {
  if (r.text !== undefined) return r.text;
  if (r.counter !== undefined && r.phrase === undefined) return r.counter;
  const p = r.phrase ?? "";
  if (!ZONE_VERBS.has(r.verb)) return p;
  const at = p.search(/ (?:onto|into|to|on top of|on the bottom of|from) /);
  return (at > 0 ? p.slice(0, at) : p).replace(/ (?:tapped|face down)$/, "");
}

/** One clause's readings as `Action`s. A back-referenced object moved after a search comes from the
 *  library, the zone the store writes for it (Farseek, Entomb, every fetchland). */
function actionsOf(readings: ActionReading[]): Action[] {
  const out: Action[] = [];
  for (const r of readings) {
    const object = objectWords(r);
    const searched = !r.fromZone && (r.verb === "put" || r.verb === "return") && BACK_REFERENCE.test(object) && out.some((a) => a.verb === "search");
    out.push({
      verb: r.verb, object,
      fromZone: r.fromZone ?? (searched ? "library" : null), toZone: r.toZone ?? null,
      ...(r.amount !== undefined ? { amount: r.amount } : {}),
      optional: r.optional === true,
    } as Action);
  }
  return out;
}

export function grammarClauseRecords(card: CardText): GrammarRecords {
  const records: ClauseRecord[] = [];
  const clauses = segment(card.oracleText ?? "", card.keywords ?? [], card.typeLine ?? "");
  for (const c of clauses) {
    if (c.kind === "reminder") continue;
    if (c.kind === "keyword") { records.push({ id: c.id, abilityType: "none", actions: [{ verb: "none", object: c.text } as Action] }); continue; }
    const type = c.abilityType ?? "static";
    const record: ClauseRecord = { id: c.id, abilityType: type, actions: [] };
    if (type === "triggered") {
      const preamble = printedPreamble(c.text, card.name);
      const read = preamble ? parseTrigger(preamble, interveningIfOf(selfAsTilde(c.text, card.name))) : null;
      if (!read) return { records, complete: false, blocker: { clause: c.id, kind: "trigger", ...(preamble ? { phrase: preamble } : {}) } };
      const first = [read].flat()[0]!;
      record.trigger = { event: first.event, subject: triggerSubjectText(preamble!), control: first.control ?? "any" };
    }
    const effect = effectText(c.text, card.name);
    const cost = c.cost;
    const unread = unreadPhrases(effect, type, cost);
    if (unread.length) return { records, complete: false, blocker: { clause: c.id, kind: "action", phrase: unread[0]! } };
    record.actions = actionsOf(parseActions(effect, type, cost));
    if (record.actions.length === 0 && type !== "static") record.actions = [{ verb: "none", object: "" } as Action];
    records.push(record);
  }
  return { records, complete: true };
}
