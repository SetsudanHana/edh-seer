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
  if (/^(?:this card|~|this)$/i.test(t)) return { object: SELF };
  if (/^(?:it|them|that card|those cards|the revealed card|that spell)$/i.test(t)) return { object: { control: "any", token: null, ref: "sentence" } };
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

const HANDLERS: Record<string, [string, Handler]> = { ...DRAW_SEARCH };
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
    return [args].flat().map((a) => ({ verb, ...a, ...(a.object && a.text === undefined && /\S/.test(rest) && !/^(?:\d+|x)$/i.test(rest) ? { text: objectPhrase(verb, rest) } : {}), ...(optional ? { optional: true as const } : {}), ...(actor ? { actor } : {}), ...(condition ? { condition } : {}) }));
  }
  return null;
}

/** The printed object phrase of a reading: the words after the verb, without the zone the search
 *  names and the manner ("at random") -- what derive's string path reads as the object. */
function objectPhrase(verb: string, rest: string): string {
  if (verb === "search") return rest.replace(/^.*? for /, "");
  return rest.replace(/ at random$/, "");
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
    const both = /^you and (another target player|target opponent|target player|that player|each opponent|defending player|the attacking player|the controller of [^,]+?) each (.+)$/i.exec(s);
    if (both) {
      for (const who of ["you", both[1]!.replace(/^another target player$/, "target player").replace(/^the controller of .+$/, "that player")]) {
        for (const p of phrases(`${who} ${both[2]}`)) { const r = readPhrase(p, condition); if (r) out.push(...r); }
      }
      continue;
    }
    let carried: ActionReading["actor"];
    const at = out.length;
    for (const p of phrases(s)) {
      // "sacrifice this creature unless you discard a card": the payment is an action too.
      const [main, payment] = p.split(/ unless /);
      // "discard a card or pay {2}", "sacrifice a creature or discard a card": either is an action.
      for (const alt of main!.split(/ or (?=(?:pay|sacrifice|discard|draw|mill|exile|lose|reveal|search)\b)/)) {
        const r = readPhrase(alt, condition, carried);
        if (r) { out.push(...r); carried = r[0]?.actor ?? carried; }
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
