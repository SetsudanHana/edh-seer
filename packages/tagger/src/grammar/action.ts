/** THE ACTION GRAMMAR (#896, task 6): a clause's PRINTED effect text (and an activated ability's
 *  cost) read into the actions it performs. Same contract as `filter.ts` and `trigger.ts`: pure, and
 *  a phrase is answered only when every word of it is read -- an unread phrase is simply absent and
 *  that action keeps the stored path. Measured by `instruments/src/action-diff.ts`.
 *
 *  - SENTENCES split on ". ", PHRASES on the printed joints (", then", " and ", ", ") where a verb
 *    follows. Quoted ability text (a grant's quoted ability) is never split or read.
 *  - A sentence opener is peeled: "If you do," / "If ...," is the action's `condition` (KEPT, the
 *    action still claims -- owner, 2026-10-01), "you may" is `optional`, "Then" is a joint.
 *  - The ACTOR ("each opponent discards", "target player mills") is who does it; the store has no
 *    field for it.
 *  - VERB FAMILIES are added one per PR, in the owner's order (2026-10-01): draw/search first. */
import type { Control, SubjectFilter } from "../schema.js";
import { counterKindOf } from "../derive/subject.js";
import { KEYWORD_ABILITIES } from "../derive/subtypes.js";
import { parse } from "./filter.js";

export interface ActionReading {
  verb: string;
  object?: SubjectFilter;
  amount?: string;
  fromZone?: string;
  toZone?: string;
  optional?: true;
  actor?: { control: Control; scope?: "each" | "target" | "that"; text?: string };
  condition?: string;
  /** The printed object phrase, as derive's string-reading path takes it ("two cards", "a basic land
   *  card"). Absent where the phrase has no object words of its own (scry 2). */
  text?: string;
  /** A counter action's KIND ("+1/+1", "stun"); its `object` is the permanent or player it goes on. */
  counter?: string;
}

