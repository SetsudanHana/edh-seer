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
] as [string, ActionReading["actor"]][]).sort((a, b) => b[0].length - a[0].length);

/** A verb phrase's handler: its arguments read into a reading, or null. Keyed by the verb's base
 *  word; a third-person form ("draws", "searches") reads the same. */
type Args = Omit<ActionReading, "verb" | "optional" | "actor" | "condition">;
type Handler = (rest: string) => Args | Args[] | null;

const CARD = parse("a card")!;
const SELF: SubjectFilter = { control: "you", token: null, self: true };

/** A COUNT before a noun phrase, as the store spells the amount: "two cards" 2, "up to two cards" 2, "any number of cards", "X cards", "that many cards", "an additional card" 1. */
const COUNT = /^(?:(up to )?(a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|twenty|x|\d+)|(any number of|that many|all the|all|half)) (?:additional )?/i;

/** The object of an action: a counted class ("two basic land cards"), the card itself ("this card"),
 *  or a back-reference ("it", "that card", "those cards"), which task 4's resolver owns. */
function objectOf(phrase: string): { amount?: string; object: SubjectFilter } | null {
  const t = phrase.trim();
  if (/^(?:this [a-z]+|~|this|him|her)$/i.test(t)) return { object: SELF };
  // An Aura's or Equipment's host: its class, as the trigger grammar reads it (the text keeps the rest).
  const host = /^(?:enchanted|equipped) (creature|permanent|land|artifact|planeswalker)$/i.exec(t);
  if (host) return { object: parse(`a ${host[1]!.toLowerCase()}`)! };
  if (/^(?:it|them|that card|those cards|the revealed card|that spell|that player|that creature|that permanent|itself|that source|those creatures|those players|its controller|its owner|each of them|the chosen player|the player or planeswalker (?:it's|that creature is) attacking|(?:that|the) [a-z]+'s controller|that player or planeswalker|that permanent or player|that creature and that player)$/i.test(t)) return { object: { control: "any", token: null, ref: "sentence" } };
  const m = COUNT.exec(t);
  // "up to two" is the store's "2", the convention derive's scaling reads ("up to X ... where X is").
  const amount = m ? (m[2] ? amountOf(m[2]) : m[3]!.toLowerCase().replace(/^all the$/, "all")) : undefined;
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
  if (/^(?:that much|twice that much|that many|half that much|half their life|half your life|that much plus (?:one|two|\d+))$/i.test(w)) return w.toLowerCase();
  return null;
}

/** "gain 3 life", "gain life equal to its toughness", "gain 2 life for each creature you control". */
function lifeOf(rest: string): Args | null {
  // The store writes the counted thing alone ("its power", not "equal to its power").
  const eq = /^life equal to (.+)$/.exec(rest);
  if (eq) return { amount: eq[1]! };
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
  pay: ["lose-life", (rest) => (/ life$/.test(rest) ? lifeOf(rest) : null)],
  deal: ["deal-damage", (rest) => {
    // "2 damage to any target and 3 damage to you": one action per recipient, as the store writes it.
    const parts = rest.split(/,? and (?=(?:\w+|half X|that much) damage\b)|, (?=(?:\w+|half X) damage\b)/);
    const out: Args[] = [];
    for (const part of parts) {
      const one = damageOf(part);
      if (!one) return null;
      out.push(one);
    }
    return out;
  }],
};

/** "3 damage to any target", "damage equal to its power to target creature", "damage to target
 *  creature equal to the number of lands you control", "2 damage divided as you choose among one or
 *  two targets". The store writes the counted thing alone ("its power"). */
function damageOf(rest: string): Args | null {
  let m = /^damage equal to (.+?) to (.+)$/.exec(rest) ?? /^damage equal to (.+?) divided as you choose among (.+)$/.exec(rest);
  if (m) { const r = objectOf(m[2]!); return r && { object: r.object, amount: m[1]!, text: m[2] }; }
  m = /^damage to (.+?) equal to (.+)$/.exec(rest);
  if (m) { const r = objectOf(m[1]!); return r && { object: r.object, amount: m[2]!, text: m[1] }; }
  m = /^(.+?) damage(?:, rounded (?:up|down),)? (?:to|divided as you choose among) (.+)$/.exec(rest);
  const amount = m ? lifeAmount(m[1]!.replace(/ (?:combat|noncombat)$/, "")) ?? (/^half X$/.test(m[1]!) ? "half X" : null) : null;
  // "divided as you choose among one, two, or three targets": any targets, however many.
  const r = m && amount ? objectOf(m[2]!) ?? (/^(?:one|one or two|one, two, or three|any number of|up to \w+) (?:other )?targets$/.test(m[2]!) ? { object: ANY_TARGET } : null) : null;
  return r && amount ? { object: r.object, amount, text: m![2] } : null;
}
const ANY_TARGET = parse("any target")!;

/** "two +1/+1 counters", "a stun counter", "X charge counters": the count and the kind. */
function countersOf(phrase: string): { amount?: string; counter: string } | null {
  const m = /^(?:(a|an|one|two|three|four|five|six|seven|eight|nine|ten|x|\d+|that many|an additional|any number of|up to (?:one|two|three|x|\d+)) )?(.+? counters?)$/i.exec(phrase.trim());
  const counter = m ? counterKindOf(m[2]!) : undefined;
  if (!counter) return null;
  const word = m![1]?.toLowerCase().replace(/^up to /, "");
  const amount = word ? (word === "an additional" ? "1" : amountOf(word) ?? word) : undefined;
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
    const m = /^(.+? counters?) on (.+?)(?: for each (.+))?$/.exec(rest);
    const cs = m ? counterList(m[1]!) : null;
    const on = m ? objectOf(m[2]!.replace(/^each of /, "")) : null;
    if (!cs || !on) return null;
    return cs.map((c) => ({ object: on.object, counter: c.counter, amount: m![3] ? `${c.amount ?? "1"} for each ${m![3]}` : c.amount ?? "1", text: m![2] }));
  }],
  remove: ["remove-counter", (rest) => {
    const m = /^(all|.+? counters?) from (.+)$/.exec(rest);
    const c = m ? (/^all .+ counters$/.test(m[1]!) ? { amount: "all", counter: counterKindOf(m[1]!.slice(4)) } : countersOf(m[1]!)) : null;
    const on = m ? objectOf(m[2]!) : null;
    if (!c?.counter || !on) return null;
    return { object: on.object, counter: c.counter, amount: c.amount ?? "1", text: m![2] };
  }],
  proliferate: ["proliferate", (rest) => (rest === "" ? {} : null)],
};

