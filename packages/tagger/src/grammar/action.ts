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
type Args = Omit<ActionReading, "verb" | "optional" | "actor" | "condition"> & { verb?: string };
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

/** "a Treasure token", "two 1/1 white Soldier creature tokens with flying", "X 2/2 black Zombie creature
 *  tokens", "a token that's a copy of target creature you control", "a number of 1/1 Saproling tokens
 *  equal to its power". The object text is the whole printed phrase, as the store writes it; the
 *  filter grammar reads its characteristics. */
function tokenOf(phrase: string): Args | null {
  // "that's tapped and attacking" is how the token ENTERS, not what it is: kept out of the text, or the
  // token's own node (a Soldier) would no longer join the card that makes it.
  let t = phrase.trim().replace(/ that(?:'s| are) tapped and attacking$/, "");
  let amount: string | undefined;
  // The text derive reads is the token phrase alone: "equal to that creature's power" is the amount,
  // and left in the text it made Ruthless Technomancer's Treasures creatures.
  let text = t;
  const eq = /^a number of (.+?) equal to (.+)$/.exec(t);
  if (eq) { t = `a ${eq[1]!.replace(/tokens\b/, "token")}`; amount = eq[2]!; text = eq[1]!; }
  const each = / for each (.+)$/.exec(t);
  if (each) t = t.slice(0, each.index);
  if (!/\btokens?\b/.test(t)) return null;
  const count = /^(a|an|one|two|three|four|five|six|seven|eight|nine|ten|x|\d+|that many) /i.exec(t);
  const n = count ? amountOf(count[1]!) ?? count[1]!.toLowerCase() : undefined;
  // The filter grammar reads the characteristics; a count it has no word for ("that many") and a
  // quoted ability it cannot read are not characteristics, so a reading without them stands in.
  const bare = count && !amountOf(count[1]!) ? `a ${t.slice(count[0].length).replace(/tokens\b/, "token")}` : t;
  const object = parse(bare) ?? parse(bare.replace(/ with "[^"]*"$/, ""));
  if (!object || object.token !== true) return null;
  // A COPY OF A BACK-REFERENCE ("a token that's a copy of that permanent", Second Harvest) keeps the
  // stored object: the filter grammar reads "that permanent" as the class permanent, which would let
  // every copied token feed landfall and enchantress.
  const copiesRef = /\bcop(?:y|ies) of (?:that|it|those|them|the exiled|the sacrificed|this)\b/.test(t);
  return { object: copiesRef ? { ...object, ref: "sentence" } : object, amount: amount ?? (each ? `${n ?? "1"} for each ${each[1]}` : n ?? "1"), ...(copiesRef ? {} : { text }) };
}

/** "a Clue token, a Food token, and a Treasure token": one creation per token, as the store writes them. */
function tokenList(rest: string): Args | Args[] | null {
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
  if (rest === "") return "1";
  if (rest === "twice") return "2";
  const m = /^(\w+|that many) times$/.exec(rest);
  return m ? amountOf(m[1]!) ?? m[1]! : null;
}

const TOKENS: Record<string, [string, Handler]> = {
  create: ["create", tokenList],
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
  const at = phrase.search(/ from (?:your|their|its owner's|a|an opponent's|target player's|each player's|each opponent's|all) (?:graveyards?|hands?|librar(?:y|ies))$| from exile$| from the battlefield$/);
  if (at < 0) return { rest: phrase };
  return { rest: phrase.slice(0, at), from: zoneOf(phrase.slice(at + " from ".length).replace(/^(?:your|their|its owner's|a|an opponent's|target player's|each player's|each opponent's|all|the) /, "")) };
}

const MOVE_REF = /^(?:(?:one|two|three|up to (?:one|two|three)|any number) of (?:them|those cards)|the rest|the other|one|that [a-z]+(?: card)?|those [a-z]+(?: cards)?|(?:one|that) pile|all (?:[a-z]+ )*cards revealed this way|the (?:exiled|chosen|revealed|milled) cards?|the cards? exiled (?:this way|with (?:it|~))|all cards exiled with (?:it|~)|her|his)$/;

/** A zone move's object: a class, the card itself, or a back-reference (kept as stored). The COUNT
 *  stays in the text, as the store writes a zone move ("two creatures", no amount): derive's counts
 *  read it there. `onField`: a permanent moved with no "from" leaves the battlefield. */
function moveObject(phrase: string, onField = false): Args | null {
  const t = phrase.replace(/ of (?:their|his or her|your) choice$/, "").replace(/ from among (?:them|those cards)$/, "");
  // "target player's graveyard", "all graveyards": a whole graveyard.
  if (/^(?:target player's|target opponent's|each opponent's|your|their|all|each player's|all opponents'|any number of target players'|target players') graveyards?$/.test(t)) return { object: { control: "any", token: null }, fromZone: "graveyard", text: phrase };
  // "one of them", "the rest", "the exiled card", "those tokens": back-references, kept as stored.
  if (MOVE_REF.test(t)) return { object: { control: "any", token: null, ref: "sentence" } };
  const { rest, from } = fromOf(t);
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
  const m = /^(?:to|into|onto|on top of|on the bottom of|in) (?:the |its owner's |their owners' |their owner's |her owner's |his owner's |your |their |a player's |an opponent's |a )?(.+)$/.exec(t);
  return m ? zoneOf(m[1]!) : undefined;
}

/** "exile it with three time counters on it": the move, then the counters on what moved. */
function withCounters(rest: string, move: (rest: string) => Args | Args[] | null): Args[] | Args | null {
  const at = rest.search(/ with (?:a|an|one|two|three|four|five|x|\d+) [^ ]+ counters? on (?:it|them)$/);
  if (at < 0) return move(rest);
  const r = move(rest.slice(0, at));
  const c = counterList(rest.slice(at + " with ".length).replace(/ on (?:it|them)$/, ""));
  return r && c ? [...[r].flat(), ...c.map((k) => ({ verb: "add-counter", object: { control: "any" as const, token: null, ref: "sentence" as const }, counter: k.counter, amount: k.amount ?? "1" }))] : null;
}

const ZONE: Record<string, [string, Handler]> = {
  destroy: ["destroy", (rest) => moveObject(rest)],
  sacrifice: ["sacrifice", (rest) => moveObject(rest)],
  exile: ["exile", (rest) => withCounters(rest.replace(/ face down$/, ""), (rest) => {
    rest = rest.replace(/ instead of putting it into its owner's graveyard$/, "");
    const until = rest.search(/ until /);
    // "exile cards from the top of your library until you exile a nonland card": the until is WHICH
    // card, not how long.
    if (/^cards from the top of /.test(rest)) return null;
    const r = moveObject(until > 0 ? rest.slice(0, until) : rest);
    return r && { ...r, toZone: "exile" };
  })],
  return: ["return", (all) => withCounters(all, (rest) => {
    const at = rest.search(/ (?:to|on top of|on the bottom of) (?=the battlefield|its owner's|their owners'|their owner's|your|its controller's)/);
    if (at < 0) return null;
    const to = destinationOf(rest.slice(at + 1));
    const r = moveObject(rest.slice(0, at), true);
    return r && to ? { ...r, toZone: to } : null;
  })],
  put: ["put", (all): Args | Args[] | null => withCounters(all, (rest) => {
    // "put them back in any order", "put one of those cards back on top of your library".
    const back = /^(.+?) back (?:on top of (?:your|their|its owner's|that player's|target player's) library|in any order)$/.exec(rest);
    if (back) { const r = moveObject(back[1]!); return r && { ...r, toZone: "library" }; }
    // "one of them into your hand and the rest on the bottom of your library": two moves.
    // "a land card from among them onto the battlefield tapped and an Elf card from among them into
    // your hand" (Bounty of Skemfar): the same, each with its own object.
    for (const pair of rest.matchAll(/ and (?=(?:the (?:rest|other)|a|an|one|two|all) )/g)) {
      const a = ZONE.put![1](rest.slice(0, pair.index)), b = ZONE.put![1](rest.slice(pair.index + pair[0].length));
      if (a && b) return [a, b].flat();
    }
    const at = rest.search(/ (?:onto|into|on top of|on the bottom of) (?=the battlefield|its owner's|their owners'|your|a graveyard|exile|their)/);
    if (at < 0) return null;
    const to = destinationOf(rest.slice(at + 1));
    const r = moveObject(rest.slice(0, at), true);
    return r && to ? { ...r, toZone: to } : null;
  })],
  shuffle: ["shuffle", (rest) => {
    if (rest === "" || /^(?:your|their) library$/.test(rest)) return { object: parse("you")!, text: rest === "" ? "your library" : rest };
    const m = /^(.+?) into (?:its owner's|their owners'|your|their) librar(?:y|ies)$/.exec(rest);
    const r = m ? moveObject(m[1]!) : null;
    return r && { ...r, toZone: "library" };
  }],
};

/** Mana as printed: "{C}", "{R} or {G}", "{G}{G}", "one mana of any color", "two mana in any
 *  combination of colors", "X mana of any one color". */
const MANA = /^(?:(?:\{[WUBRGCSX0-9/]+\})+(?:,? (?:or|and) (?:\{[WUBRGCSX0-9/]+\})+|, (?:\{[WUBRGCSX0-9/]+\})+)*|(?:one|two|three|four|five|x|that much|that many|an additional) (?:additional )?mana (?:of any (?:one )?(?:color|type)|in any combination of colors|of the chosen color|of any color that a land an opponent controls could produce|of any of the exiled card's colors)?)$/i;

const MANA_TAP: Record<string, [string, Handler]> = {
  add: ["add-mana", (rest) => {
    // "an amount of {G} equal to this creature's power": the amount is what it equals.
    const eq = /^an amount of ((?:\{[WUBRGC]\})+) equal to (.+)$/i.exec(rest);
    if (eq) return { object: { control: "any", token: null }, text: eq[1]!, amount: eq[2]! };
    const each = rest.indexOf(" for each ");
    const mana = each >= 0 ? rest.slice(0, each) : rest;
    if (!MANA.test(mana)) return null;
    return { object: { control: "any", token: null }, text: mana, ...(each >= 0 ? { amount: rest.slice(each + 1) } : {}) };
  }],
  tap: ["tap", (rest) => {
    const r = objectOf(rest);
    return r && { object: r.object, ...(r.object.ref || r.object.self ? {} : { text: rest }) };
  }],
  untap: ["untap", (rest) => {
    const r = objectOf(rest);
    return r && { object: r.object, ...(r.object.ref || r.object.self ? {} : { text: rest }) };
  }],
};

/** "<subject> enters tapped [unless ...]": tapped as it arrives, the store's `tap` on the card.
 *  "<subject> can't block", "doesn't untap during ...", "attacks each combat if able": a
 *  restriction, the store's `cant` with the restricted thing as its object. */
function restrictionOf(t: string): ActionReading[] | null {
  const tapped = /^(.+?) enters(?: the battlefield)? tapped(?: (unless .+|if .+))?$/i.exec(t);
  if (tapped) {
    const who = objectOf(tapped[1]!);
    return who ? [{ verb: "tap", object: who.object, ...(tapped[2] ? { condition: tapped[2] } : {}) }] : null;
  }
  const m = /^(.+?) (can't|cannot|doesn't|don't|attacks each combat if able|attack each combat if able|blocks each combat if able|can block only) ?(.*)$/i.exec(t);
  if (!m) return null;
  const who = objectOf(m[1]!) ?? (/^(?:you|your opponents|each opponent|players)$/i.test(m[1]!) ? { object: parse(m[1]!.toLowerCase().startsWith("you") ? "you" : "an opponent") ?? { control: "any" as const, token: null } } : null);
  if (!who) return null;
  const word = m[2]!.toLowerCase();
  const what = /each combat if able/.test(word) ? `not ${word.replace(/s each/, " each")}${m[3] ? ` ${m[3]}` : ""}`
    : word === "can block only" ? `block ${m[3]!.replace(/^creatures with /, "creatures without ")}`
    : m[3]!;
  if (!what) return null;
  return [{ verb: "cant", object: who.object, text: what }];
}

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

const HANDLERS: Record<string, [string, Handler]> = { ...ZONE, ...MANA_TAP, ...DRAW_SEARCH, ...DAMAGE_LIFE, ...COUNTERS, ...TOKENS };
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
const WHEN_TAILS = [" at the beginning of the next turn's upkeep", " at the beginning of the next end step", " at the beginning of the next upkeep", " instead", " at end of combat", " at the beginning of your next upkeep", " at the beginning of the end step", " at the beginning of the next cleanup step", " at the beginning of your next end step", " rather than pay this spell's mana cost"];
/** The trailing condition of a phrase, by index rather than an end-anchored regex (CodeQL
 *  polynomial-redos): one of WHEN_TAILS, or a last " if ..." with no comma after it. */
function whenTail(t: string): { at: number; text: string } | undefined {
  const fixed = WHEN_TAILS.find((w) => t.endsWith(w));
  if (fixed) return { at: t.length - fixed.length, text: fixed.trim() };
  // "attacks each combat if able" is the restriction itself, not a condition on it.
  if (t.endsWith(" if able")) return undefined;
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
  const parts = text.split(/,? and (?!from )|, (?!and )/).map((p) => p.trim()).filter(Boolean);
  return parts.length > 0 && parts.every(isAbility) ? parts : null;
}

const KEYWORDS = [...KEYWORD_ABILITIES].map((k) => k.toLowerCase());
/** A keyword, with its parameter if any ("ward {2}", "protection from red", "toxic 1"), a quoted
 *  ability, or "that ability" (a back-reference derive resolves). */
function isAbility(part: string): boolean {
  const p = part.toLowerCase();
  if (/^"[^"]*"$/.test(part) || /^(?:that|this|those) abilit(?:y|ies)$/.test(p)) return true;
  return KEYWORDS.some((k) => p === k || (p.startsWith(`${k} `) && p.length - k.length <= 40 && !/\blife\b/.test(p)));
}

/** "<subject> gets +2/+2 [for each ...] [and gains flying] [until end of turn]", "<subject> has
 *  flying", "<subject> gains hexproof": a pump and its grants, the subject the pump's object and
 *  each grant's object the ability (derive reads the grant's recipient off the clause). */
function pumpOrGrant(t: string): ActionReading[] | null {
  let body = t.replace(/ until end of turn(?= for each )/i, "").replace(DURATION, "");
  // "As long as you control a Swamp, ...", "... as long as you control a Swamp", "... if you control
  // a creature with flying": the condition, kept (owner, 2026-10-01).
  let condition: string | undefined;
  const lead = /^(?:during your turn|until end of turn|as long as [^,]+|if [^,]+), /i.exec(body);
  if (lead) { if (!/^until end of turn/i.test(lead[0])) condition = lead[0].slice(0, -2); body = body.slice(lead[0].length); }
  const trail = body.search(/ (?:as long as|for as long as|if) /i);
  if (trail > 0) { condition = [condition, body.slice(trail + 1)].filter(Boolean).join(", "); body = body.slice(0, trail).replace(DURATION, ""); }
  let subject: string | undefined, verb: string | undefined, rest = "";
  const m = /^(gets?|gains?|has|have) /i.exec(body);
  if (m && lastSubject !== undefined) { subject = lastSubject; verb = m[1]!.toLowerCase(); rest = body.slice(m[0].length); }
  else {
    for (const v of body.matchAll(/ (gets?|gains?|has|have) /gi)) {
      const who = body.slice(0, v.index);
      if (who.length > 80 || !(who === "you" || objectOf(who) || /^(?:they|they each|he|she|that token|those tokens|those creatures|each of those creatures)$/i.test(who))) continue;
      subject = who; verb = v[1]!.toLowerCase(); rest = body.slice(v.index + v[0].length); break;
    }
  }
  if (subject === undefined || verb === undefined) return null;
  const who = /^(?:they|they each|he|she|that token|those tokens|those creatures|each of those creatures)$/i.test(subject)
    ? { object: { control: "any" as const, token: null, ref: "sentence" as const } }
    : objectOf(subject) ?? { object: parse("you")! };
  const isRef = who.object.ref === "sentence";
  const target = { object: who.object, ...(isRef ? {} : { text: subject }) };
  const out: ActionReading[] = [];
  let grants = rest;
  if (/^gets?$/.test(verb)) {
    const and = rest.search(/ and (?:gains?|has) /);
    const pt = (and >= 0 ? rest.slice(0, and) : rest).replace(DURATION, "");
    const each = pt.indexOf(" for each ");
    const n = PT.exec(each >= 0 ? pt.slice(0, each) : pt);
    if (!n) return null;
    out.push({ verb: "modify-pt", ...target, amount: `${n[1]}/${n[2]}${each >= 0 ? pt.slice(each) : ""}` });
    if (and < 0) { lastSubject = subject; return withCondition(out, condition); }
    grants = rest.slice(and).replace(/^ and (?:gains?|has) /, "");
  }
  const abilities = abilitiesOf(grants.replace(DURATION, ""));
  if (!abilities) return null;
  for (const a of abilities) out.push({ verb: "grant-ability", object: who.object, text: a });
  lastSubject = subject;
  return withCondition(out, condition);
}

const withCondition = (out: ActionReading[], condition: string | undefined) => (condition ? out.map((a) => ({ ...a, condition })) : out);

function readPhrase(quoted: string, condition: string | undefined, carried?: ActionReading["actor"]): ActionReading[] | null {
  const phrase = quoted.replace(/\uE000(\d+)\uE001/g, (_m, i: string) => quotes[Number(i)]!);
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
    let [verb, handler] = HANDLERS[base]!;
    const rest = t.slice(m[0].length).trim();
    let args = handler(rest);
    // "put" is a counter's verb first ("put a +1/+1 counter on ..."), else a zone move.
    if (!args && base === "put") { [verb, handler] = ZONE.put!; args = handler(rest); }
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
  // Split where a new cost item starts, so "Sacrifice an artifact, creature, or land" stays one.
  for (const part of cost ? cost.split(/, (?=\{|[A-Z]|[−+]?\d)/) : []) {
    const r = readPhrase(part.replace(/^([A-Z])/, (c) => c.toLowerCase()), undefined);
    if (r) out.push(...r);
  }
  // Quoted ability text belongs to what is granted, not to this clause's own actions.
  // A QUOTED ability is one atom: never split, never read as this clause's own actions, and kept in
  // the object it belongs to ('create a 1/1 Spawn token with "Sacrifice this token: Add {C}."').
  quotes = [];
  const unquoted = effect.replace(/"[^"]*"/g, (q) => `\uE000${quotes.push(q) - 1}\uE001`);
  let mayBefore = false;
  for (const raw of unquoted.split(/(?<=\.)\s+/)) {
    let s = raw.trim().replace(/\.$/, "");
    if (s === "") continue;
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