const NUMBER: Record<string, string> = {
  a: "1", an: "1", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7",
  eight: "8", nine: "9", ten: "10", eleven: "11", twelve: "12", thirteen: "13", fourteen: "14",
  fifteen: "15", twenty: "20", x: "X",
};
const BACKREF_TAIL = / (?:exiled with (?:~|this [a-z]+|it|him|her)|(?:that player|that opponent|they|he or she|its controller|that creature's controller|that permanent's controller|the chosen player|those players|that player or that planeswalker's controller) (?:controls?|owns?)|(?:\w+ed|dealt damage|put into (?:a|your|their) graveyards?|exiled with [\w~ ]+|returned to [\w ]+|chosen|revealed|discarded|milled|drawn|sacrificed|destroyed|tapped|untapped|blocking|attacking) this way)$/i;

/** "two", "X", "3", "that many": the amount as the store spells it. */
function amountOf(word: string): string | undefined {
  const w = word.toLowerCase();
  if (NUMBER[w]) return NUMBER[w];
  if (/^\d+$/.test(w)) return w;
  return undefined;
}

/** Who does it. Longest first, so "each opponent" is not read as "each". */
const ACTORS: [string, ActionReading["actor"]][] = ([
  ["each player", { control: "any", scope: "each" }], ["each opponent", { control: "opp", scope: "each" }],
  ["target opponent", { control: "opp", scope: "target" }], ["target player", { control: "any", scope: "target" }],
  ["that player", { control: "any", scope: "that" }], ["an opponent", { control: "opp" }], ["you", { control: "you" }],
  ["its controller", { control: "any", scope: "that" }], ["its owner", { control: "any", scope: "that" }],
  ["defending player", { control: "opp", scope: "that" }],
  ["that spell's controller", { control: "any", scope: "that" }], ["that creature's controller", { control: "any", scope: "that" }],
  ["each of them", { control: "any", scope: "that" }], ["each other player", { control: "opp", scope: "each" }],
  ["the attacking player", { control: "opp", scope: "that" }],
  ["two target players", { control: "any", scope: "target" }], ["any number of target players", { control: "any", scope: "target" }],
  ["any number of target opponents", { control: "opp", scope: "target" }], ["players", { control: "any", scope: "each" }],
  ["those players", { control: "any", scope: "that" }],
  ["they", { control: "any", scope: "that" }],
  ["any player", { control: "any" }], ["any opponent", { control: "opp" }], ["the player", { control: "any", scope: "that" }],
  ["this creature's owner", { control: "any", scope: "that" }], ["~'s owner", { control: "any", scope: "that" }],
  ["the controller of the permanent it becomes", { control: "any", scope: "that" }],
  ["enchanted creature's controller", { control: "any", scope: "that" }], ["equipped creature's controller", { control: "any", scope: "that" }],
] as [string, ActionReading["actor"]][]).sort((a, b) => b[0].length - a[0].length);

/** A verb phrase's handler: its arguments read into a reading, or null. Keyed by the verb's base
 *  word; a third-person form ("draws", "searches") reads the same. */
type Args = Omit<ActionReading, "verb" | "optional" | "actor" | "condition"> & { verb?: string };
type Handler = (rest: string) => Args | Args[] | null;

const CARD = parse("a card")!;
const SELF: SubjectFilter = { control: "you", token: null, self: true };

/** A COUNT before a noun phrase, as the store spells the amount: "two cards" 2, "up to two cards" 2, "any number of cards", "X cards", "that many cards", "an additional card" 1. */
const COUNT = /^(?:(up to )?(a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|twenty|x|\d+)|(any number of|(?:up to )?that many|all the|all|half)) (?:additional )?/i;

/** The object of an action: a counted class ("two basic land cards"), the card itself ("this card"),
 *  or a back-reference ("it", "that card", "those cards"), which task 4's resolver owns. */
function objectOf(phrase: string): { amount?: string; object: SubjectFilter } | null {
  const t = phrase.trim();
  // A BACK-REFERENCED CONTROLLER ("target artifact that player controls", "each creature they
  // control") or a set the sentence made ("all creatures tapped this way", "each card revealed this
  // way"): the class is read, and the object is marked a back-reference, so derive keeps the stored
  // object, whose antecedent reading names the player or the set.
  // ...also mid-phrase ("a creature they control with the greatest mana value"): read with "a player
  // controls" in its place, the controller the filter grammar holds as "any".
  const mid = / (?:that player|that opponent|they|he or she|its controller|those players) (?:controls?)\b(?=.)/i.exec(t);
  if (mid) {
    const r = objectOf(`${t.slice(0, mid.index)} a player controls${t.slice(mid.index + mid[0].length)}`);
    return r && { ...r, object: { ...r.object, ref: "sentence" } };
  }
  const back = BACKREF_TAIL.exec(t);
  if (back && back.index > 0) {
    const head = t.slice(0, back.index);
    const r = objectOf(head) ?? (/^(?:all|each) /i.test(head) ? objectOf(head.replace(/^(?:all|each) /i, "a ")) : null);
    return r && { ...r, object: { ...r.object, ref: "sentence" } };
  }
  if (/^(?:this [a-z]+|~|this|him|her)$/i.test(t)) return { object: SELF };
  // An Aura's or Equipment's host: its class, as the trigger grammar reads it (the text keeps the rest).
  const host = /^(?:enchanted|equipped) (creature|permanent|land|artifact|planeswalker)$/i.exec(t);
  if (host) return { object: parse(`a ${host[1]!.toLowerCase()}`)! };
  // "enchanted Forest", "enchanted Plains": a host of a land type, its class as the filter reads it.
  const typed = /^enchanted ([A-Z][a-z]+)$/.exec(t);
  if (typed && parse(`a ${typed[1]}`)) return { object: parse(`a ${typed[1]}`)! };
  // "that land", "that artifact": a back-reference to an object the sentence named.
  if (/^that (?:land|artifact|enchantment|planeswalker|aura|equipment|vehicle|dragon)$/i.test(t) || /^that [A-Z][a-z]+$/.test(t)) return { object: { control: "any", token: null, ref: "sentence" } };
  if (/^(?:it|them|that card|those cards|the revealed card|that spell|that player|that creature|that permanent|itself|that source|those creatures|those players|its controller|its owner|each of them|the chosen player|the player or planeswalker (?:it's|that creature is) attacking|(?:that|the) [a-z]+'s controller|that player or planeswalker|that permanent or player|that creature and that player|that ability|that spell or ability|that triggered ability|the copy|that token|the (?:spell|ability|creature|permanent|card|token)|the chosen [a-z]+|(?:one|two|either) of them|the (?:exiled|revealed|chosen|milled|discarded) cards?|(?:any number of )?the copies)$/i.test(t)) return { object: { control: "any", token: null, ref: "sentence" } };
  // "one or two target creatures": at most two, the store's "up to two".
  if (/^one or two /i.test(t)) return objectOf(t.replace(/^one or two /i, "up to two "));
  const m = COUNT.exec(t);
  // "up to two" is the store's "2", the convention derive's scaling reads ("up to X ... where X is").
  const amount = m ? (m[2] ? amountOf(m[2]) : m[3]!.toLowerCase().replace(/^all the$/, "all").replace(/^up to /, "")) : undefined;
  const rest = m ? t.slice(m[0].length) : t;
  const object = parse(m && !/^(?:a|an)$/i.test(m[2] ?? "") ? `a ${rest.replace(/cards\b/, "card")}` : rest) ?? parse(rest);
  return object ? { ...(amount ? { amount } : {}), object } : null;
}

/** "a card", "two cards", "cards equal to its power", "a card for each Shrine you control". */
function cardsOf(rest: string): { amount?: string; object: SubjectFilter } | null {
  const eq = /^cards equal to (.+)$/.exec(rest);
  if (eq) return { amount: `equal to ${eq[1]}`, object: CARD };
  const each = /^(a card|two cards|cards) for each (.+)$/.exec(rest);
  if (each) return { amount: `for each ${each[2]}`, object: CARD };
  const plus = /^that many cards (plus|minus) (one|two|\d+)$/.exec(rest);
  if (plus) return { amount: `that many ${plus[1]} ${amountOf(plus[2]!)}`, object: CARD };
  const r = objectOf(rest);
  return r && /\bcards?$/.test(rest) && r.object.type === undefined && r.object.subtype === undefined ? r : null;
}

/** "your hand", "their hand", "all the cards in your hand": a whole hand. */
const WHOLE_HAND = /^(?:your|their|his or her) hand$|^all the cards in (?:your|their) hand$/;

const DRAW_SEARCH: Record<string, [string, Handler]> = {
  draw: ["draw", (rest) => cardsOf(rest)],
  discard: ["discard", (rest) => {
    if (WHOLE_HAND.test(rest)) return { amount: "all", object: CARD };
    if (/^half the cards in (?:their|your) hand(?:, rounded (?:up|down))?$/.test(rest)) return { amount: "half", object: CARD };
    // "at random" is how the card is chosen, not which.
    const r = objectOf(rest.replace(/ at random$/, ""));
    return r ? { ...r, amount: r.amount ?? "1" } : null;
  }],
  mill: ["mill", (rest) => (/^half (?:their|your) library, rounded (?:up|down)$/.test(rest) ? { amount: "half", object: CARD } : cardsOf(rest))],
  scry: ["scry", (rest) => (amountOf(rest) ? { amount: amountOf(rest)!, object: CARD } : null)],
  surveil: ["surveil", (rest) => (amountOf(rest) ? { amount: amountOf(rest)!, object: CARD } : null)],
  search: ["search", (rest) => {
    const m = /^(?:your|their|that player's|target player's|target opponent's|its owner's|its controller's) (library|graveyard, hand, and library|graveyard, hand, and\/or library|library and\/or graveyard|library and graveyard)(?: for (.+))?$/.exec(rest);
    if (!m) return null;
    const r = m[2] ? objectOf(m[2]) : { object: CARD };
    // One search per zone named, as the store writes it ("graveyard, hand, and library": three).
    return r && m[1]!.split(/, (?:and|and\/or) |, | and\/or | and /).map((zone) => ({ ...r, fromZone: zone }));
  }],
  reveal: ["reveal", (rest) => {
    if (WHOLE_HAND.test(rest)) return { object: { ...CARD, zone: "hand" } };
    const top = /^the top (card|two cards|three cards|four cards|five cards|x cards) of (?:your|their) library$/.exec(rest);
    if (top) return { amount: amountOf(top[1]!.split(" ")[0]!.replace(/^card$/, "a")) ?? "1", object: CARD, fromZone: "library" };
    return objectOf(rest);
  }],
};

/** An amount of life or damage: "3", "X", "that much", "twice that much", "equal to its power",
 *  "half their life, rounded up". `null` when the words are none of these. */
function lifeAmount(words: string): string | null {
  const w = words.trim();
  if (amountOf(w)) return amountOf(w)!;
  if (/^(?:that much|twice that much|that many|half that much|half their life|half your life|that much plus (?:one|two|\d+)|twice x)$/i.test(w)) return w.toLowerCase().replace(/\bx$/, "X");
  return null;
}

/** "gain 3 life", "gain life equal to its toughness", "gain 2 life for each creature you control". */
function lifeOf(rest: string): Args | null {
  // The store writes the counted thing alone ("its power", not "equal to its power").
  const eq = /^life equal to (.+)$/.exec(rest);
  if (eq) return { amount: eq[1]! };
  // "that much life plus 1" (a replacement's improved amount).
  const plus = /^that much life (plus|minus) (\d+|one|two)$/.exec(rest);
  if (plus) return { amount: `that much plus ${amountOf(plus[2]!) ?? plus[2]}`.replace("plus", plus[1]!) };
  const each = /^(\w+) life for each (.+)$/.exec(rest);
  if (each && amountOf(each[1]!)) return { amount: `${amountOf(each[1]!)} for each ${each[2]}` };
  const m = /^(.+?) life(?:, rounded (?:up|down))?$/.exec(rest);
  const amount = m ? lifeAmount(m[1]!) : null;
  return amount ? { amount } : null;
}

const DAMAGE_LIFE: Record<string, [string, Handler]> = {
  gain: ["gain-life", lifeOf],
  lose: ["lose-life", (rest) => (/^half (?:their|your) life(?:, rounded (?:up|down))?$/.test(rest) ? { amount: "half" } : lifeOf(rest))],
  // Paying life is losing it (CR 118.3b's reading the store already uses: "pay X life" is lose-life).
  pay: ["lose-life", (rest) => (/^any amount of life$/.test(rest) ? { amount: "any amount" } : /^half your life, rounded (?:up|down)$/.test(rest) ? { amount: "half" } : / life$/.test(rest) ? lifeOf(rest) : null)],
  deal: ["deal-damage", (rest) => {
    // "it deals double that damage [to that permanent or player] instead": a doubler (CR 614), the
    // store's double, its object kept as stored.
    if (/^(?:double|twice) that (?:much )?damage(?: to .+)?$/.test(rest)) return { verb: "double", object: { control: "any", token: null, ref: "sentence" } };
    // "it deals that much damage plus 2 [to that permanent or player] instead": the improved amount.
    const plus = /^that much damage (plus|minus) (\d+|one|two|three)(?: to (?:that permanent or player|that player|that creature|it))?$/.exec(rest);
    if (plus) return { object: { control: "any", token: null, ref: "sentence" }, amount: `that much damage ${plus[1]} ${amountOf(plus[2]!) ?? plus[2]}` };
    // "2 damage to any target and 3 damage to you": one action per recipient, as the store writes it.
    const parts = rest.split(/,? and (?=(?:\w+|half X|that much) damage\b)|, (?=(?:\w+|half X) damage\b)/);
    const out: Args[] = [];
    for (const part of parts) {
      const one = damageOf(part);
      if (!one) return null;
      out.push(...[one].flat());
    }
    return out;
  }],
};

/** "3 damage to any target", "damage equal to its power to target creature", "damage to target
 *  creature equal to the number of lands you control", "2 damage divided as you choose among one or
 *  two targets". The store writes the counted thing alone ("its power"). */
function damageOf(rest: string): Args | Args[] | null {
  let m = /^damage equal to (.+?) to (.+)$/.exec(rest) ?? /^damage equal to (.+?) divided as you choose among (.+)$/.exec(rest);
  if (m) { const r = objectOf(m[2]!); return r && { object: r.object, amount: m[1]!, text: m[2] }; }
  m = /^damage to (.+?) equal to (.+)$/.exec(rest);
  if (m) { const r = objectOf(m[1]!); return r && { object: r.object, amount: m[2]!, text: m[1] }; }
  m = /^(.+?) damage(?:, rounded (?:up|down),)? (?:to|divided as you choose among) (.+)$/.exec(rest);
  const amount = m ? lifeAmount(m[1]!.replace(/ (?:combat|noncombat)$/, "")) ?? (/^half X$/.test(m[1]!) ? "half X" : null) : null;
  // "X damage to each creature and each player": one action per recipient, as the store writes them.
  const many = m && amount && /^to /.test(rest.slice(m[1]!.length + " damage ".length)) ? m[2]!.split(/ and (?=(?:each|target|up to one) )/) : [];
  if (many.length > 1) {
    const each = many.map((p) => objectOf(p));
    if (each.every((e) => e)) return each.map((e, i) => ({ object: e!.object, amount: amount!, text: many[i]! }));
  }
  // "divided as you choose among one, two, or three targets": any targets, however many.
  const r = m && amount ? objectOf(m[2]!) ?? (/^(?:one|one or two|one, two, or three|any number of|up to \w+) (?:other )?targets$/.test(m[2]!) ? { object: ANY_TARGET } : null) : null;
  return r && amount ? { object: r.object, amount, text: m![2] } : null;
}
const ANY_TARGET = parse("any target")!;

/** "two +1/+1 counters", "a stun counter", "X charge counters": the count and the kind. */
function countersOf(phrase: string): { amount?: string; counter: string } | null {
  const m = /^(?:(a|an|one|two|three|four|five|six|seven|eight|nine|ten|x|\d+|that many|twice that many|twice x|an additional|another|any number of|up to (?:one|two|three|x|\d+)) )?(.+? counters?)$/i.exec(phrase.trim());
  const counter = m ? counterKindOf(m[2]!) : undefined;
  if (!counter) return null;
  const word = m![1]?.toLowerCase().replace(/^up to /, "");
  const amount = word ? (word === "an additional" || word === "another" ? "1" : amountOf(word) ?? word) : undefined;
  return { ...(amount ? { amount } : {}), counter };
}

/** "two +1/+1 counters and a trample counter", "a +1/+1 counter, a flying counter, and a shield
 *  counter": each kind its own action, as the store writes them. */
function counterList(phrase: string): { amount?: string; counter: string }[] | null {
  const parts = phrase.split(/,? and (?=(?:a|an|one|two|three|four|\d+) )|, (?=(?:a|an|one|two|three|four|\d+) )/);
  const out = parts.map((p) => countersOf(/counters?$/.test(p) ? p : `${p} counter`));
  return out.every((c) => c !== null) ? out as { amount?: string; counter: string }[] : null;
}

const COUNTERS: Record<string, [string, Handler]> = {
  // "distribute three +1/+1 counters among one, two, or three target creatures you control".
  distribute: ["add-counter", (rest) => {
    const m = /^(.+? counters?) among (?:one|one or two|one, two, or three|any number of) (target .+)$/.exec(rest);
    const c = m ? countersOf(m[1]!) : null;
    const on = m ? objectOf(m[2]!.replace(/^target ([a-z]+)s\b/, "target $1")) : null;
    return c && on ? { object: on.object, counter: c.counter, amount: c.amount ?? "1", text: m![2] } : null;
  }],
  // "put a +1/+1 counter on target creature you control", "put two +1/+1 counters on each creature you
  // control", "put a +1/+1 counter on each of up to two target creatures".
  // "you get an experience counter", "that player gets two poison counters": counters on a player.
  get: ["add-counter", (rest) => {
    const c = countersOf(rest);
    return c ? { object: parse("you")!, counter: c.counter, amount: c.amount ?? "1" } : null;
  }],
  put: ["add-counter", (rest) => {
    // "a +1/+1 counter on target creature, two +1/+1 counters on another target creature, and three
    // +1/+1 counters on a third target creature": one placement per recipient.
    const parts = rest.split(/,? and (?=(?:a|an|one|two|three|four|five|\d+) [^,]*?counters? on )|, (?=(?:a|an|one|two|three|four|five|\d+) [^,]*?counters? on )/);
    if (parts.length > 1 && parts.every((p) => / on /.test(p))) {
      const each = parts.map((p) => COUNTERS.put![1](p));
      return each.every((e) => e) ? each.flatMap((e) => [e!].flat()) : null;
    }
    // "its counters on target creature you control": every counter it had, of whatever kind.
    const its = /^(?:its|those|these|all its) counters on (.+)$/.exec(rest);
    if (its) { const on = objectOf(its[1]!); return on && { object: on.object, text: its[1]! }; }
    // "a number of +1/+1 counters on it equal to its power", "... equal to its power on each creature".
    const num = /^a number of (.+? counters?) (?:on (.+?) equal to (.+)|equal to (.+?) on (.+))$/.exec(rest);
    if (num) {
      const k = countersOf(num[1]!);
      const on = objectOf((num[2] ?? num[5]!).replace(/^each of /, ""));
      return k && on ? { object: on.object, counter: k.counter, amount: num[3] ?? num[4]!, text: num[2] ?? num[5]! } : null;
    }
    const m = /^(.+? counters?) on (.+?)(?: for each (.+))?$/.exec(rest);
    const cs = m ? counterList(m[1]!) : null;
    const on = m ? objectOf(m[2]!.replace(/^each of /, "")) : null;
    if (!cs || !on) return null;
    return cs.map((c) => ({ object: on.object, counter: c.counter, amount: m![3] ? `${c.amount ?? "1"} for each ${m![3]}` : c.amount ?? "1", text: m![2] }));
  }],
  // "move a +1/+1 counter from this artifact onto target creature": a removal, then a placement.
  move: ["remove-counter", (rest) => {
    const m = /^(.+? counters?) from (.+?) onto (.+)$/.exec(rest);
    const c = m ? countersOf(m[1]!) : null;
    const from = m ? objectOf(m[2]!) : null, to = m ? objectOf(m[3]!.replace(/^a second target/, "another target")) : null;
    return c && from && to ? [{ object: from.object, counter: c.counter, amount: c.amount ?? "1", text: m![2] },
      { verb: "add-counter", object: to.object, counter: c.counter, amount: c.amount ?? "1", text: m![3] }] : null;
  }],
  remove: ["remove-counter", (rest) => {
    const m = /^(all|.+? counters?) from (.+)$/.exec(rest);
    const c = m ? (/^all .+ counters$/.test(m[1]!) ? { amount: "all", counter: counterKindOf(m[1]!.slice(4)) } : countersOf(m[1]!)) : null;
    const on = m ? objectOf(m[2]!) : null;
    if (!c?.counter || !on) return null;
    return { object: on.object, counter: c.counter, amount: c.amount ?? "1", text: m![2] };
  }],
  proliferate: ["proliferate", (rest) => (rest === "" ? {} : timesOf(rest) ? { amount: timesOf(rest)! } : null)],
};

/** "a Treasure token", "two 1/1 white Soldier creature tokens with flying", "X 2/2 black Zombie creature
 *  tokens", "a token that's a copy of target creature you control", "a number of 1/1 Saproling tokens
 *  equal to its power". The object text is the whole printed phrase, as the store writes it; the
 *  filter grammar reads its characteristics. */
function tokenOf(phrase: string): Args | null {
  // "that's tapped and attacking" is how the token ENTERS, not what it is: kept out of the text, or the
  // token's own node (a Soldier) would no longer join the card that makes it.
  let t = phrase.trim().replace(/ (?:that(?:'s| are) )?tapped and attacking(?: (?:that player|that opponent|the defending player|that player or a planeswalker they control))?(?=$|, except )/, "");
  // "a token that's a copy of it, except it isn't legendary": the exception changes the copy, and is
  // read so nothing is skipped; the text keeps it, as the store writes it.
  const except = t.search(/, except /);
  if (except > 0 && /\bcopy of\b/.test(t)) {
    if (!exceptOf(t.slice(except + ", except ".length), SELF)) return null;
    const r = tokenOf(t.slice(0, except));
    return r && { ...r, ...(r.text !== undefined ? { text: phrase.trim() } : {}) };
  }
  let amount: string | undefined;
  // The text derive reads is the token phrase alone: "equal to that creature's power" is the amount,
  // and left in the text it made Ruthless Technomancer's Treasures creatures.
  let text = t;
  const eq = /^a number of (.+?) equal to (.+)$/.exec(t);
  if (eq) { t = `a ${eq[1]!.replace(/tokens\b/, "token")}`; amount = eq[2]!; text = eq[1]!; }
  // Not inside a quoted ability: 'with "This token gets +1/+1 for each artifact you control."'.
  const quoteEnd = t.lastIndexOf('"');
  const each = / for each (.+)$/.exec(t.slice(quoteEnd + 1));
  if (each) t = t.slice(0, quoteEnd + 1 + each.index);
  if (!/\btokens?\b/.test(t)) return null;
  const count = /^(a|an|one|two|three|four|five|six|seven|eight|nine|ten|x|\d+|that many) /i.exec(t);
  const n = count ? amountOf(count[1]!) ?? count[1]!.toLowerCase() : undefined;
  // The filter grammar reads the characteristics; a count it has no word for ("that many") and a
  // quoted ability it cannot read are not characteristics, so a reading without them stands in.
  const bare = count && !amountOf(count[1]!) ? `a ${t.slice(count[0].length).replace(/tokens\b/, "token")}` : t;
  const copiesRef = /\bcop(?:y|ies) of (?:that|it|those|them|the exiled|the sacrificed|this\b|~)/.test(t);
  // A copy of a back-reference or of the card itself is a token whatever the filter makes of it.
  const object = parse(bare) ?? parse(bare.replace(/ with "[^"]*"$/, "")) ?? (copiesRef && /^an? token that's a copy of /.test(bare) ? { control: "any" as const, token: true } : null);
  if (!object || object.token !== true) return null;
  // A COPY OF A BACK-REFERENCE ("a token that's a copy of that permanent", Second Harvest) keeps the
  // stored object: the filter grammar reads "that permanent" as the class permanent, which would let
  // every copied token feed landfall and enchantress.
  return { object: copiesRef ? { ...object, ref: "sentence" } : object, amount: amount ?? (each ? `${n ?? "1"} for each ${each[1]}` : n ?? "1"), ...(copiesRef ? {} : { text }) };
}

/** "a Clue token, a Food token, and a Treasure token": one creation per token, as the store writes them. */
function tokenList(rest: string): Args | Args[] | null {
  // "two of those tokens": more of what the sentence made, kept as stored.
  const more = /^(a|an|one|two|three|that many) of (?:those|these) tokens$/.exec(rest);
  if (more) return { object: { control: "any", token: true, ref: "sentence" }, amount: amountOf(more[1]!) ?? more[1]! };
  // The list first: the filter grammar would read "a Clue token, a Food token, and a Treasure token"
  // as ONE token of three types.
  const parts = rest.split(/,? and (?=(?:a|an|one|two|three) )|, (?=(?:a|an|one|two|three) )/);
  if (parts.length >= 2) {
    const out = parts.map(tokenOf);
    if (out.every((x) => x !== null)) return out as Args[];
  }
  return tokenOf(rest);
}

/** "twice", "five times", "X times", "that many times". */
function timesOf(rest: string): string | null {
  if (rest === "" || rest === "an additional time") return "1";
  if (rest === "twice") return "2";
  const m = /^(\w+|that many) times$/.exec(rest);
  return m ? amountOf(m[1]!) ?? m[1]! : null;
}

const TOKENS: Record<string, [string, Handler]> = {
  create: ["create", (rest) => {
    const r = tokenList(rest);
    // "create a tapped Powerstone token": the tap on what was made.
    return r && /^(?:a|an|two|three|x|that many|\w+) tapped /i.test(rest) ? [...[r].flat(), TAPPED] : r;
  }],
  investigate: ["investigate", (rest) => (timesOf(rest) ? { amount: timesOf(rest)! } : null)],
  populate: ["populate", (rest) => (rest === "" ? {} : null)],
  // "incubate 2", "amass Orcs 2": the number is the amount, an amass's type the object (as stored).
  incubate: ["incubate", (rest) => {
    const m = /^(\w+)(?: (twice|\w+ times))?$/.exec(rest);
    return m && amountOf(m[1]!) ? { amount: amountOf(m[1]!)! } : null;
  }],
  amass: ["amass", (rest) => {
    const m = /^(?:([A-Z][a-z]+) )?(\w+)$/.exec(rest);
    return m && amountOf(m[2]!) ? { amount: amountOf(m[2]!)!, ...(m[1] ? { text: m[1] } : {}) } : null;
  }],
};

/** Where a card goes or comes from, as the store names the zone. */
function zoneOf(words: string): string | undefined {
  if (/^hands?$/.test(words)) return "hand";
  if (/^graveyards?$/.test(words)) return "graveyard";
  if (/^librar(?:y|ies)$/.test(words)) return "library";
  if (/^(?:the )?battlefield$/.test(words)) return "battlefield";
  if (/^exile$/.test(words)) return "exile";
  return undefined;
}

/** "from your graveyard", "from exile", "from among them" stripped off an object, with its zone. */
function fromOf(phrase: string): { rest: string; from?: string } {
  const at = phrase.search(/ from (?:your|their|its owner's|a|an opponent's|target player's|that player's|each player's|each opponent's|all) (?:graveyards?|hands?|librar(?:y|ies))(?: or from exile)?$| from exile$| from the battlefield$/);
  if (at < 0) return { rest: phrase };
  return { rest: phrase.slice(0, at), from: zoneOf(phrase.slice(at + " from ".length).replace(/ or from exile$/, "").replace(/^(?:your|their|its owner's|a|an opponent's|target player's|that player's|each player's|each opponent's|all|the) /, "")) };
}

const MOVE_REF = /^(?:(?:one|two|three|up to (?:one|two|three)|any number) of (?:them|those cards)|the rest|the other|the tokens?|the (?:chosen |blocking |blocked |attacking |other )?creatures?|the rest of (?:the|those) (?:[a-z]+ )*cards|both creatures|the creatures? you chose|one|that [a-z]+(?: card)?|those [a-z]+(?: cards)?|(?:one|that) pile|all (?:[a-z]+ )*cards revealed this way|the (?:exiled|chosen|revealed|milled) cards?|the cards? exiled (?:this way|with (?:it|~))|all cards exiled with (?:it|~)|her|his)$/;

/** A zone move's object: a class, the card itself, or a back-reference (kept as stored). The COUNT
 *  stays in the text, as the store writes a zone move ("two creatures", no amount): derive's counts
 *  read it there. `onField`: a permanent moved with no "from" leaves the battlefield. */
function moveObject(phrase: string, onField = false): Args | null {
  const t = phrase.replace(/ at random$/, "").replace(/ of (?:their|his or her|your) choice$/, "").replace(/ from among (?:them|those cards|the (?:cards )?milled (?:this way|cards)|the cards milled this way)$/, "");
  // "target player's graveyard", "all graveyards": a whole graveyard.
  if (/^(?:target player's|target opponent's|each opponent's|your|their|all|each player's|all opponents'|any number of target players'|target players') graveyards?$/.test(t)) return { object: { control: "any", token: null }, fromZone: "graveyard", text: phrase };
  // "one of them", "the rest", "the exiled card", "those tokens": back-references, kept as stored.
  if (MOVE_REF.test(t)) return { object: { control: "any", token: null, ref: "sentence" } };
  const { rest, from } = fromOf(t);
  // "one of them from your graveyard": the same, from where it is.
  if (from && MOVE_REF.test(rest)) return { object: { control: "any", token: null, ref: "sentence" }, fromZone: from };
  if (/^the top (?:creature )?card of your graveyard$/.test(rest)) return { object: CARD, fromZone: "graveyard", text: phrase };
  if (/^the top (?:card|(?:\w+|\d+) cards) of (?:your|their|target player's|each player's|its owner's|that player's|each opponent's|target opponent's) library$/.test(rest)) {
    // "their library": whose is the actor's, a back-reference ("target opponent exiles the top four
    // cards of their library", Oblivion Sower), so the stored object, which names them, stays.
    return / of their library$/.test(rest) ? { object: { ...CARD, ref: "sentence" }, fromZone: "library" } : { object: CARD, fromZone: "library", text: phrase };
  }
  const r = objectOf(rest);
  if (!r) return null;
  // "from their graveyard": whose is a back-reference ("target opponent mills three cards. Put a land
  // card from their graveyard ...", Realmbreaker), so the stored object, which names them, stays.
  if (/ from their /.test(t)) return { object: { ...r.object, ref: "sentence" }, ...(from ? { fromZone: from } : {}) };
  const field = onField && !from && r.object.ref === undefined && r.object.self !== true && !/\bcards?\b/.test(rest);
  return { object: r.object, ...(from ? { fromZone: from } : field ? { fromZone: "battlefield" } : {}), text: phrase.replace(/ from among (?:them|those cards)$/, "") };
}

/** "to its owner's hand", "to the battlefield tapped under your control", "on top of its owner's
 *  library", "into your graveyard", "onto the battlefield": the destination zone. */
function destinationOf(words: string): string | undefined {
  let t = words;
  for (let prev = ""; prev !== t;) {
    prev = t;
    t = t.replace(/ (?:tapped|transformed|face down|attacking|and|in any order|in a random order|second from the top|third from the top)$| attached to (?:it|that creature|a creature you control|target creature)$/, "")
      .replace(/ under (?:your|its owner's|their owners'|its controller's|their owner's|her owner's|his owner's) control$/, "");
  }
  t = t.replace(/^on their choice of the top or bottom of /, "on top of ");
  const m = /^(?:to|into|onto|on top of|on the bottom of|in) (?:the |its owner's |their owners' |their owner's |her owner's |his owner's |your |their |a player's |an opponent's |that player's |a )?(.+)$/.exec(t);
  return m ? zoneOf(m[1]!) : undefined;
}

/** "exile it with three time counters on it": the move, then the counters on what moved. */
function withCounters(rest: string, move: (rest: string) => Args | Args[] | null): Args[] | Args | null {
  // "with an additional +1/+1 counter on it", "with a hexproof counter and an indestructible counter
  // on it": cut by index (CodeQL polynomial-redos).
  const at = rest.search(/ with (?:a|an|one|two|three|four|five|x|\d+) /);
  if (at < 0 || !/ counters? on (?:it|them)$/.test(rest)) return move(rest);
  const r = move(rest.slice(0, at));
  const c = counterList(rest.slice(at + " with ".length).replace(/ on (?:it|them)$/, "").replace(/\b(an?|one|two|three) additional /g, "$1 "));
  return r && c ? [...[r].flat(), ...c.map((k) => ({ verb: "add-counter", object: { control: "any" as const, token: null, ref: "sentence" as const }, counter: k.counter, amount: k.amount ?? "1" }))] : null;
}

/** Where a list of objects splits: before each new determiner ("target artifact, target creature,
 *  and target land", "up to one target artifact card, up to one target enchantment card").
 *  "all artifacts, creatures, and lands" is one object and does not split. */
const OBJECT_JOINT = /,? and (?=(?:target|another target|up to one|each|all|this|a|an) )|, (?=(?:target|another target|up to one|each|all|this|a|an) )/;

/** A list of distinct objects, one move each, as the store writes them; a "from <zone>" closing the
 *  list belongs to every item ("... and up to one target sorcery card from your graveyard"). */
function moveList(text: string, onField = false): Args | Args[] | null {
  const parts = text.split(OBJECT_JOINT);
  if (parts.length < 2) return moveObject(text, onField);
  const from = / from (?:your|their|a|an opponent's|target player's|all) (?:graveyards?|hands?|librar(?:y|ies))$/.exec(parts[parts.length - 1]!)?.[0] ?? "";
  const each = parts.map((p) => {
    const r = moveObject(p.endsWith(from) ? p : `${p}${from}`, onField);
    return r && r.text !== undefined ? { ...r, text: p } : r;
  });
  return each.every((e) => e) ? (each as Args[]) : null;
}

const ZONE: Record<string, [string, Handler]> = {
  destroy: ["destroy", (rest) => moveList(rest)],
  sacrifice: ["sacrifice", (rest) => moveList(rest)],
  exile: ["exile", (rest) => withCounters(rest.replace(/ face down$/, ""), (rest) => {
    rest = rest.replace(/ instead of putting (?:it|that card|that spell) (?:anywhere else|into (?:its owner's|a|your) graveyard)(?: as it resolves)?$/, "");
    const until = rest.search(/ until /);
    // "exile cards from the top of your library until you exile a nonland card": the until is WHICH
    // card, not how long.
    // Read whole, the until clause in its text, as the store writes it (a class-restricted dig). Only
    // YOUR library: "their library" is the actor's, a back-reference the stored object names.
    if (/^cards from the top of /.test(rest)) {
      return /^cards from the top of your library until you exile (?:an? |two )[\w ,-]+? cards?(?: with (?:lesser|greater) mana value)?$/.test(rest)
        ? { object: CARD, fromZone: "library", toZone: "exile", text: rest } : null;
    }
    const r = moveList(until > 0 ? rest.slice(0, until) : rest);
    return r && [r].flat().map((x) => ({ ...x, toZone: "exile" }));
  })],
  return: ["return", (all) => withCounters(all, (rest) => {
    const at = rest.search(/ (?:to|on top of|on the bottom of) (?=the battlefield|its owner's|their owners'|their owner's|your|its controller's)/);
    if (at < 0) return null;
    const to = destinationOf(rest.slice(at + 1));
    const r = moveList(rest.slice(0, at), true);
    // "onto the battlefield tapped": the store writes the tapping as its own action on what moved.
    return r && to ? [...[r].flat().map((x) => ({ ...x, toZone: to })), ...(/ tapped\b/.test(rest.slice(at)) ? [TAPPED] : [])] : null;
  })],
  put: ["put", (all): Args | Args[] | null => withCounters(all, (rest) => {
    // "shuffle and put that card on top": the library just shuffled.
    const top = /^(.+?) on top(?: in any order)?$/.exec(rest);
    // "the rest on the bottom in any order": the library the sentence already named.
    const bottom = /^(.+?) on the bottom(?: in (?:any|a random) order)?$/.exec(rest);
    if (bottom && !bottom[1]!.includes(" and ")) { const r = moveObject(bottom[1]!); return r && { ...r, toZone: "library" }; }
    if (top) { const r = moveObject(top[1]!); return r && { ...r, toZone: "library" }; }
    // "put them back in any order", "put one of those cards back on top of your library".
    const back = /^(.+?) back (?:on top of (?:your|their|its owner's|that player's|target player's) library(?: in any order)?|in any order)$/.exec(rest);
    if (back) { const r = moveObject(back[1]!); return r && { ...r, toZone: "library" }; }
    // "one of them into your hand and the rest on the bottom of your library": two moves.
    // "a land card from among them onto the battlefield tapped and an Elf card from among them into
    // your hand" (Bounty of Skemfar): the same, each with its own object.
    for (const pair of rest.matchAll(/ and (?=(?:the (?:rest|other)|a|an|one|two|all) )/g)) {
      const a = ZONE.put![1](rest.slice(0, pair.index)), b = ZONE.put![1](rest.slice(pair.index + pair[0].length));
      if (a && b) return [a, b].flat();
    }
    rest = rest.replace(/ instead of putting (?:it|that card) (?:into (?:your|its owner's|a) graveyard|anywhere else)$/, "");
    const at = rest.search(/ (?:onto|into|on top of|on the bottom of) (?=the battlefield|its owner's|their owners'|your|a graveyard|exile|their|that player's)/);
    if (at < 0) return null;
    const to = destinationOf(rest.slice(at + 1));
    // "this creature and target creature on top of their owners' libraries": a move each.
    const r = moveList(rest.slice(0, at), true);
    if (!r || !to) return null;
    const moved = [r].flat().map((x) => ({ ...x, toZone: to }));
    // "onto the battlefield tapped": the store writes the tapping as its own action on what moved.
    return / tapped\b/.test(rest.slice(at)) ? [...moved, TAPPED] : moved.length === 1 ? moved[0]! : moved;
  })],
  shuffle: ["shuffle", (rest) => {
    if (rest === "" || /^(?:your|their) library$/.test(rest)) return { object: parse("you")!, text: rest === "" ? "your library" : rest };
    if (/^(?:their|your) hand and graveyard into (?:their|your) library$/.test(rest)) return { object: { control: "any", token: null }, toZone: "library", text: rest };
    const m = /^(.+?) into (?:its owner's|their owners'|your|their) librar(?:y|ies)$/.exec(rest);
    const r = m ? moveObject(m[1]!) : null;
    return r && { ...r, toZone: "library" };
  }],
};

/** Mana as printed: "{C}", "{R} or {G}", "{G}{G}", "one mana of any color", "two mana in any
 *  combination of colors", "X mana of any one color". */
const MANA = /^(?:(?:\{[WUBRGCSX0-9/]+\})+(?:,? (?:or|and) (?:\{[WUBRGCSX0-9/]+\})+|, (?:\{[WUBRGCSX0-9/]+\})+)*|(?:one|two|three|four|five|x|that much|that many|an additional) (?:additional )?mana (?:of any (?:one )?(?:color|type)|in any combination of colors|of the chosen color|of any color that a land an opponent controls could produce|of any of the exiled card's colors)?)$/i;
/** One more mana item, read by its shape rather than a list: "an additional {G}", "that much {C}",
 *  "an additional one mana of any color", "one mana of any type that land produced", "two mana of
 *  different colors", "X mana in any combination of {B} and/or {R}". The text keeps what it makes. */
const MANA_ITEM = /^(?:an additional |that much |(?:two|three|four|five|six|seven|eight|nine|ten|x) )?(?:\{[WUBRGCSX0-9/]+\})+$|^(?:an additional )?(?:one|two|three|four|five|six|seven|eight|nine|ten|x|that much|that many)(?: additional)? mana (?:of|in) [^,]+$/i;
const manaOf = (t: string): boolean => MANA.test(t) || t.split(/,? or (?=\{|an? |one |two |three |x )/i).every((p) => MANA_ITEM.test(p.trim()));

const MANA_TAP: Record<string, [string, Handler]> = {
  add: ["add-mana", (rest) => {
    // "an amount of {G} equal to this creature's power": the amount is what it equals.
    const eq = /^an amount of ((?:\{[WUBRGC]\})+) equal to (.+)$/i.exec(rest);
    if (eq) return { object: { control: "any", token: null }, text: eq[1]!, amount: eq[2]! };
    const each = rest.indexOf(" for each ");
    const mana = each >= 0 ? rest.slice(0, each) : rest;
    if (!manaOf(mana)) return null;
    return { object: { control: "any", token: null }, text: mana, ...(each >= 0 ? { amount: rest.slice(each + 1) } : {}) };
  }],
  // "tap or untap target permanent": either, so both.
  "tap or untap": ["tap", (rest) => {
    const r = thing(rest);
    return r && [r, { ...r, verb: "untap" }];
  }],
  tap: ["tap", (rest) => {
    // "tap it and up to one target creature an opponent controls": one tap each.
    const parts = rest.split(OBJECT_JOINT);
    if (parts.length > 1) {
      const each = parts.map((p) => objectOf(p));
      return each.every((e) => e) ? each.map((e, i) => ({ object: e!.object, ...(e!.object.ref || e!.object.self ? {} : { text: parts[i]! }) })) : null;
    }
    const r = objectOf(rest);
    return r && { object: r.object, ...(r.object.ref || r.object.self ? {} : { text: rest }) };
  }],
  untap: ["untap", (rest) => {
    const r = objectOf(rest);
    return r && { object: r.object, ...(r.object.ref || r.object.self ? {} : { text: rest }) };
  }],
};

/** The tap a move or a creation carries ("onto the battlefield tapped", "a tapped Treasure token"),
 *  on a back-reference so it keeps the stored object. */
const TAPPED: Args = { verb: "tap", object: { control: "any", token: null, ref: "sentence" } };

/** A thing-object verb's object: a class, the card itself, or a back-reference (kept as stored). */
function thing(rest: string): Args | null {
  const r = objectOf(rest);
  return r && { object: r.object, ...(r.object.ref ? {} : { text: rest }) };
}
/** "bolster 2", "adapt X", "monstrosity 3": the number is the amount; the store's object stays. */
const numbered = (rest: string): Args | null => (/^(?:\d+|x)$/i.test(rest) ? { amount: rest.toUpperCase() === "X" ? "X" : rest } : null);

const TAIL: Record<string, [string, Handler]> = {
  counter: ["counter-spell", (rest) => (/\bspells?\b|^(?:it|that spell|them|~)$|abilit/i.test(rest) ? thing(rest) : null)],
  regenerate: ["regenerate", thing],
  transform: ["transform", thing],
  goad: ["goad", thing],
  detain: ["detain", thing],
  suspect: ["suspect", thing],
  copy: ["copy", (rest) => {
    // "copy it twice", "copy that card three times": the copies are the amount.
    const times = / (twice|\w+ times)$/.exec(rest);
    if (times && timesOf(times[1]!)) { const r = thing(rest.slice(0, times.index)); return r && { ...r, amount: timesOf(times[1]!)! }; }
    // "copy it, except the copy isn't legendary".
    const exc = rest.indexOf(", except ");
    if (exc > 0) { const r = thing(rest.slice(0, exc)); const e = exceptOf(rest.slice(exc + ", except ".length), { control: "any", token: null }); return r && e ? [r, ...e] : null; }
    const each = rest.indexOf(" for each ");
    const r = thing(each >= 0 ? rest.slice(0, each) : rest);
    return r && { ...r, ...(each >= 0 ? { amount: rest.slice(each + 1) } : {}) };
  }],
  attach: ["attach", (rest) => {
    const to = rest.indexOf(" to ");
    return to > 0 && objectOf(rest.slice(to + 4)) ? thing(rest.slice(0, to)) : null;
  }],
  cast: ["cast", (rest) => {
    // "this card from your graveyard by discarding two cards in addition to paying its other costs":
    // the cast and the discard it costs, as the store writes them.
    const by = / by discarding (.+?) in addition to paying its other costs$/i.exec(rest);
    const cast = castOrPlay(by ? rest.slice(0, by.index) : rest, /\bspells?\b|\bcards?\b|\bcop(?:y|ies)\b|^(?:it|them|~)$/i);
    if (!by) return cast;
    const d = DRAW_SEARCH.discard![1](by[1]!);
    return cast && d && !Array.isArray(d) ? [cast, { ...d, verb: "discard", text: by[1]! }] : null;
  }],
  play: ["play", (rest) => castOrPlay(rest, /\blands?\b|\bcards?\b|^(?:it|them)$/i)],
  // "prevent all combat damage that would be dealt this turn": the store keeps the whole phrase.
  prevent: ["prevent", (rest) => (/\bdamage\b/.test(rest) ? { object: { control: "any", token: null }, text: rest } : null)],
  // "double its power", "double the number of +1/+1 counters on it": the verb is read, the doubled
  // thing keeps the stored object (it names the counters' holder, which "it" / "each of them" hides).
  double: ["double", (rest) => (rest !== "" ? { object: { control: "any", token: null, ref: "sentence" } } : null)],
  bolster: ["bolster", numbered],
  adapt: ["adapt", numbered],
  monstrosity: ["monstrosity", numbered],
  support: ["support", numbered],
  discover: ["discover", numbered],
  "collect evidence": ["collect-evidence", numbered],
  "venture into the dungeon": ["venture-into-the-dungeon", (rest) => (rest === "" ? {} : null)],
  "manifest dread": ["manifest-dread", (rest) => (rest === "" ? {} : null)],
  learn: ["learn", (rest) => (rest === "" ? {} : null)],
  // The rest of the keyword actions and game actions: the verb is read, the stored object stays.
  roll: ["roll-dice", (rest) => (/^(?:a|an|one|two|three) (?:d\d+|(?:four|six|eight|ten|twelve|twenty)-sided (?:die|dice)|dice|die)(?: \w+ times?)?$/i.test(rest) ? {} : null)],
  flip: ["flip-coin", (rest) => (/^(?:a coin|two coins|a coin until you lose a flip)$/i.test(rest) ? {} : null)],
  take: ["extra-turn", (rest) => (/^(?:an|two) extra turns? after this one$/i.test(rest) ? {} : null)],
  "get an emblem": ["emblem", (rest) => (/^with /i.test(rest) || rest === "" ? {} : null)],
  switch: ["exchange", (all) => {
    const rest = all.replace(DURATION, "");
    return /'s power and toughness$/i.test(rest) && objectOf(rest.replace(/'s power and toughness$/i, "")) ? {} : null;
  }],
  "exchange control of": ["exchange", (rest) => (rest !== "" ? {} : null)],
  "win the game": ["win-game", (rest) => (rest === "" ? {} : null)],
  "lose the game": ["lose-game", (rest) => (rest === "" ? {} : null)],
  clash: ["clash", (rest) => (/^with an opponent$/i.test(rest) ? {} : null)],
  exert: ["exert", (rest) => (/ as (?:it|he|she|they) attacks?$/i.test(rest) && objectOf(rest.replace(/ as (?:it|he|she|they) attacks?$/i, "")) ? {} : null)],
  manifest: ["manifest", (rest) => (/^the top (?:card|two cards) of (?:your|their) library$/i.test(rest) ? {} : null)],
  convert: ["convert", thing],
  earthbend: ["earthbend", numbered],
  airbend: ["airbend", (rest) => (rest !== "" ? {} : null)],
  waterbend: ["waterbend", (rest) => numbered(rest.replace(/^\{(\d+|x)\}$/i, "$1"))],
  // More keyword actions (CR 701): the verb is read, the stored object stays.
  "empower jace": ["empower-jace", numbered],
  recruit: ["recruit", (rest) => (rest === "" ? {} : null)],
  "time travel": ["time-travel", (rest) => (rest === "" || /^(?:twice|\w+ times)$/i.test(rest) ? {} : null)],
  cloak: ["cloak", (rest) => (/^(?:a card from your hand|the top (?:card|two cards) of your library)$/i.test(rest) ? {} : null)],
  forage: ["forage", (rest) => (rest === "" ? {} : null)],
  harness: ["harness", thing],
  unattach: ["unattach", (rest) => (/^(?:all )?(?:equipment|auras?)\b/i.test(rest) || rest !== "" ? {} : null)],
  meld: ["meld", (rest) => (/^(?:them|it and .+) into .+$/i.test(rest) ? {} : null)],
  vote: ["vote", (rest) => (/^for /i.test(rest) ? {} : null)],
  turn: ["turn-face-up", (rest) => (/ face up$/i.test(rest) && objectOf(rest.replace(/ face up$/i, "")) ? thing(rest.replace(/ face up$/i, "")) : null)],
  blight: ["blight", numbered],
  behold: ["behold", (rest) => (/^(?:a|an) [\w -]+$/i.test(rest) ? {} : null)],
};

/** "you may cast it without paying its mana cost", "play lands from your graveyard", "play an
 *  additional land on each of your turns": what is cast or played, the manner and time stripped. */
function castOrPlay(rest: string, what: RegExp): Args | null {
  let t = rest;
  for (let prev = ""; prev !== t;) {
    prev = t;
    t = t.replace(/ (?:as though (?:it|they) had flash|without paying (?:its|their) mana costs?|this turn|until end of turn|until (?:the )?end of your next turn|until your next end step|on each of (?:your|their) turns|for as long as it remains exiled|for as long as (?:they|it) remain exiled|using its [\w-]+ ability|by paying (?:\{[^}]+\})+ rather than paying (?:its|their) mana costs?)$/i, "")
      // "..., and you may spend mana as though it were mana of any color to cast that spell".
      .replace(/,? and (?:you may spend mana as though it were mana of any (?:color|type)|mana of any type can be spent) to cast (?:that spell|it|them|those spells)$/i, "");
  }
  t = t.replace(/ as an Adventure$/i, "").replace(/ by paying (?:\d+|one|two|three) life in addition to paying (?:its|their) other costs$/i, "");
  // "a spell from your hand with mana value 3 or less": the zone mid-phrase, moved to the end.
  const mid = / from (your hand|your graveyard|exile)(?= with )/i.exec(t);
  if (mid) t = `${t.slice(0, mid.index)}${t.slice(mid.index + mid[0].length)} from ${mid[1]}`;
  const from = / from (?:the top of (?:your|their) library|your graveyard(?: or from exile)?|your hand|exile|among them|among those (?:exiled )?cards|among (?:the )?cards? exiled [\w ]+)$/i.exec(t);
  if (!what.test(from ? t.slice(0, from.index) : t)) return null;
  const zone = from ? (/library/.test(from[0]) ? "library" : /graveyard/.test(from[0]) ? "graveyard" : /hand/.test(from[0]) ? "hand" : /exile/.test(from[0]) ? "exile" : undefined) : undefined;
  const r = objectOf(from ? t.slice(0, from.index) : t) ?? (/^(?:a|an|one|two) additional lands?$/i.test(t) ? { object: parse("a land")! } : null);
  if (!r) return null;
  // A relative clause ("spells that have a cycling ability") is a narrowing the filter can drop: not
  // read, so the stored action stands (Abandoned Sarcophagus).
  if (/ that (?!damage\b|much\b|many\b)/.test(t)) return null;
  return { object: r.object, ...(r.object.ref ? {} : { text: t }), ...(zone ? { fromZone: zone } : {}) };
}

/** "<subject> explores", "<subject> connives", "<subject> fights <other>", "<subject> is goaded",
 *  "you become the monarch", "the Ring tempts you": actions whose subject stands first. */
function subjectAction(t: string): ActionReading[] | null {
  // "Cast this spell only during combat [and only if ...]": a timing restriction per "only", the
  // store's `cant` on casting it.
  const only = /^cast this spell only (.+)$/i.exec(t);
  if (only) return only[1]!.split(/ and only /i).map((part) => ({ verb: "cant", object: SELF, text: `cast this spell only ${part}` }));
  // "Instant and sorcery spells you cast cost {1} less to cast": the store's cost-modify, the
  // spells its object and the change its amount.
  // STRIVE, an ability word: "This spell costs {1}{G} more to cast for each
  // target beyond the first" -- the store's cost-modify, the whole phrase its text.
  if (/^this spell costs (?:\{[^}]+\})+ more to cast for each target beyond the first$/i.test(t)) return [{ verb: "cost-modify", object: SELF, text: t }];
  // "Activated abilities of artifact tokens you control cost {1} less to activate", "Cycling abilities
  // you activate cost {2} less to activate": abilities, which no filter names.
  const act = /^((?:[\w ]+ )?abilities [^,]{0,80}?) costs? ((?:\{[^}]+\})+) (less|more) to activate$/i.exec(t);
  // The whole phrase is the text: derive reads the abilities' holder ("artifacts you control") off it.
  if (act) return [{ verb: "cost-modify", object: { control: "any", token: null }, text: t, amount: `${act[3]!.toLowerCase() === "less" ? "-" : "+"}${act[2]!}` }];
  // "Cleric spells you cast cost {W}{B} less to cast": coloured mana, the symbols the amount.
  const pips = /^(.+?) costs? ((?:\{[^}]+\}){1,6}) (less|more) to cast( for each .+)?$/i.exec(t);
  if (pips && !/^\{(?:\d+|x)\}$/i.test(pips[2]!) && objectOf(pips[1]!) && !/^the (?:first|second|third|next)\b|\beach turn\b/i.test(pips[1]!)) {
    return [{ verb: "cost-modify", object: objectOf(pips[1]!.replace(/^each /i, ""))!.object, text: pips[1]!.replace(/^each /i, ""), amount: `${pips[3]!.toLowerCase() === "less" ? "-" : "+"}${pips[2]!}${pips[4] ?? ""}` }];
  }
  const cost = /^(.+?) costs? \{(\d+|x)\} (less|more) to cast( for each .+)?$/i.exec(t);
  // "The first instant or sorcery spell you cast each turn": an ordinal no filter field holds, so the
  // stored action stands rather than a widened subject (Baral).
  // "The second spell you cast each turn costs {1} less": an ordinal no filter field holds, so the
  // stored object stands (Baral), and the change is read.
  if (cost && /^the (?:first|second|third|next) [\w ]+? you cast (?:each|this) turn$/i.test(cost[1]!)) {
    return [{ verb: "cost-modify", object: REF, amount: `${cost[3]!.toLowerCase() === "less" ? "-" : "+"}${cost[2]!.toUpperCase()}` }];
  }
  if (cost && objectOf(cost[1]!) && !/^the (?:first|second|third)\b|\beach turn\b/i.test(cost[1]!)) {
    const sign = cost[3]!.toLowerCase() === "less" ? "-" : "+";
    // "Each creature spell you cast ...": the class, as the store writes it, without the "each".
    const spells = cost[1]!.replace(/^each /i, "");
    return [{ verb: "cost-modify", object: objectOf(spells)!.object, text: spells, amount: `${sign}${cost[2]!.toUpperCase()}${cost[4] ?? ""}` }];
  }
  if (/^you become the monarch$/i.test(t)) return [{ verb: "monarch" }];
  // A CHARACTERISTIC-DEFINING ABILITY (CR 604.3): "Titania's power and toughness are each equal to the
  // number of lands you control", "~'s power is equal to ...". The card's own name, short or full, so
  // a few capitalised words; the store's modify-pt on the card, the count its amount.
  const cda = /^((?:~|this [a-z]+|[a-z][\w-]*(?: [A-Za-z][\w-]*){0,3}))'s (?:power(?: and toughness)?|toughness) (?:is|are)(?: each)? equal to (.+)$/i.exec(t);
  if (cda && !/\b(?:target|each|enchanted|equipped|that|another)\b/i.test(cda[1]!)) return [{ verb: "modify-pt", object: SELF, amount: cda[2]! }];
  // "This creature enters prepared", "it becomes prepared", "target creature becomes unprepared".
  const prepared = /^(.+?) (?:enters|becomes) (un)?prepared$/i.exec(t);
  if (prepared && (objectOf(prepared[1]!) || THEY.test(prepared[1]!))) {
    const who = objectOf(prepared[1]!)?.object ?? REF;
    return [{ verb: prepared[2] ? "unprepare" : "prepare", object: who }];
  }
  // "that creature's controller faces a villainous choice — ...": the choice, its options unread here.
  if (/^.{1,60}? faces? a villainous choice(?: — .*)?$/i.test(t)) return [{ verb: "face-a-villainous-choice" }];
  // "You may choose not to untap this creature during your untap step": the store's optional untap.
  const notUntap = /^you may choose not to untap (.+) during your untap step$/i.exec(t);
  if (notUntap && objectOf(notUntap[1]!)) return [{ verb: "untap", object: objectOf(notUntap[1]!)!.object, optional: true }];
  // "Target creature's owner puts it on their choice of the top or bottom of their library".
  const owner = /^(?:the owner of .+|.+'s owner|its owner) puts (?:it|that card) on their choice of the top or bottom of their library$/i.exec(t);
  if (owner) return [{ verb: "put", object: REF, toZone: "library" }];
  if (/^(?:after this (?:main )?phase, )?there (?:is|are) an additional combat phase(?: after this (?:main )?phase)?(?: followed by an additional main phase)?$/i.test(t)) return [{ verb: "extra-combat" }];
  if (/^(?:after this (?:main )?phase, )?there is an additional (?:main|beginning) phase(?: after this (?:main )?phase)?$/i.test(t)) return [{ verb: "extra-phase" }];
  // "that ability triggers an additional time": a trigger doubled.
  if (/^(?:that ability|it) triggers an additional time$/i.test(t)) return [{ verb: "trigger-again" }];
  if (/^(?:that player|target player|each opponent|you) (?:wins?|loses?) the game$/i.test(t)) return [{ verb: /wins? the game$/i.test(t) ? "win-game" : "lose-game" }];
  const phases = /^(.+?) phases? out$/i.exec(t);
  if (phases && (objectOf(phases[1]!) || THEY.test(phases[1]!))) return [{ verb: "phase-out" }];
  if (/^you take the initiative$/i.test(t)) return [{ verb: "initiative" }];
  if (/^the ring tempts you$/i.test(t)) return [{ verb: "ring-tempts" }];
  const have = /^you (may )?have (.+)$/i.exec(t);
  const body = have ? have[2]! : t;
  const opt = have?.[1] ? { optional: true as const } : {};
  const kw = /^(.+?) (explores|connives|endures (\d+|x)|is goaded|fights?) ?(.*)$/i.exec(body);
  if (!kw) return null;
  const who = objectOf(kw[1]!) ?? (THEY.test(kw[1]!) ? { object: REF } : null);
  if (!who) return null;
  const word = kw[2]!.toLowerCase();
  const self = who.object.ref || who.object.self ? {} : { text: kw[1]! };
  if (word.startsWith("fight")) {
    // "those creatures fight each other": the pair the sentence named.
    if (/^each other$/i.test(kw[4]!)) return [{ verb: "fight", object: REF, ...opt }];
    // The store writes the pair, "A and B", or B alone when A is the card or a back-reference.
    const other = objectOf(kw[4]!);
    if (!other) return null;
    return [{ verb: "fight", object: other.object, text: "text" in self ? `${kw[1]} and ${kw[4]}` : kw[4]!, ...(/^up to /i.test(kw[4]!) ? { optional: true as const } : {}), ...opt }];
  }
  if (kw[4]) return null;
  const verb = word === "explores" ? "explore" : word === "connives" ? "connive" : word === "is goaded" ? "goad" : "endure";
  return [{ verb, object: who.object, ...self, ...(kw[3] ? { amount: kw[3] } : {}), ...opt }];
}

const THEY = /^(?:they|it|he|she|that creature|those creatures|that permanent|the next [\w -]+? spell you cast this turn)$/i;
const REF: SubjectFilter = { control: "any", token: null, ref: "sentence" };

/** "<subject> enters tapped [unless ...]": tapped as it arrives, the store's `tap` on the card.
 *  "<subject> can't block", "doesn't untap during ...", "attacks each combat if able": a
 *  restriction, the store's `cant` with the restricted thing as its object. */
function restrictionOf(t: string): ActionReading[] | null {
  // "target creature attacks this turn if able", "~ attacks or blocks each combat if able", "all
  // creatures block each combat if able": requirements, the store's cant on the opposite.
  const req2 = /^(.+?) (attacks?(?: or blocks?)?|blocks?) (this turn|each combat) if able$/i.exec(t);
  if (req2) {
    const who = objectOf(req2[1]!) ?? (THEY.test(req2[1]!) ? { object: REF } : null);
    if (who) { lastSubject = req2[1]!; return [{ verb: "cant", object: who.object, text: `not ${req2[2]!.toLowerCase().replace(/s\b/g, "")} ${req2[3]!.toLowerCase()} if able` }]; }
  }
  // "its activated abilities can't be activated [this turn]", "enchanted creature's activated abilities
  // can't be activated": the store's cant on activating them.
  const acts = /^(its|.+?'s) activated abilities can't be activated(?: this turn)?$/i.exec(t);
  if (acts) {
    const who = /^its$/i.test(acts[1]!) ? { object: REF } : objectOf(acts[1]!.replace(/'s$/, ""));
    if (who) return [{ verb: "cant", object: who.object, text: "activate activated abilities" }];
  }
  // "Skip your draw step": the store's cant on drawing then.
  if (/^skip your draw step$/i.test(t)) return [{ verb: "cant", object: parse("you")!, text: "draw during your draw step" }];
  // "Damage can't be prevented [this turn]": no object, the store's cant on preventing it.
  if (/^(?:the )?damage can't be prevented(?: this turn)?$/i.test(t)) return [{ verb: "cant", object: { control: "any", token: null }, text: "prevent damage" }];
  // "This creature must be blocked [this turn] if able", "target creature blocks this creature this
  // turn if able": a requirement (CR 509.1c), the store's cant on its opposite.
  const blocked = /^(.+?) must be blocked( this turn)? if able$/i.exec(t);
  const blocks = /^(.+?) blocks(?: (?:this creature|~|it))? this turn if able$/i.exec(t);
  const req = blocked ?? blocks;
  if (req) {
    const who = objectOf(req[1]!) ?? (THEY.test(req[1]!) ? { object: REF } : null);
    if (who) { lastSubject = req[1]!; return [{ verb: "cant", object: who.object, text: blocked ? `be unblocked${blocked[2] ?? ""}` : "not block this turn if able" }]; }
  }
  // "you may have this land enter tapped": optional.
  const mayTapped = /^you may have (~|this [a-z]+) enter tapped$/i.exec(t);
  if (mayTapped) return [{ verb: "tap", object: SELF, optional: true }];
  const tapped = /^(.+?) enters?(?: the battlefield)? tapped(?: and attacking)?(?: (unless .+|if .+))?$/i.exec(t);
  if (tapped) {
    const who = objectOf(tapped[1]!);
    return who ? [{ verb: "tap", object: who.object, ...(who.object.self || who.object.ref ? {} : { text: tapped[1]! }), ...(tapped[2] ? { condition: tapped[2] } : {}) }] : null;
  }
  // "~ isn't a creature": the store's "be a creature".
  const isnt = /^(.+?) isn't a creature$/i.exec(t);
  if (isnt && objectOf(isnt[1]!)) return [{ verb: "cant", object: objectOf(isnt[1]!)!.object, text: "be a creature" }];
  // "<subject> loses flying", "loses hexproof and indestructible", "loses all abilities": the store's
  // `cant` per ability lost, "have abilities" for all of them.
  const loses = /^(.+?) loses? (.+?)$/i.exec(t.replace(DURATION, ""));
  if (loses && !/\blife\b|\bgame\b/i.test(loses[2]!)) {
    const who = objectOf(loses[1]!) ?? (THEY.test(loses[1]!) ? { object: REF } : null);
    if (who) {
      // "Enchanted creature loses all abilities and has base power and toughness 1/1": the "has" phrase
      // is the same creature's.
      lastSubject = loses[1]!;
      if (/^all abilities$/i.test(loses[2]!)) return [{ verb: "cant", object: who.object, text: "have abilities" }];
      const lost = abilitiesOf(loses[2]!);
      if (lost) return lost.map((a) => ({ verb: "cant", object: who.object, text: a }));
    }
  }
  const m = /^(.+?) (can't|cannot|doesn't|don't|attacks each combat if able|attack each combat if able|blocks each combat if able|can block only) ?(.*)$/i.exec(t);
  if (!m) return null;
  const who = objectOf(m[1]!) ?? (THEY.test(m[1]!) ? { object: REF } : null) ?? (/^enchanted player$/i.test(m[1]!) ? { object: { control: "any" as const, token: null } } : null) ?? (/^(?:you|your opponents|each opponent|players)$/i.test(m[1]!) ? { object: parse(m[1]!.toLowerCase().startsWith("you") ? "you" : "an opponent") ?? { control: "any" as const, token: null } } : null);
  if (!who) return null;
  // "can't block and can't be blocked", "can't attack or block, and its activated abilities can't be
  // activated": one restriction each.
  if (/^can't$/i.test(m[2]!)) {
    const parts = m[3]!.split(/,? and (?:can't |(?=its activated abilities can't be activated))/i);
    if (parts.length > 1) {
      const texts = parts.map((p) => (/^its activated abilities can't be activated$/i.test(p) ? "activate activated abilities" : p));
      if (texts.every((x) => x !== "" && !/can't/.test(x))) return texts.map((x) => ({ verb: "cant", object: who.object, text: x }));
    }
  }
  const word = m[2]!.toLowerCase();
  const what = /each combat if able/.test(word) ? `not ${word.replace(/s each/, " each")}${m[3] ? ` ${m[3]}` : ""}`
    : word === "can block only" ? `block ${m[3]!.replace(/^creatures with /, "creatures without ")}`
    : m[3]!;
  if (!what) return null;
  lastSubject = m[1]!;
  return [{ verb: "cant", object: who.object, text: what }];
}

/** "<it> enters with two +1/+1 counters on it": counters the permanent itself arrives with. */
const ENTERS_WITH = /^(?:~|this [a-z]+|it|that creature|that permanent|each creature) (?:enters(?: the battlefield)?(?: tapped)?|escapes) with /i;
/** "each other Beast creature you control enters with ..." (a class) as well as the card itself. */
const ENTERS_WITH_ANY = / (?:enters?(?: the battlefield)?(?: tapped)?|escapes?) with /i;
/** [counters phrase, "for each" tail, the subject when it is a class, abilities it enters with] of
 *  an "enters with ... on it" phrase, cut by index (CodeQL polynomial-redos), or null. */
function entersWithOf(t: string): [string, string | undefined, string | undefined, string[], string?] | null {
  const head = ENTERS_WITH.exec(t) ?? ENTERS_WITH_ANY.exec(t);
  if (!head) return null;
  const subject = head.index > 0 ? t.slice(0, head.index) : undefined;
  if (subject !== undefined && !objectOf(subject)) return null;
  let rest = t.slice(head.index + head[0].length).replace(/\b(an?|one|two|three|four|five|x) additional /gi, "$1 ").replace(/^your choice of /i, "");
  // "... on it and with trample", "... on it and with haste": the abilities it enters with.
  let withs: string[] = [];
  const and = rest.search(/ on (?:it|them|him|her) and with /);
  if (and > 0) {
    const a = abilitiesOf(rest.slice(rest.indexOf(" and with ", and) + " and with ".length));
    if (!a) return null;
    withs = a; rest = rest.slice(0, rest.indexOf(" and with ", and));
  }
  for (const on of [" on it", " on them", " on him", " on her"]) {
    const at = rest.indexOf(on);
    if (at < 0) continue;
    const after = rest.slice(at + on.length);
    if (after === "") return [rest.slice(0, at), undefined, subject, withs];
    // "a number of +1/+1 counters on it equal to the amount of mana spent to cast it".
    if (after.startsWith(" equal to ") && rest.startsWith("a number of ")) return [`X ${rest.slice("a number of ".length, at)}`, undefined, subject, withs, after.slice(" equal to ".length)];
    if (after.startsWith(" for each ")) return [rest.slice(0, at), after.slice(" for each ".length), subject, withs];
  }
  return null;
}

/** "your life total becomes 10". */
const SET_LIFE = /^(?:at the beginning of the first upkeep, )?(?:your|their|each player's|target player's|that player's|target opponent's) life total becomes (.+)$/i;

const HANDLERS: Record<string, [string, Handler]> = { ...ZONE, ...MANA_TAP, ...TAIL, ...DRAW_SEARCH, ...DAMAGE_LIFE, ...COUNTERS, ...TOKENS };
/** The verb words, with their third-person forms, longest first. */
const VERB_FORMS: [RegExp, string][] = Object.keys(HANDLERS).map((v) => [new RegExp(`^(?:${v}|${v}s|${v.replace(/y$/, "ies")}|${v}es)\\b`, "i"), v]);

/** Every verb word a phrase can open with, for splitting -- wider than the handled ones, so a joint
 *  before an unhandled verb ("..., then shuffle") still splits. */
const ANY_VERB = /^(?:(?:it|that creature|those creatures|they) (?:doesn't|don't|can't|gains?|gets?) |(?:up to one )?(?:other |another )?target [a-z]+(?: [a-z]+)? gets?(?= )|(?:you |each player |each opponent |target player |target opponent |that player |its controller |they )?(?:may )?(?:draws?|discards?|mills?|scry|scries|surveils?|search(?:es)?|reveals?|puts?|shuffles?|returns?|exiles?|destroys?|sacrifices?|creates?|gains?|loses?|deals?|taps?|untaps?|adds?|counters?|copies|copy|casts?|plays?|attach(?:es)?|transforms?|investigates?|proliferate|populate|exchanges?|chooses?|look|looks|pays?|gets?|has|have|regenerates?|fights?|goads?|explores?|connives?|amass(?:es)?|manifest|venture|removes? (?=it|them|that)|double (?=the|its|that|target|each)))\b/i;

/** Split a sentence into phrases on ", then ", " and then ", ", and ", " and ", ", " -- only where a
 *  verb follows, so "a creature and a land" stays whole. */
function phrases(sentence: string): string[] {
  const out: string[] = [];
  let rest = sentence;
  for (;;) {
    const re = /,? (?:and |then |and then )?(?=\S)|, /g;
    let cut = -1, len = 0;
    for (let m; (m = re.exec(rest));) {
      const tail = rest.slice(m.index + m[0].length).replace(/^then /, "");
      // ", then " is a joint whatever follows: "create a Robot token, then creatures you control get +1/+0".
      if (m.index > 0 && ((m[0].includes(",") || /\b(?:and|then)\b/.test(m[0])) && ANY_VERB.test(tail) || /^, then $/.test(m[0]))) { cut = m.index; len = m[0].length; break; }
    }
    if (cut < 0) { out.push(rest); return out; }
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut + len).replace(/^then /, "");
  }
}

/** Words after an action that say WHEN or ON WHAT CONDITION, kept as its condition: a delayed action,
 *  a replacement, "draw a card if you control an artifact". */
const WHEN_TAILS = [" during each other player's untap step", " at the beginning of the next turn's upkeep", " at the beginning of the next end step", " at the beginning of the next upkeep", " instead", " at end of combat", " at the beginning of your next upkeep", " at the beginning of the end step", " at the beginning of the next cleanup step", " at the beginning of your next end step", " rather than pay this spell's mana cost"];
/** The trailing condition of a phrase, by index rather than an end-anchored regex (CodeQL
 *  polynomial-redos): one of WHEN_TAILS, or a last " if ..." with no comma after it. */
function whenTail(t: string): { at: number; text: string } | undefined {
  const fixed = WHEN_TAILS.find((w) => t.endsWith(w));
  if (fixed) return { at: t.length - fixed.length, text: fixed.trim() };
  // "attacks each combat if able" is the restriction itself, not a condition on it; so is "cast this
  // spell only if ...".
  if (t.endsWith(" if able") || /^cast this spell only /i.test(t)) return undefined;
  const at = t.lastIndexOf(" if ");
  return at > 0 && !t.includes(",", at) ? { at, text: t.slice(at + 1) } : undefined;
}

/** One phrase: actor, "may", verb, arguments. `carried` is the actor of the sentence's earlier
 *  phrase: "target player draws two cards and loses 2 life" -- the life is theirs too. */
/** The quoted abilities of the clause being read, restored into a phrase as it is read. */
let quotes: string[] = [];
/** The subject of the last pump or grant read in this sentence: "Target creature gets +2/+2 and gains
 *  flying" -- the "gains flying" phrase is the same creature's. */
let lastSubject: string | undefined;

const PT = /^([+-](?:\d+|x))\/([+-](?:\d+|x))$/i;
const DURATION = / until (?:end of turn|your next turn|the end of your next turn|end of combat)$/i;

/** "flying", "flying and haste", "deathtouch, lifelink, and haste", a quoted ability, "protection
 *  from red": one grant per ability, as the store writes them. */
function abilitiesOf(text: string): string[] | null {
  // A quoted ability is one atom: its own commas and "and"s are not this list's.
  const q: string[] = [];
  const held = text.replace(/"[^"]*"/g, (m) => `\uE002${q.push(m) - 1}\uE003`);
  const parts = held.split(/,? and (?!from )|, (?!and )/).map((p) => p.trim().replace(/\uE002(\d+)\uE003/g, (_m, i: string) => q[Number(i)]!)).filter(Boolean);
  return parts.length > 0 && parts.every(isAbility) ? parts : null;
}

const KEYWORDS = [...KEYWORD_ABILITIES].map((k) => k.toLowerCase());
/** A keyword, with its parameter if any ("ward {2}", "protection from red", "toxic 1"), a quoted
 *  ability, or "that ability" (a back-reference derive resolves). */
function isAbility(part: string): boolean {
  const p = part.toLowerCase();
  if (/^"[^"]*"$/.test(part) || /^(?:that|this|those) abilit(?:y|ies)$/.test(p)) return true;
  return KEYWORDS.some((k) => p === k || (p.startsWith(`${k} `) && p.length - k.length <= (k === "protection" ? 70 : 40) && !/\blife\b/.test(p)));
}

/** "<subject> gets +2/+2 [for each ...] [and gains flying] [until end of turn]", "<subject> has
 *  flying", "<subject> gains hexproof": a pump and its grants, the subject the pump's object and
 *  each grant's object the ability (derive reads the grant's recipient off the clause). */
function pumpOrGrant(t: string): ActionReading[] | null {
  // TWO SUBJECTS: "~ gets +2/+1 and creatures you control gain haste until end of turn", "creatures you
  // control get +1/+1 and creatures your opponents control get -1/-1": each side is its own pump.
  for (const m of t.matchAll(/ and (?=[a-z~])/gi)) {
    const right = t.slice(m.index + m[0].length);
    if (!/^(?:~|[a-z]+(?: [a-z]+){0,5}) (?:gets?|gains?|has|have) /i.test(right) || /^(?:gets?|gains?|has|have) /i.test(right)) continue;
    const r = pumpOrGrantOne(right);
    if (!r || r[0]?.object?.ref) continue;
    const l = pumpOrGrantOne(t.slice(0, m.index));
    if (l) return [...l, ...r];
  }
  return pumpOrGrantOne(t);
}

function pumpOrGrantOne(t: string): ActionReading[] | null {
  // "~ and other Knights you control have flying", "it and other creatures you control that share a
  // creature type with it each get +2/+0": the card, and the class, each a reading.
  const pair = /^(~|this creature|it) and ((?:other |another )?[a-z][\w ]{0,60}?) (?:each )?(gets?|gains?|has|have|get) (.+)$/i.exec(t);
  // Not a counted pump: its amount is the store's, which derive's scaling reads whole (Eidolon of
  // Countless Battles' "+1/+1 for each creature you control and +1/+1 for each Aura you control").
  if (pair && objectOf(pair[2]!) && !/ for each /i.test(pair[4]!)) {
    const a = pumpOrGrantOne(`${pair[1]} ${pair[3]!.replace(/^(?:get|have)$/i, (v) => (v.toLowerCase() === "get" ? "gets" : "has"))} ${pair[4]}`);
    const b = pumpOrGrantOne(`${pair[2]} ${pair[3]} ${pair[4]}`);
    if (a && b) return [...a, ...b];
  }
  // "it also gains lifelink", "creatures you control also get +1/+0": "also" says nothing new.
  let body = t.replace(/ until end of turn(?= for each )/i, "").replace(DURATION, "").replace(/ also (?=(?:gets?|gains?|has|have) )/i, " ");
  // "As long as you control a Swamp, ...", "... as long as you control a Swamp", "... if you control
  // a creature with flying": the condition, kept (owner, 2026-10-01).
  let condition: string | undefined;
  const lead = /^(?:during your turn|until end of turn|as long as [^,]+|if [^,]+), /i.exec(body);
  if (lead) { if (!/^until end of turn/i.test(lead[0])) condition = lead[0].slice(0, -2); body = body.slice(lead[0].length); }
  // Not inside a quoted ability: 'it gains "If this permanent would leave the battlefield, ..."'.
  const quoted = body.indexOf('"');
  const trail = (quoted >= 0 ? body.slice(0, quoted) : body).search(/ (?:as long as|for as long as|if(?! able$)) /i);
  if (trail > 0) { condition = [condition, body.slice(trail + 1)].filter(Boolean).join(", "); body = body.slice(0, trail).replace(DURATION, ""); }
  // "you may have target creature get -1/-1": made to, and optional.
  const have = /^you (may )?have (?=.+ (?:get|gain|have|become) )/i.exec(body);
  if (have) body = body.slice(have[0].length);
  let subject: string | undefined, verb: string | undefined, rest = "";
  const m = /^(gets?|gains?|has|have|becomes?|loses?|assigns?|can) /i.exec(body);
  if (m && lastSubject !== undefined) { subject = lastSubject; verb = m[1]!.toLowerCase(); rest = body.slice(m[0].length); }
  // "... becomes a 2/2 artifact creature and gains flying": a predicate with no subject of its own is
  // the earlier object's, a back-reference the stored object names.
  else if (m && /^(?:gains?|has|have) /i.test(body)) { subject = "it"; verb = m[1]!.toLowerCase(); rest = body.slice(m[0].length); }
  else {
    for (const v of body.matchAll(/ (gets?|gains?|has|have|is|are|becomes?|loses?|assigns?|can) /gi)) {
      const who = body.slice(0, v.index).replace(/ each$/i, "");
      if (who.length > 80 || !(who === "you" || objectOf(who) || THEY.test(who) || /^(?:they|they each|he|she|that token|those tokens|those creatures|each of those creatures|both creatures)$/i.test(who))) continue;
      subject = who; verb = v[1]!.toLowerCase(); rest = body.slice(v.index + v[0].length); break;
    }
  }
  if (subject === undefined || verb === undefined) return null;
  const who = /^(?:they|they each|he|she|that token|those tokens|those creatures|each of those creatures|both creatures)$/i.test(subject) || THEY.test(subject)
    ? { object: { control: "any" as const, token: null, ref: "sentence" as const } }
    : objectOf(subject) ?? { object: parse("you")! };
  const isRef = who.object.ref === "sentence";
  const target = { object: who.object, ...(isRef ? {} : { text: subject }) };
  const out: ActionReading[] = [];
  // A PREDICATE LIST: "gets +2/+2, has trample and haste, and is a Samurai in addition to its other
  // types". Every predicate must read, or the phrase is not read.
  for (const pred of `${verb} ${rest}`.split(/,? and (?=(?:gets?|has|have|gains?|is|are|can't|can|doesn't|don't|attacks|becomes?|loses?|must|assigns?) )|, (?=(?:gets?|has|have|gains?|is|are|can't|can|doesn't|don't|attacks|becomes?|loses?|must|assigns?) )/i)) {
    const r = predicateOf(pred.replace(DURATION, "").trim(), who.object, target);
    if (!r) return null;
    out.push(...r);
  }
  lastSubject = subject;
  return withCondition(have?.[1] ? out.map((a) => ({ ...a, optional: true as const })) : out, condition);
}

/** One predicate of a pump or grant: a P/T change, a set base P/T, abilities, a type or a goad. */
function predicateOf(pred: string, object: SubjectFilter, target: { object: SubjectFilter; text?: string }): ActionReading[] | null {
  // "assigns combat damage equal to its toughness rather than its power" (CR 510.1a): the store's
  // modify-pt, the rule its amount.
  // The stored object and amount stand: derive reads this rule as a damage multiplier off them, and a
  // P/T reading would claim a pump the card does not make (Bedrock Tortoise).
  if (/^assigns? combat damage equal to its toughness rather than its power$/i.test(pred)) return [{ verb: "modify-pt", object: REF }];
  // "can attack [this turn] as though it didn't have defender", "can block an additional creature each
  // combat", "can block creatures with shadow as though they didn't have shadow": an ability granted.
  if (/^can (?:attack(?: this turn)? as though (?:it|they) didn't have defender|block (?:an additional (?:creature|\w+ creatures) each combat|creatures with \w+ as though they didn't have \w+))$/i.test(pred)) return [{ verb: "grant-ability", object, text: pred.toLowerCase() }];
  // "has all activated abilities of all creature cards exiled with it": a grant, the whole phrase.
  if (/^(?:has|have|gains?) all (?:activated |triggered |activated and triggered )?abilities of .+$/i.test(pred)) return [{ verb: "grant-ability", object, text: pred.replace(/^(?:has|have|gains?) /i, "") }];
  // "has base power and base toughness each equal to its mana value".
  const baseEq = /^(?:has|have) base power and (?:base )?toughness each equal to (.+)$/i.exec(pred);
  if (baseEq) return [{ verb: "modify-pt", ...target, amount: baseEq[1]! }];
  const get = /^gets? (.+)$/i.exec(pred);
  if (get) {
    const pt = get[1]!.replace(/^an additional /i, "");
    const each = pt.indexOf(" for each ");
    const n = PT.exec(each >= 0 ? pt.slice(0, each) : pt);
    // "+2/-2 or -2/+2": either, the controller's choice.
    const or = /^([+-](?:\d+|x)\/[+-](?:\d+|x)) or ([+-](?:\d+|x)\/[+-](?:\d+|x))$/i.exec(pt);
    if (or) return [{ verb: "modify-pt", ...target, amount: `${or[1]} or ${or[2]}` }];
    return n ? [{ verb: "modify-pt", ...target, amount: `${n[1]}/${n[2]}${each >= 0 ? pt.slice(each) : ""}` }] : null;
  }
  // "has base power and toughness 9/9": the store's modify-pt with the set value as its amount.
  const base = /^(?:has|have) base power and toughness ((?:\d+|x)\/(?:\d+|x))$/i.exec(pred);
  if (base) return [{ verb: "modify-pt", ...target, amount: base[1]! }];
  if (/^is goaded$/i.test(pred)) return [{ verb: "goad", ...target }];
  // "can't block", "can't be blocked this turn", "attacks each combat if able": a restriction.
  // "doesn't untap during its controller's untap step": a restriction, as restrictionOf reads it.
  const doesnt = /^(?:doesn't|don't) (.+)$/i.exec(pred);
  if (doesnt) return [{ verb: "cant", object, text: doesnt[1]! }];
  const cant = /^can't (.+)$/i.exec(pred);
  if (cant) return [{ verb: "cant", object, text: cant[1]! }];
  if (/^attacks each combat if able$/i.test(pred)) return [{ verb: "cant", object, text: "not attack each combat if able" }];
  const mustBlocked = /^must be blocked( this turn)? if able$/i.exec(pred);
  if (mustBlocked) return [{ verb: "cant", object, text: `be unblocked${mustBlocked[1] ?? ""}` }];
  // "becomes a 1/1 Elemental creature with vigilance and haste", "becomes a Dragon": animated or
  // retyped, and the abilities after "with" are grants.
  // "loses all abilities", "loses flying": the store's `cant`.
  const loses = /^loses? (.+)$/i.exec(pred);
  if (loses) {
    if (/^all abilities$/i.test(loses[1]!)) return [{ verb: "cant", object, text: "have abilities" }];
    const lost = abilitiesOf(loses[1]!);
    return lost && lost.map((a) => ({ verb: "cant", object, text: a }));
  }
  const becomes = /^becomes? (?:an? )?((?:\d+\/\d+ )?[\w -]+?)(?: with (.+))?$/i.exec(pred.replace(/ that's still an? (?:land|planeswalker|artifact|enchantment)$/i, ""));
  // "becomes prepared" is a prepare, which derive reads off the clause (Codie): not read here.
  if (becomes && !/^prepared$/i.test(becomes[1]!)) {
    // "with base power and toughness 4/4 [and flying]": the set P/T, as the store's modify-pt.
    const base = becomes[2] ? /^base power and toughness (\d+\/\d+)(?:,? and (.+))?$/i.exec(becomes[2]) : null;
    const withs = base ? (base[2] ? abilitiesOf(base[2]) : []) : becomes[2] ? abilitiesOf(becomes[2]) : [];
    return withs && [{ verb: "animate", ...target }, ...(base ? [{ verb: "modify-pt", ...target, amount: base[1]! }] : []), ...withs.map((a) => ({ verb: "grant-ability", object, text: a }))];
  }
  // "is an Angel in addition to its other types", "is legendary": a type granted (derive's
  // `type-grant` reads "in addition to its other types").
  // "is a 2/2 blue Elemental creature with flying", "is a Swamp": an Aura's host animated or retyped,
  // the store's animate (and a grant per "with" ability). Not "in addition to": that is a type grant.
  // "... with base power and toughness 4/4, flying, and that ability": the set P/T, then grants.
  const basePt = / with base power and toughness (\d+\/\d+)(?:,? (?:and )?(.+))?$/i.exec(pred);
  const animated = /^(?:is|are) an? ((?:\d+\/\d+ )?[\w -]+?)(?: with (.+))?$/i.exec(basePt ? `${pred.slice(0, basePt.index)}${basePt[2] ? ` with ${basePt[2]}` : ""}` : pred);
  if (animated && !/in addition to|\bthe\b/i.test(pred)) {
    const pt = basePt;
    const withs = animated[2] ? abilitiesOf(animated[2]) : [];
    if (withs) return [{ verb: "animate", ...target }, ...(pt ? [{ verb: "modify-pt", ...target, amount: pt[1]! }] : []), ...withs.map((a) => ({ verb: "grant-ability", object, text: a }))];
  }
  const is = /^(?:is|are) ((?:an? )?[\w -]+ in addition to (?:its|their) other (?:creature |colors and )?types|every creature type|legendary|snow|colorless|white|blue|black|red|green)$/i.exec(pred);
  // No text: the stored object stays. Derive finds a grant's recipient by "has"/"gains", never by
  // "is", and a store object that names the recipient is what keeps it (The Flesh Is Weak).
  if (is) return [{ verb: "grant-ability", object }];
  const has = /^(?:has|have|gains?) (.+)$/i.exec(pred);
  if (!has) return null;
  // "gains your choice of flying, vigilance, deathtouch, or haste": one grant per choice.
  const abilities = abilitiesOf(has[1]!.replace(/^your choice of /i, "").replace(/,? or (?=[^,]+$)/, ", "));
  return abilities && abilities.map((a) => ({ verb: "grant-ability", object, text: a }));
}

/** A copy's EXCEPTIONS (CR 707.9b): "it has haste and that ability", "it's a Spirit in addition to its
 *  other types", "it isn't legendary". A grant per ability or type, and "isn't legendary" the store's
 *  `cant` "be legendary". Null when any part is not one of these. */
function exceptOf(text: string, object: SubjectFilter): ActionReading[] | null {
  const out: ActionReading[] = [];
  for (const raw of text.split(/,? and (?=(?:it|its|is|isn't|has|the token|the copy)\b)|, (?=(?:it|its|is|isn't|has|the token|the copy)\b)/i)) {
    const full = raw.trim();
    if (/^(?:(?:it|the token|the copy) (?:isn't|is not)|it's not|isn't) legendary$/i.test(full)) { out.push({ verb: "cant", object, text: "be legendary" }); continue; }
    const has = /^(?:(?:it|the token) )?(?:also )?(?:has|have) (.+)$/i.exec(full);
    if (has) { const a = abilitiesOf(has[1]!); if (!a) return null; out.push(...a.map((x) => ({ verb: "grant-ability", object, text: x }))); continue; }
    // "it's a 0/2 Thopter artifact creature with flying in addition to its other types", "it's legendary".
    const is = /^(?:it's|it is|is) (?:an? )?(?:\d+\/\d+ )?([\w -]+?)(?: with (.+?))? in addition to its other (?:colors and )?types$|^(?:it's|it is|is) (legendary|an artifact|snow|legendary and snow)$/i.exec(full);
    // "it's 1/1", "it's a 4/4 black Zombie": base P/T and characteristics the copy takes instead.
    const pt = /^(?:it's|it is) (\d+\/\d+)$/i.exec(full);
    if (pt) { out.push({ verb: "modify-pt", object, amount: pt[1]! }); continue; }
    const becomes = /^(?:it's|it is) an? (\d+\/\d+ )?[\w -]+?(?: with (.+))?$/i.exec(full);
    if (becomes && !is) {
      const withs = becomes[2] ? abilitiesOf(becomes[2]) : [];
      if (!withs) return null;
      out.push({ verb: "grant-ability", object }, ...(becomes[1] ? [{ verb: "modify-pt", object, amount: becomes[1].trim() }] : []), ...withs.map((x) => ({ verb: "grant-ability", object, text: x })));
      continue;
    }
    if (is) {
      const withs = is[2] ? abilitiesOf(is[2]) : [];
      if (!withs) return null;
      out.push({ verb: "grant-ability", object }, ...withs.map((x) => ({ verb: "grant-ability", object, text: x })));
      continue;
    }
    return null;
  }
  return out;
}

const withCondition = (out: ActionReading[], condition: string | undefined) => (condition ? out.map((a) => ({ ...a, condition })) : out);

/** A trailing duration says how long, not what happens: "you may play that card for as long as you
 *  control ~", "spells with the chosen name cost {1} less to cast this turn". Tried only when the
 *  phrase does not read with it. */
const TRAILING_DURATION = / (?:this turn|for as long as [^,]+|until (?:end of turn|your next turn|the end of your next turn))$/i;

function readPhrase(quoted: string, condition: string | undefined, carried?: ActionReading["actor"]): ActionReading[] | null {
  const r = readPhraseOnce(quoted, condition, carried);
  if (r) return r;
  const phrase = quoted.replace(/\uE000(\d+)\uE001/g, (_m, i: string) => quotes[Number(i)]!).trim();
  const at = phrase.search(TRAILING_DURATION);
  if (at > 0) return readPhraseOnce(phrase.slice(0, at), condition, carried);
  // "you may cast this card from your graveyard as long as you control a Zombie": the condition, kept.
  const cond = phrase.search(/ as long as [^,]+$/i);
  return cond > 0 ? readPhraseOnce(phrase.slice(0, cond), [condition, phrase.slice(cond + 1)].filter(Boolean).join(", "), carried) : null;
}

function readPhraseOnce(quoted: string, condition: string | undefined, carried?: ActionReading["actor"]): ActionReading[] | null {
  const phrase = quoted.replace(/\uE000(\d+)\uE001/g, (_m, i: string) => quotes[Number(i)]!);
  let t = phrase.trim().replace(/^(?:then|instead|also) /i, "");
  // "draw X cards, where X is the number of ...": X is the amount, the rest says what it counts.
  const where = t.indexOf(", where X is ");
  // The store writes the counted thing as the amount ("the greatest number of creatures you control
  // that ..."), which is what derive's scaling reads; a bare "X" reads as an X in the mana cost.
  const counted = where >= 0 ? t.slice(where + ", where X is ".length) : undefined;
  if (where >= 0) t = t.slice(0, where);
  // "each player who controls a creature with power 4 or greater draws a card": that subset.
  const who = /^(each player|each opponent) who [^,]+? (?=(?:draws?|discards?|mills?|scr(?:y|ies)|surveils?|search(?:es)?|reveals?|shuffles?|may)\b)/i.exec(t);
  if (who) { condition = [condition, t.slice(who[1]!.length + 1, who[0].length - 1)].filter(Boolean).join(", "); t = `${who[1]} ${t.slice(who[0].length)}`; }
  // "each player ... each draw": the second "each" repeats the actor.
  t = t.replace(/^((?:two|any number of) target (?:players|opponents)) each /i, "$1 ");
  // "you may pay {G} rather than pay this spell's mana cost": an alternative cost, the store's
  // cost-modify, the whole phrase its text. Read before the tail below strips "rather than pay".
  if (/^you may pay (?:\{[^}]+\})+ rather than pay this spell's mana cost$/i.test(t)) return [{ verb: "cost-modify", object: SELF, text: t, optional: true, ...(condition ? { condition } : {}) }];
  const tail = whenTail(t);
  if (tail) { condition = [condition, tail.text].filter(Boolean).join(", "); t = t.slice(0, tail.at); }
  // A REDIRECTION (CR 615): "All damage that would be dealt to you is dealt to enchanted creature
  // instead", "The next 1 damage that would be dealt to this creature this turn is dealt to target
  // creature you control instead" -- the store's prevent of the first and deal-damage to the second.
  const redirect = /^((?:all|the next (\d+|x)) damage that (?:would be dealt|a source of your choice would deal)\b.*?) is dealt to (.+)$/i.exec(t);
  if (redirect && tail?.text === "instead") {
    const to = objectOf(redirect[3]!);
    if (to) return [{ verb: "prevent", object: { control: "any", token: null }, text: redirect[1]! },
      { verb: "deal-damage", object: to.object, amount: redirect[2]?.toUpperCase() ?? redirect[1]!, text: redirect[3]! }];
  }
  let actor: ActionReading["actor"] = carried;
  let optional = false;
  if (carried === UNKNOWN_ACTOR && !actorOf(t) && !/^you /i.test(t)) return null;
  // "You control enchanted creature" (Control Magic): the store's gain-control of the host.
  const host = /^you control (enchanted (?:creature|permanent|land|artifact|planeswalker))$/i.exec(t);
  if (host) return [{ verb: "gain-control", object: objectOf(host[1]!)!.object, text: host[1]!.toLowerCase(), ...(condition ? { condition } : {}) }];
  // "You may have this creature enter as a copy of any creature on the battlefield" (a clone).
  // "..., except it has haste" (CR 707.9b) and "become a copy of" (until end of turn) read the same.
  const cloneText = t.replace(DURATION, "");
  const haveClone = /^you (may )?have (?:~|this [a-z]+|it|that creature) (?:enter as|become) a copy of (.+)$/i.exec(cloneText);
  // "~ becomes a copy of target creature, except it has this ability": the same, not optional.
  const cloneOf = haveClone?.[2] ?? /^(?:~|this [a-z]+) becomes a copy of (.+)$/i.exec(cloneText)?.[1];
  if (cloneOf !== undefined) {
    const at = cloneOf.search(/, except /);
    const what = (at > 0 ? cloneOf.slice(0, at) : cloneOf).replace(DURATION, "");
    const r = objectOf(what);
    const except = at > 0 ? exceptOf(cloneOf.slice(at + ", except ".length), SELF) : [];
    const opt = haveClone?.[1] ? { optional: true as const } : {};
    if (r && except) return [{ verb: "copy", object: r.object, text: what, ...opt }, ...except.map((a) => ({ ...a, ...opt }))].map((a) => ({ ...a, ...(condition ? { condition } : {}) }));
  }

  // "The next time a black source of your choice would deal damage to you this turn, prevent that
  // damage": a prevention shield, its text the source and the damage.
  const shield = /^(the next time .+? would deal damage(?: to .+?)? this turn), prevent that damage$/i.exec(t);
  if (shield) return [{ verb: "prevent", object: { control: "any", token: null }, text: shield[1]!, ...(condition ? { condition } : {}) }];
  const sa = subjectAction(t);
  // "costs {X} less, where X is the number of Wizards you control": the count is the amount (Kaza).
  if (sa) return sa.map((a) => ({ ...a, ...(counted && a.amount && /X/.test(a.amount) ? { amount: counted } : {}), ...(condition ? { condition } : {}) }));
  const rs = restrictionOf(t);
  // A restriction's "unless" is part of it: "can't attack you unless their controller pays {2}" is a
  // tax, which derive reads off the restriction's own words.
  if (rs) return rs.map((a) => {
    const unless = a.verb === "cant" && condition?.startsWith("unless ") ? condition : undefined;
    const cond = [unless ? undefined : condition, a.condition].filter(Boolean).join(", ");
    return { ...a, ...(unless ? { text: `${a.text} ${unless}` } : {}), ...(cond ? { condition: cond } : {}) };
  });
  const pg = pumpOrGrant(t);
  // "-X/-0, where X is the number of cards in your graveyard": the store keeps the X's definition.
  if (pg) return pg.map((a) => ({ ...a, ...(counted && a.amount && /X/.test(a.amount) ? { amount: `${a.amount}, where X is ${counted}` } : {}), ...(condition || a.condition ? { condition: [condition, a.condition].filter(Boolean).join(", ") } : {}) }));
  // A DAMAGE SOURCE ("~ deals", "this creature deals", "it deals", "enchanted creature deals"): the
  // dealer, which derive reads off the card, not the actor.
  // "you may have it deal 1 damage to any target": the same, optional.
  const haveSource = /^you (may )?have (.{1,60}?) (?=deal )/i.exec(t);
  if (haveSource) { optional = optional || Boolean(haveSource[1]); t = t.slice(haveSource[0].length); actor = undefined; }
  // Whatever stands before "deals" is the dealer: "~", "this creature", "target creature you control",
  // "each Wolf tapped this way", "they each".
  const deals = t.search(/(?:^| )deals? (?=\S)/);
  // Not "would deal": "prevent all damage a source of your choice would deal this turn" has no dealer.
  if (!haveSource && deals > 0 && deals <= 70 && !t.slice(0, deals).includes(",") && !/\b(?:would|can't|could)$/i.test(t.slice(0, deals))) { t = t.slice(deals + 1); actor = undefined; }
  // "that many plus one +1/+1 counters are put on it instead" (Hardened Scales): the improved count.
  const more = /^(that many plus (?:one|two|\d+)|twice that many|three times that many) (.+? counters?) (?:are|is) put on (?:it|that creature|that permanent|them|each of them)$/i.exec(t);
  if (more && countersOf(more[2]!)) return [{ verb: "add-counter", object: REF, counter: countersOf(more[2]!)!.counter, amount: more[1]!.toLowerCase(), ...(condition ? { condition } : {}) }];
  const setLife = SET_LIFE.exec(t);
  if (setLife) return [{ verb: "set-life", amount: setLife[1]!, ...(condition ? { condition } : {}) }];
  const entersWith = entersWithOf(t);
  const ew = entersWith ? counterList(entersWith[0].replace(/,? or (?=(?:a|an) [^,]*counter)/g, " and ")) : null;
  if (ew) {
    // The card itself, or a class ("each other Beast creature you control"), which the recipient names.
    const who = entersWith![2] !== undefined ? objectOf(entersWith![2])! : { object: SELF };
    const on = { object: who.object, ...(entersWith![2] !== undefined && !who.object.self && !who.object.ref ? { text: entersWith![2] } : {}) };
    const counters: ActionReading[] = [
      ...ew.map((c) => ({ verb: "add-counter", ...on, counter: c.counter, amount: entersWith![4] ?? (entersWith![1] ? `${c.amount ?? "1"} for each ${entersWith![1]}` : c.amount ?? "1"), ...(condition ? { condition } : {}) })),
      ...entersWith![3].map((a) => ({ verb: "grant-ability", object: who.object, text: a, ...(condition ? { condition } : {}) })),
    ];
    // "This land enters tapped with two charge counters on it": the tap first, as the store writes it.
    return /^\S.*? enters(?: the battlefield)? tapped with /i.test(t) ? [{ verb: "tap", object: SELF, ...(condition ? { condition } : {}) }, ...counters] : counters;
  }
  // "you get {E}{E}": energy counters on you (CR 107.14).
  const energy = /^(?:you )?gets? ((?:\{E\})+)(?: \.)?$/i.exec(t);
  if (energy) return [{ verb: "add-counter", object: parse("you")!, counter: "energy", amount: String(energy[1]!.length / 3), ...(condition ? { condition } : {}) }];
  // "you may have target player discard a card": the actor is who is made to.
  const have = /^you (may )?have (.+)$/i.exec(t);
  const made = have && ACTORS.find(([w]) => have[2]!.toLowerCase().startsWith(w + " "));
  if (have && made) {
    optional = Boolean(have[1]);
    t = have[2]!;
  }
  // "target artifact creature's controller sacrifices it": a target's controller.
  const owner = /^(target [a-z -]{1,40}?'s (?:controller|owner)|the controller of target [a-z -]{1,40}?) (?=sacrifices|discards|draws|loses|gains|returns|puts|creates|mills|exiles|shuffles)/i.exec(t);
  if (owner && !actor) { actor = { control: "any", scope: "that", text: owner[1]! }; t = t.slice(owner[0].length); }
  else for (const [word, who] of ACTORS) {
    if (t.toLowerCase().startsWith(word + " ")) { actor = { ...who!, text: t.slice(0, word.length) }; t = t.slice(word.length + 1); break; }
  }
  if (/^may /i.test(t)) { optional = true; t = t.slice(4); }
  for (const [re, base] of VERB_FORMS) {
    const m = re.exec(t);
    if (!m) continue;
    let [verb, handler] = HANDLERS[base]!;
    const rest = t.slice(m[0].length).trim();
    let args = handler(rest);
    // "put" is a counter's verb first ("put a +1/+1 counter on ..."), else a zone move.
    if (!args && base === "put") { [verb, handler] = ZONE.put!; args = handler(rest); }
    // "gain control of target creature [until end of turn]": not life.
    if (!args && base === "gain" && /^control of /i.test(rest)) { verb = "gain-control"; args = thing(rest.slice("control of ".length).replace(DURATION, "").replace(/ for as long as [^,]+$/i, "")); }
    if (!args) return null;
    // "destroy up to one target artifact": a zone move of up to N may move none (the store's optional).
    if ((ZONE[base] || base === "tap" || base === "untap") && /^(?:up to |any number of )/i.test(rest)) optional = true;
    const all: Args[] = [args].flat().map((a) => (counted && a.amount !== undefined && /\bX\b/.test(a.amount) ? { ...a, amount: counted } : a))
      // "an X/X ... token, where X is the number of land cards in your graveyard": the X is in the
      // TEXT, so its definition stays with it (Formless Genesis's scaling reads it there).
      .map((a) => (counted && a.text !== undefined && /\bX\b/.test(a.text) ? { ...a, text: `${a.text}, where X is ${counted}` } : a));
    // A BACK-REFERENCE ("itself", "that player") keeps the stored object: derive resolves it, so it
    // gets no printed text to overwrite that with.
    const isRef = (a: Args) => a.object?.ref === "sentence";
    // A life change's object is the player it happens to, as the store writes it ("you gain 3 life":
    // object "you").
    if (verb === "gain-life" || verb === "lose-life") {
      // An actor with no text ("you and that player each lose 1 life") keeps the stored object.
      const who = actor ? actor.text : "you";
      return all.map((a) => ({ verb, ...a, ...(who !== undefined ? { object: parse(who) ?? { control: "any" as const, token: null, ref: "sentence" as const }, text: who } : {}),
        ...(optional ? { optional: true as const } : {}), ...(actor ? { actor } : {}), ...(condition ? { condition } : {}) }));
    }
    return all.map((a) => ({ verb, ...(isRef(a) ? (({ text: _t, ...rest }: Args) => rest)(a) : a), ...(a.object && !isRef(a) && a.text === undefined && /\S/.test(rest) && !/^(?:\d+|x)$/i.test(rest) ? { text: objectPhrase(verb, rest) } : {}), ...(optional ? { optional: true as const } : {}), ...(actor ? { actor } : {}), ...(condition ? { condition } : {}) }));
  }
  return null;
}

/** The printed object phrase of a reading: the words after the verb, without the zone the search
 *  names and the manner ("at random") -- what derive's string path reads as the object. */
function objectPhrase(verb: string, rest: string): string {
  if (verb === "search") return rest.replace(/^.*? for /, "");
  return rest.replace(/ at random$/, "");
}

/** A phrase opened by a subject this grammar cannot name ("each of its controller's opponents draws a
 *  card and gains 2 life"): the phrases after it are that subject's too, so none of them is read. */
const UNKNOWN_ACTOR: NonNullable<ActionReading["actor"]> = { control: "any" };
/** A PLAYER named by a phrase this grammar does not know, doing something: "each of its controller's
 *  opponents draws", "the player with the most life loses". Only these carry; "~ gets +1/+1 and you
 *  draw a card" and "exile it, then draw" do not. */
function playerSubject(phrase: string): boolean {
  const at = phrase.search(/ (?:draws|gains|loses|discards|mills|sacrifices|searches|reveals|creates|scries|surveils)\b/i);
  const subject = at > 0 && at <= 100 ? phrase.slice(0, at) : "";
  return subject !== "" && !subject.includes(",") && /\b(?:players?|opponents?|controller|owner)\b/i.test(subject);
}

/** The actor a phrase opens with, if any. */
function actorOf(phrase: string): ActionReading["actor"] | undefined {
  const t = phrase.trim().replace(/^(?:then|instead|also) /i, "").toLowerCase();
  const hit = ACTORS.find(([w]) => t.startsWith(w + " "));
  return hit ? { ...hit[1]!, text: phrase.trim().replace(/^(?:then|instead|also) /i, "").slice(0, hit[0].length) } : undefined;
}

/** A sentence's opener: "If you do, ...", "If ..., ...", "Otherwise, ...". */
const OPENER = /^(if you do|if you don't|if [^,]+|otherwise|then|as an additional cost to cast this spell|as long as [^,]+|during [^,]+|starting with you|whenever [^,]+|each time [^,]+), /i;

/** The actions a clause's printed text states that this grammar reads completely, in printed order:
 *  the cost's first (as the store writes them), then the effect's. */
/** Collects the phrases `parseActions` could not read, while `unreadPhrases` runs it. */
let unread: string[] | null = null;

/** DIAGNOSTIC (instruments only): the action phrases of a clause the grammar did not read, as
 *  printed -- what `packages/instruments/src/action-blockers.ts` clusters to rank the next work. */
export function unreadPhrases(effect: string, type: string | null, cost?: string): string[] {
  unread = [];
  try { parseActions(effect, type, cost); return unread; } finally { unread = null; }
}

export function parseActions(effect: string, _type: string | null, cost?: string): ActionReading[] {
  const out: ActionReading[] = [];
  // A mode's or a result's label is not text the action reads: a Spree mode's added cost ("+ {2} —"),
  // a d20 table row ("10—19 |"), a loyalty cost the segmenter left in ("[−9]").
  // An ability word ("Crescent Fang —", "Date Night —") names the ability and does nothing.
  const dash = effect.indexOf(" — ");
  if (dash > 0 && dash <= 41 && /^[A-Z][\w' ,-]*$/.test(effect.slice(0, dash))) effect = effect.slice(dash + 3);
  effect = effect.replace(/^\+ (?:\{[^}]+\})+ — /, "").replace(/^(?:\{[^}]+\})+ — /, "").replace(/^\d+(?:[-—–]\d+|\+)? \| /, "").replace(/^\[[+−-]?(?:\d+|X)\]:? /, "");
  // A cost the segmenter left in the text ("{T}, Pay {E}{E}{E}: Draw a card.") is still a cost.
  // By index, not a regex over the whole text (CodeQL polynomial-redos).
  const colon = cost === undefined ? effect.indexOf(": ") : -1;
  const prefix = colon > 0 ? effect.slice(0, colon) : "";
  if (prefix !== "" && !/[."]/.test(prefix) && /^[A-Z]/.test(effect.slice(colon + 2))
    && (prefix.startsWith("{") || /^(?:Pay|Sacrifice|Discard|Exile|Tap|Remove|Return|Put)\b/.test(prefix))) {
    cost = prefix; effect = effect.slice(colon + 2);
  }
  // Split where a new cost item starts, so "Sacrifice an artifact, creature, or land" stays one.
  // ...and on "and" before a cost verb: "Remove three quest counters from this enchantment and sacrifice it".
  for (const part of cost ? cost.split(/, (?=\{|[A-Z]|[−+]?\d)| and (?=(?:sacrifice|exile|discard|pay|remove|tap|untap|return|put) )/) : []) {
    const r = readPhrase(part.replace(/^([A-Z])/, (c) => c.toLowerCase()), undefined);
    if (r) out.push(...r);
    // A mana or tap cost does nothing a stored action records: not an unread phrase.
    else if (!/^(?:\{[^}]+\})+$/.test(part.trim())) unread?.push(part);
  }
  // Quoted ability text belongs to what is granted, not to this clause's own actions.
  // A QUOTED ability is one atom: never split, never read as this clause's own actions, and kept in
  // the object it belongs to ('create a 1/1 Spawn token with "Sacrifice this token: Add {C}."').
  quotes = [];
  // A quoted ability ending in a period ends its sentence too: 'with "This token can't be blocked."
  // Activate only as a sorcery' is two sentences, the second not the token's.
  const unquoted = effect.replace(/"[^"]*"/g, (q) => `\uE000${quotes.push(q) - 1}\uE001`)
    .replace(/\uE000(\d+)\uE001 (?=[A-Z])/g, (m, i: string) => (quotes[Number(i)]!.endsWith('."') ? `${m.trimEnd()}. ` : m));
  let mayBefore = false;
  for (const raw of unquoted.split(/(?<=\.)\s+/)) {
    let s = raw.trim().replace(/\.$/, "");
    if (s === "") continue;
    // "You may pay {2}. If you do, draw a card": the draw is as optional as the payment (the store's
    // reading, and the rules': nothing happens unless you choose to pay).
    const ifYouDoAfterMay = mayBefore && /^if you do, /i.test(s);
    mayBefore = /\byou may\b/i.test(s);
    let condition: string | undefined;
    // "Until end of turn, target creature becomes ...": a duration at the front, not a condition.
    s = s.replace(/^(?:until end of turn|until your next turn|until the end of your next turn|this turn|for as long as [^,]+), /i, "");
    // Openers stack: "As long as ~ is equipped, if a triggered ability ... triggers, ...".
    for (let open = OPENER.exec(s), k = 0; open && k < 2; open = OPENER.exec(s), k++) {
      if (!/^then$/i.test(open[1]!)) condition = [condition, open[1]!.toLowerCase()].filter(Boolean).join(", ");
      s = s.slice(open[0].length);
    }
    s = s.replace(/^([A-Z])/, (c) => c.toLowerCase());
    // "The same is true for first strike, double strike, ...": the grant before it, once per ability.
    const same = /^(?:the same is true for|do the same for|repeat this process for) (.+)$/i.exec(s);
    const last = out[out.length - 1];
    if (same && (last?.verb === "grant-ability" || last?.verb === "add-counter")) {
      const more = abilitiesOf(same[1]!);
      if (more) { out.push(...more.map((a) => (last.verb === "grant-ability" ? { ...last, text: a } : { ...last, counter: a.toLowerCase() }))); continue; }
    }
    // A KEYWORD LINE ("Flying, vigilance, haste", "Vigilance; horsemanship", a level's "8+ | Flying"):
    // the card's own abilities, one grant each.
    const line = out.length === 0 && unquoted.split(/(?<=\.)\s+/).length === 1 ? abilitiesOf(s.replace(/; /g, ", ")) : null;
    if (line && line.every((a) => !/^(?:that|this|those) abilit/i.test(a))) { out.push(...line.map((a) => ({ verb: "grant-ability", object: SELF, text: a }))); continue; }
    // "you and target opponent each draw three cards": one action per player.
    const both = /^you and (another target player|target opponent|target player|that player|those players|each opponent|each other player|defending player|the attacking player|the controller of [^,]{1,40}) each (.+)$/i.exec(s);
    if (both) {
      // One action per player and phrase -- the store writes either one or two -- and no actor text,
      // so each keeps its stored object: neither "you" nor the other player alone is right for a
      // store that wrote the pair as one action.
      const pair: NonNullable<ActionReading["actor"]> = { control: "any", scope: "each" };
      for (let k = 0; k < 2; k++) for (const p of phrases(both[2]!)) { const r = readPhrase(p, condition, pair); if (r) out.push(...r); }
      continue;
    }
    // "You and <someone this grammar cannot name> ...": the actions are both players', so none is read
    // as yours alone.
    if (/^you and /i.test(s)) continue;
    let carried: ActionReading["actor"];
    lastSubject = undefined;
    const at = out.length;
    for (const p of phrases(s)) {
      // "sacrifice this creature unless you discard a card": the payment is an action too.
      const [main, payment] = p.split(/ unless /);
      // The payment is the player's choice: optional, as the store writes it. An "unless" that is no
      // payment ("enters tapped unless you control two or fewer other lands") is the main's condition.
      const pay = payment ? readPhrase(payment, "unless")?.map((a) => ({ ...a, optional: true as const })) ?? null : null;
      const mainCondition = payment && !pay ? [condition, `unless ${payment}`].filter(Boolean).join(", ") : condition;
      // "discard a card or pay {2}", "sacrifice a creature or discard a card": either is an action.
      for (const alt of main!.split(/ or (?=(?:pay|sacrifice|discard|draw|mill|exile|lose|reveal|search)\b)/)) {
        const r = readPhrase(alt, mainCondition, carried);
        if (r) out.push(...r);
        else unread?.push(alt.replace(/\uE000(\d+)\uE001/g, (_m, i: string) => quotes[Number(i)]!).trim());
        // The actor carries even past a phrase this grammar does not read yet: "target opponent
        // sacrifices a creature, discards a card, and loses 3 life" -- all three are theirs.
        carried = r?.[0]?.actor ?? actorOf(alt) ?? (r === null && playerSubject(alt.trim()) ? UNKNOWN_ACTOR : carried);
      }
      if (pay) out.push(...pay);
    }
    if (ifYouDoAfterMay) for (let i = at; i < out.length; i++) out[i] = { ...out[i]!, optional: true };
  }
  return out;
}

/** Index pairs [stored, read]: how a clause's stored actions line up with what the grammar read, by
 *  verb, the k-th of a verb with the k-th. */
export function alignVerbs(stored: string[], read: string[]): [number, number][] {
  // The k-th stored action of a verb pairs with the k-th reading of that verb, wherever each sits: the
  // store and the text may list a pair in either order ("each opponent loses 2 life and you gain 2
  // life" is stored gain, lose), and an order-keeping alignment then reads only one of the two.
  const seen = new Map<string, number[]>();
  read.forEach((v, j) => seen.set(v, [...(seen.get(v) ?? []), j]));
  const out: [number, number][] = [];
  stored.forEach((v, i) => { const j = seen.get(v)?.shift(); if (j !== undefined) out.push([i, j]); });
  return out;
}