/** "<it> enters with two +1/+1 counters on it": counters the permanent itself arrives with. */
const ENTERS_WITH = /^(?:~|this [a-z]+|it|that creature|that permanent|each creature) (?:enters(?: the battlefield)?(?: tapped)?|escapes) with /i;
/** [counters phrase, "for each" tail] of an "enters with ... on it" phrase, cut by index (CodeQL
 *  polynomial-redos), or null. */
function entersWithOf(t: string): [string, string | undefined] | null {
  const head = ENTERS_WITH.exec(t);
  if (!head) return null;
  const rest = t.slice(head[0].length);
  for (const on of [" on it", " on them"]) {
    const at = rest.indexOf(on);
    if (at < 0) continue;
    const after = rest.slice(at + on.length);
    if (after === "") return [rest.slice(0, at), undefined];
    if (after.startsWith(" for each ")) return [rest.slice(0, at), after.slice(" for each ".length)];
  }
  return null;
}

/** "your life total becomes 10". */
const SET_LIFE = /^(?:your|their|each player's) life total becomes (.+)$/i;

const HANDLERS: Record<string, [string, Handler]> = { ...DRAW_SEARCH, ...DAMAGE_LIFE, ...COUNTERS };
/** The verb words, with their third-person forms, longest first. */
const VERB_FORMS: [RegExp, string][] = Object.keys(HANDLERS).map((v) => [new RegExp(`^(?:${v}|${v}s|${v.replace(/y$/, "ies")}|${v}es)\\b`, "i"), v]);

/** Every verb word a phrase can open with, for splitting -- wider than the handled ones, so a joint
 *  before an unhandled verb ("..., then shuffle") still splits. */
const ANY_VERB = /^(?:you |each player |each opponent |target player |target opponent |that player |its controller |they )?(?:may )?(?:draws?|discards?|mills?|scry|scries|surveils?|search(?:es)?|reveals?|puts?|shuffles?|returns?|exiles?|destroys?|sacrifices?|creates?|gains?|loses?|deals?|taps?|untaps?|adds?|counters?|copies|copy|casts?|plays?|attach(?:es)?|transforms?|investigates?|proliferate|populate|exchanges?|chooses?|look|looks|pays?|gets?|has|have|regenerates?|fights?|goads?|explores?|connives?|amass(?:es)?|manifest|venture)\b/i;

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
      if (m.index > 0 && (m[0].includes(",") || /\b(?:and|then)\b/.test(m[0])) && ANY_VERB.test(tail)) { cut = m.index; len = m[0].length; break; }
    }
    if (cut < 0) { out.push(rest); return out; }
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut + len).replace(/^then /, "");
  }
}

/** Words after an action that say WHEN or ON WHAT CONDITION, kept as its condition: a delayed action,
 *  a replacement, "draw a card if you control an artifact". */
const WHEN_TAILS = [" at the beginning of the next turn's upkeep", " at the beginning of the next end step", " at the beginning of the next upkeep", " instead"];
/** The trailing condition of a phrase, by index rather than an end-anchored regex (CodeQL
 *  polynomial-redos): one of WHEN_TAILS, or a last " if ..." with no comma after it. */
function whenTail(t: string): { at: number; text: string } | undefined {
  const fixed = WHEN_TAILS.find((w) => t.endsWith(w));
  if (fixed) return { at: t.length - fixed.length, text: fixed.trim() };
  const at = t.lastIndexOf(" if ");
  return at > 0 && !t.includes(",", at) ? { at, text: t.slice(at + 1) } : undefined;
}

/** One phrase: actor, "may", verb, arguments. `carried` is the actor of the sentence's earlier
 *  phrase: "target player draws two cards and loses 2 life" -- the life is theirs too. */
function readPhrase(phrase: string, condition: string | undefined, carried?: ActionReading["actor"]): ActionReading[] | null {
  let t = phrase.trim().replace(/^(?:then|instead|also) /i, "");
  // "draw X cards, where X is the number of ...": X is the amount, the rest says what it counts.
  const where = t.indexOf(", where X is ");
  // The store writes the counted thing as the amount ("the greatest number of creatures you control
  // that ..."), which is what derive's scaling reads; a bare "X" reads as an X in the mana cost.
  const counted = where >= 0 ? t.slice(where + ", where X is ".length) : undefined;
  if (where >= 0) t = t.slice(0, where);
  // "each player who controls a creature with power 4 or greater draws a card": that subset.
  const who = /^(each player|each opponent) who [^,]+? (?=(?:draws?|discards?|mills?|scr(?:y|ies)|surveils?|search(?:es)?|reveals?|may)\b)/i.exec(t);
  if (who) { condition = [condition, t.slice(who[1]!.length + 1, who[0].length - 1)].filter(Boolean).join(", "); t = `${who[1]} ${t.slice(who[0].length)}`; }
  // "each player ... each draw": the second "each" repeats the actor.
  t = t.replace(/^((?:two|any number of) target (?:players|opponents)) each /i, "$1 ");
  const tail = whenTail(t);
  if (tail) { condition = [condition, tail.text].filter(Boolean).join(", "); t = t.slice(0, tail.at); }
  let actor: ActionReading["actor"] = carried;
  let optional = false;
  if (carried === UNKNOWN_ACTOR && !actorOf(t) && !/^you /i.test(t)) return null;
  // A DAMAGE SOURCE ("~ deals", "this creature deals", "it deals", "enchanted creature deals"): the
  // dealer, which derive reads off the card, not the actor.
  // "you may have it deal 1 damage to any target": the same, optional.
  const haveSource = /^you (may )?have (.{1,60}?) (?=deal )/i.exec(t);
  if (haveSource) { optional = optional || Boolean(haveSource[1]); t = t.slice(haveSource[0].length); actor = undefined; }
  // Whatever stands before "deals" is the dealer: "~", "this creature", "target creature you control",
  // "each Wolf tapped this way", "they each".
  const deals = t.search(/(?:^| )deals? (?=\S)/);
  if (!haveSource && deals > 0 && deals <= 70 && !t.slice(0, deals).includes(",")) { t = t.slice(deals + 1); actor = undefined; }
  const setLife = SET_LIFE.exec(t);
  if (setLife) return [{ verb: "set-life", amount: setLife[1]!, ...(condition ? { condition } : {}) }];
  const entersWith = entersWithOf(t);
  const ew = entersWith ? counterList(entersWith[0]) : null;
  if (ew) return ew.map((c) => ({ verb: "add-counter", object: SELF, counter: c.counter, amount: entersWith![1] ? `${c.amount ?? "1"} for each ${entersWith![1]}` : c.amount ?? "1", ...(condition ? { condition } : {}) }));
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
  for (const [word, who] of ACTORS) {
    if (t.toLowerCase().startsWith(word + " ")) { actor = { ...who!, text: t.slice(0, word.length) }; t = t.slice(word.length + 1); break; }
  }
  if (/^may /i.test(t)) { optional = true; t = t.slice(4); }
  for (const [re, base] of VERB_FORMS) {
    const m = re.exec(t);
    if (!m) continue;
    const [verb, handler] = HANDLERS[base]!;
    const rest = t.slice(m[0].length).trim();
    const args = handler(rest);
    if (!args) return null;
    const all: Args[] = [args].flat().map((a) => (counted && a.amount !== undefined && /\bX\b/.test(a.amount) ? { ...a, amount: counted } : a));
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
const OPENER = /^(if you do|if you don't|if [^,]+|otherwise|then|as an additional cost to cast this spell), /i;

/** The actions a clause's printed text states that this grammar reads completely, in printed order:
 *  the cost's first (as the store writes them), then the effect's. */
export function parseActions(effect: string, _type: string | null, cost?: string): ActionReading[] {
  const out: ActionReading[] = [];
  // A mode's or a result's label is not text the action reads: a Spree mode's added cost ("+ {2} —"),
  // a d20 table row ("10—19 |"), a loyalty cost the segmenter left in ("[−9]").
  // An ability word ("Crescent Fang —", "Date Night —") names the ability and does nothing.
  const dash = effect.indexOf(" — ");
  if (dash > 0 && dash <= 41 && /^[A-Z][\w' ,-]*$/.test(effect.slice(0, dash))) effect = effect.slice(dash + 3);
  effect = effect.replace(/^\+ (?:\{[^}]+\})+ — /, "").replace(/^\d+(?:[-—–]\d+|\+)? \| /, "").replace(/^\[[+−-]?(?:\d+|X)\]:? /, "");
  // A cost the segmenter left in the text ("{T}, Pay {E}{E}{E}: Draw a card.") is still a cost.
  // By index, not a regex over the whole text (CodeQL polynomial-redos).
  const colon = cost === undefined ? effect.indexOf(": ") : -1;
  const prefix = colon > 0 ? effect.slice(0, colon) : "";
  if (prefix !== "" && !/[."]/.test(prefix) && /^[A-Z]/.test(effect.slice(colon + 2))
    && (prefix.startsWith("{") || /^(?:Pay|Sacrifice|Discard|Exile|Tap|Remove|Return)\b/.test(prefix))) {
    cost = prefix; effect = effect.slice(colon + 2);
  }
  for (const part of cost ? cost.split(/, /) : []) {
    const r = readPhrase(part.replace(/^([A-Z])/, (c) => c.toLowerCase()), undefined);
    if (r) out.push(...r);
  }
  // Quoted ability text belongs to what is granted, not to this clause's own actions.
  const unquoted = effect.replace(/"[^"]*"/g, "\u0000");
  let mayBefore = false;
  for (const raw of unquoted.split(/(?<=\.)\s+/)) {
    let s = raw.trim().replace(/\.$/, "");
    if (s === "" || s.includes("\u0000")) continue;
    // "You may pay {2}. If you do, draw a card": the draw is as optional as the payment (the store's
    // reading, and the rules': nothing happens unless you choose to pay).
    const ifYouDoAfterMay = mayBefore && /^if you do, /i.test(s);
    mayBefore = /\byou may\b/i.test(s);
    let condition: string | undefined;
    const open = OPENER.exec(s);
    if (open && !/^then$/i.test(open[1]!)) { condition = open[1]!.toLowerCase(); s = s.slice(open[0].length); }
    else if (open) s = s.slice(open[0].length);
    s = s.replace(/^([A-Z])/, (c) => c.toLowerCase());
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
    const at = out.length;
    for (const p of phrases(s)) {
      // "sacrifice this creature unless you discard a card": the payment is an action too.
      const [main, payment] = p.split(/ unless /);
      // "discard a card or pay {2}", "sacrifice a creature or discard a card": either is an action.
      for (const alt of main!.split(/ or (?=(?:pay|sacrifice|discard|draw|mill|exile|lose|reveal|search)\b)/)) {
        const r = readPhrase(alt, condition, carried);
        if (r) out.push(...r);
        // The actor carries even past a phrase this grammar does not read yet: "target opponent
        // sacrifices a creature, discards a card, and loses 3 life" -- all three are theirs.
        carried = r?.[0]?.actor ?? actorOf(alt) ?? (r === null && playerSubject(alt.trim()) ? UNKNOWN_ACTOR : carried);
      }
      const pay = payment ? readPhrase(payment, "unless") : null;
      if (pay) out.push(...pay);
    }
    if (ifYouDoAfterMay) for (let i = at; i < out.length; i++) out[i] = { ...out[i]!, optional: true };
  }
  return out;
}

/** Index pairs [stored, read] of a longest common subsequence of two verb sequences: how a clause's
 *  stored actions line up with what the grammar read, by verb and in order. */
export function alignVerbs(stored: string[], read: string[]): [number, number][] {
  const n = stored.length, m = read.length;
  const L = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    L[i]![j] = stored[i] === read[j] ? L[i + 1]![j + 1]! + 1 : Math.max(L[i + 1]![j]!, L[i]![j + 1]!);
  }
  const out: [number, number][] = [];
  for (let i = 0, j = 0; i < n && j < m;) {
    if (stored[i] === read[j]) { out.push([i, j]); i++; j++; } else if (L[i + 1]![j]! >= L[i]![j + 1]!) i++; else j++;
  }
  return out;
}
