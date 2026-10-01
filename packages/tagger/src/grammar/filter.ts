/** THE FILTER GRAMMAR (#896, task 2): a subject phrase of card text — "another nontoken creature you
 *  control", "an instant or sorcery spell", "target creature card with mana value 3 or less from
 *  your graveyard" — tokenized and parsed, into the `SubjectFilter` that `parseSubject` builds from
 *  about thirty independent regex sweeps.
 *
 *  `parse` ANSWERS ONLY WHEN IT UNDERSTOOD EVERY WORD. Anything else is `null`, and the caller falls
 *  back to `parseSubject`:
 *  - a word it does not know;
 *  - a narrowing the schema cannot hold ("tapped", "nonbasic", "multicolored", "snow") — dropping it
 *    would WIDEN the claim, and a silent wrong answer is worse than a missing one;
 *  - a reference ("it", "that creature", "~", "enchanted creature"), which `derive/references.ts`
 *    resolves, not this;
 *  - text that is not a noun phrase at all ("Flying", "{C}", "chapter II"), which tasks 5 and 6 own.
 *
 *  NOT WIRED INTO DERIVE. Task 3 switches the subjects over; until then this is measured by
 *  `packages/instruments/src/phrase-diff.ts`, never used.
 *
 *  THE ENCODING IS `parseSubject`'s ON PURPOSE — scope from the quantifier, `other`, a negation
 *  resolved to the types it leaves (`resolveTypes`, shared), umbrellas intersected, a cross-slot OR
 *  as `anyOf` — so a disagreement is a difference in READING, never in encoding. Every one is
 *  labelled in `grammar-triage.json` (H3).
 *
 *  The grammar, informally:
 *
 *    phrase  := player | object
 *    player  := "you" | det? ("opponent" | "player" | "defending player" | ...)
 *    object  := quant* nominal post*
 *    nominal := group ((","? ("or" | "and" | "and/or") | ",") group)*      -- groups are ORed
 *    group   := premod* head?                                            -- words in a group are ANDed
 *    post    := control | "you own" | with-stat | with-keyword | with-counter | zone
 *             | "named" name | "of the chosen" kind | "attached to" object | "for each" phrase */
import type { Control, StatPredicate, SubjectFilter } from "../schema.js";
import { CARD_TYPES, TYPES, counterKindOf, resolveTypes, singulars } from "../derive/subject.js";
import { KEYWORD_ABILITIES, SPELL_SUBTYPES, SUBTYPES } from "../derive/subtypes.js";

// ---------------------------------------------------------------------------------------------
// Lexer

/** A mana symbol, a printed size or counter ("1/1", "+1/+1"), a number, a word (with its
 *  apostrophes and hyphens: "opponent's", "non-dragon", "assembly-worker"), a comma, or "~", the
 *  card's own name, which only a "that targets" clause reads. Anything else — a period, a colon, a
 *  parenthesis — fails the lex, and a phrase that does not lex does not parse. */
const TOKEN = /\{[^}\s]{1,8}\}|[+-]?(?:\d{1,3}|x|\*)\/[+-]?(?:\d{1,3}|x|\*)|\d{1,3}|and\/or|[a-z][a-z'-]*|,|~/y;

export function lex(text: string): string[] | null {
  const t = text.toLowerCase().replace(/’/g, "'").trim();
  const out: string[] = [];
  for (let i = 0; i < t.length; ) {
    if (t[i] === " ") { i++; continue; }
    TOKEN.lastIndex = i;
    const m = TOKEN.exec(t);
    if (!m) return null;
    out.push(m[0]);
    i = TOKEN.lastIndex;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Vocabulary

/** Card-type words, singular and plural, to their `TYPES` entry. "sorceries" is here because a
 *  `\bsorcerys\b` sweep never matches it. */
const TYPE_WORDS = new Map<string, { type: string; plural: boolean }>();
for (const ty of TYPES) {
  if (ty === "token" || ty === "card") continue;
  TYPE_WORDS.set(ty, { type: ty, plural: false });
  TYPE_WORDS.set(ty === "sorcery" ? "sorceries" : `${ty}s`, { type: ty, plural: true });
}

const ROLE_NAMES = [["young", "hero"], ["monster"], ["wicked"], ["sorcerer"], ["royal"], ["cursed"], ["virtuous"]];

const COLOR_WORDS: Record<string, string> = {
  white: "W", blue: "U", black: "B", red: "R", green: "G", colorless: "C", colourless: "C",
};
const WUBRG = ["W", "U", "B", "R", "G", "C"];

const NUMBERS = new Set([
  "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "x",
]);
const isNumber = (w: string | undefined) => w !== undefined && (NUMBERS.has(w) || /^\d+$/.test(w));

/** Keyword abilities, longest first, as word lists — "first strike" before any one-word keyword. */
const KEYWORD_WORDS = [...KEYWORD_ABILITIES].sort((a, b) => b.length - a.length).map((k) => k.split(" "));

/** The subtype a word names, if any. A SPELL subtype ("Arcane", "Lesson") counts only when the
 *  phrase has a spell noun, the same guard `parseSubtypes` has: "lesson" and "trap" are English. */
function subtypeOf(w: string, spellNoun: boolean): { subtype: string; plural: boolean } | undefined {
  if (w === "mice") return { subtype: "mouse", plural: true };
  for (const s of singulars(w)) {
    if (SUBTYPES.has(s) || (spellNoun && SPELL_SUBTYPES.has(s))) return { subtype: s, plural: s !== w };
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// Parser state

/** One OR-alternative of the nominal: its words are ANDed ("artifact creature" is both). */
interface Group {
  types: string[]; subtypes: string[];
  /** The one-value adjectives this alternative carries ("tapped", "nonblack", "snow", "nonbasic",
   *  "multicolored"): the subject has one field for each, so it must say the same in every
   *  alternative or the phrase is refused. */
  adj: string[];
  /** The head noun this alternative names itself ("card", "spell", "permanent"), or that its own
   *  article makes its last type word ("an artifact or a card": "artifact"). Unset when it shares the
   *  head of the alternative after it ("an instant or sorcery CARD"). */
  head?: string;
}

/** What the words said, before it is lowered to a `SubjectFilter`. */
interface Reading {
  control?: Control;
  owner?: "you";
  token: boolean | null;
  groups: Group[];
  plural: boolean;
  target: boolean;
  each: boolean;
  all: boolean;
  other: boolean;
  /** The word "other" itself, which `parseScope` reads as a mass effect; "another" is singular. */
  otherWord: boolean;
  notTypes: string[];
  notSubtypes: string[];
  colors: Set<string>;
  /** A colour word came after a noun: it belongs to a later alternative, not to all of them. */
  colorAfterHead: boolean;
  stats: StatPredicate[];
  /** "target activated or triggered ability": the head is an ability, and these are its kinds. */
  ability: boolean;
  abilityKinds: string[];
  keywords: string[];
  notKeywords: string[];
  counter?: string;
  combat?: "attacking" | "blocking" | "in-combat";
  tapped?: boolean;
  /** `false` is the negation ("nonlegendary", "nonbasic"); undefined says nothing. */
  legendary?: boolean;
  basic?: boolean;
  snow: boolean;
  notColors: string[];
  colorCount?: "multi" | "mono";
  hasCounter: boolean;
  targets?: Partial<SubjectFilter>;
  /** "power or toughness N or less": the two stats as alternatives, lowered to `anyOf`. */
  statAlternatives?: StatPredicate[];
  /** An article restarted the nominal ("an Equipment spell OR A spell that ..."): two noun phrases. */
  restarted: boolean;
  historic: boolean;
  outlaw: boolean;
  modified: boolean;
  prepared: boolean;
  commander: boolean;
  chosenType: boolean;
  restricted: boolean;
  named?: string;
  fromZone?: string;
  zone?: string;
  /** The head noun was "token": a following "named X" names the token being created, not a card. */
  tokenHead: boolean;
}

const reading = (): Reading => ({
  token: null, groups: [{ types: [], subtypes: [], adj: [] }], plural: false, target: false, each: false,
  all: false, other: false, otherWord: false, notTypes: [], notSubtypes: [], colors: new Set(), colorAfterHead: false, stats: [], ability: false, abilityKinds: [],
  keywords: [], notKeywords: [], snow: false, notColors: [], hasCounter: false, restarted: false, historic: false, outlaw: false,
  modified: false, prepared: false, commander: false, chosenType: false, restricted: false,
  tokenHead: false,
});

class Cursor {
  i = 0;
  constructor(readonly t: readonly string[], readonly spellNoun: boolean) {}
  peek(k = 0): string | undefined { return this.t[this.i + k]; }
  get done(): boolean { return this.i >= this.t.length; }
  /** Consume `words` if they come next; consume nothing otherwise. */
  eat(...words: string[]): boolean {
    for (let k = 0; k < words.length; k++) if (this.t[this.i + k] !== words[k]) return false;
    this.i += words.length;
    return true;
  }
}

// ---------------------------------------------------------------------------------------------
// Players

/** "you", "each opponent", "target player", "your opponents", "defending player". A player is a
 *  subject too — `parseControl` reads its control off it, and `scope` its quantifier. */
function player(c: Cursor): SubjectFilter | null {
  if (c.eat("you")) return c.done ? { control: "you", token: null } : null;
  const r = reading();
  quantifier(c, r);
  let control: Control;
  if (c.eat("defending", "player") || c.eat("attacking", "player")) control = "opp";
  else if (c.eat("opponent")) control = "opp";
  else if (c.eat("opponents")) { control = "opp"; r.plural = true; }
  else if (c.eat("player")) control = r.control ?? "any";
  else if (c.eat("players")) { control = r.control ?? "any"; r.plural = true; }
  else return null;
  if (!c.done) return null;
  const out: SubjectFilter = { control, token: null };
  const scope = scopeOf(r);
  if (scope) out.scope = scope;
  if (r.other) out.other = true;
  return out;
}

// ---------------------------------------------------------------------------------------------
// Objects

/** Determiners and counts, in any order: "another target", "up to two target", "each other",
 *  "one or more", "any number of", "all". Records the quantifier; returns nothing. */
function quantifier(c: Cursor, r: Reading): void {
  for (;;) {
    if (c.eat("a") || c.eat("an")) continue;
    if (c.eat("target")) { r.target = true; continue; }
    if (c.eat("another")) { r.other = true; continue; }
    if (c.eat("other")) { r.other = true; r.otherWord = true; continue; }
    // "each of up to two target creatures", "each of two targets".
    if (c.eat("each", "of") || c.eat("each") || c.eat("every")) { r.each = true; continue; }
    if (c.eat("all", "the") || c.eat("all")) { r.all = true; continue; }
    if (c.eat("your")) { r.control = "you"; continue; }
    if (c.eat("any", "number", "of") || c.eat("up", "to")) continue;
    // A count, or a list of them: "two", "one or more", "one or two", "one, two, or three".
    if (isNumber(c.peek())) {
      c.i++;
      while (c.eat("or", "more") || ((c.peek() === "," || c.peek() === "or") && (
        (isNumber(c.peek(1)) && (c.i += 2)) || (c.peek(1) === "or" && isNumber(c.peek(2)) && (c.i += 3)))));
      continue;
    }
    if (c.eat("any")) continue;
    // "an additional land", "two additional cards": how many more, not which.
    if (c.eat("additional")) continue;
    return;
  }
}

/** One pre-nominal word or head noun, folded into the current group. False when the next word is
 *  not one — the nominal ends there. Null when it IS one but the schema cannot hold it.
 *
 *  CEILING: word ORDER inside one alternative is not checked ("creature white" would read as "white
 *  creature"). Every phrase measured is printed text, where the order is English; a grammar that
 *  also refused misordered words would need adjective classes, and nothing in the census needs them. */
function nominalWord(c: Cursor, r: Reading): boolean | null {
  const w = c.peek();
  if (w === undefined) return false;
  const g = r.groups[r.groups.length - 1]!;
  const ty = TYPE_WORDS.get(w);
  if (ty) {
    g.types.push(ty.type); if (ty.plural) r.plural = true;
    if (ty.type === "spell" || ty.type === "permanent") g.head = ty.type;
    c.i++; return true;
  }
  if (COLOR_WORDS[w]) {
    if (r.groups.some((x) => x.types.length > 0 || x.subtypes.length > 0)) r.colorAfterHead = true;
    r.colors.add(COLOR_WORDS[w]!); c.i++; return true;
  }
  // A printed size. Both halves or neither, and only digits: an X or a * is no number (LITERAL_SIZE).
  if (/^(?:\d+|x|\*)\/(?:\d+|x|\*)$/.test(w)) {
    const [p, t] = w.split("/");
    if (/^\d+$/.test(p!) && /^\d+$/.test(t!)) {
      r.stats.push({ metric: "power", op: "eq", value: Number(p) }, { metric: "toughness", op: "eq", value: Number(t) });
    }
    c.i++; return true;
  }
  switch (w) {
    case "token": r.token = true; r.tokenHead = true; c.i++; return true;
    case "tokens": r.token = true; r.tokenHead = true; r.plural = true; c.i++; return true;
    case "nontoken": r.token = false; c.i++; return true;
    case "card": case "cards": g.head = "card"; c.i++; return true;
    case "ability": case "abilities": r.ability = true; c.i++; return true;
    case "activated": case "triggered": case "loyalty": case "mana":
      if (!r.abilityKinds.includes(w)) r.abilityKinds.push(w);
      c.i++; return true;
    case "legendary": r.legendary = true; c.i++; return true;
    case "basic": r.basic = true; c.i++; return true;
    case "snow": r.snow = true; g.adj.push(w); c.i++; return true;
    // CR 110.5, a status.
    case "tapped": r.tapped = true; g.adj.push(w); c.i++; return true;
    case "untapped": r.tapped = false; g.adj.push(w); c.i++; return true;
    case "multicolored": case "multicoloured": r.colorCount = "multi"; g.adj.push(w); c.i++; return true;
    case "monocolored": case "monocoloured": r.colorCount = "mono"; g.adj.push(w); c.i++; return true;
    // "attacking or blocking" is either, and `combat` holds one: refused, not narrowed to one half.
    // "attacking or blocking" is `in-combat` (CR 506.4), the state either way.
    case "attacking": r.combat = r.combat === "blocking" || r.combat === "in-combat" ? "in-combat" : "attacking"; g.adj.push("combat"); c.i++; return true;
    case "blocking": r.combat = r.combat === "attacking" || r.combat === "in-combat" ? "in-combat" : "blocking"; g.adj.push("combat"); c.i++; return true;
    case "historic": r.historic = true; c.i++; return true;
    case "modified": r.modified = true; c.i++; return true;
    case "outlaw": case "outlaws": r.outlaw = true; c.i++; return true;
    case "commander": case "commanders": r.commander = true; c.i++; return true;
    case "prepared": if (c.peek(1) === "spell" || c.peek(1) === "spells") { r.prepared = true; c.i++; return true; } return null;
  }
  if (/^non-?[a-z]/.test(w)) {
    const rest = w.replace(/^non-?/, "");
    const neg = singulars(rest).find((s) => (CARD_TYPES as readonly string[]).includes(s));
    if (neg) { if (!r.notTypes.includes(neg)) r.notTypes.push(neg); if (rest !== neg) r.plural = true; c.i++; return true; }
    const sub = singulars(rest).find((s) => SUBTYPES.has(s));
    if (sub) { if (!r.notSubtypes.includes(sub)) r.notSubtypes.push(sub); c.i++; return true; }
    if (COLOR_WORDS[rest]) { if (!r.notColors.includes(COLOR_WORDS[rest]!)) r.notColors.push(COLOR_WORDS[rest]!); g.adj.push(w); c.i++; return true; }
    if (rest === "basic") { r.basic = false; g.adj.push(w); c.i++; return true; }
    if (rest === "legendary") { r.legendary = false; g.adj.push(w); c.i++; return true; }
    // nonhistoric, non-outlaw, nonattacking, nonsnow...: an inverse the schema cannot say.
    // `parseSubject` drops these, which widens the claim.
    return null;
  }
  // A ROLE's own name ("a Wicked Role token", CR 111.10): the token's name, read past like any
  // token name (G2b); the class is the Role subtype.
  const role = ROLE_NAMES.find((ws) => ws.every((x, j) => c.peek(j) === x) && c.peek(ws.length) === "role");
  if (role) { c.i += role.length; return true; }
  if (w === "time" && (c.peek(1) === "lord" || c.peek(1) === "lords")) {
    g.subtypes.push("time lord"); if (c.peek(1) === "lords") r.plural = true; c.i += 2; return true;
  }
  const sub = subtypeOf(w, c.spellNoun);
  if (sub) { if (!g.subtypes.includes(sub.subtype)) g.subtypes.push(sub.subtype); if (sub.plural) r.plural = true; c.i++; return true; }
  return false;
}

/** The nominal: groups of words joined by "or", "and", "and/or" or commas. A joiner is taken only
 *  when a nominal word follows it, so "creatures you control and ..." is never swallowed. */
function nominal(c: Cursor, r: Reading): boolean | null {
  let any = false;
  for (;;) {
    const ok = nominalWord(c, r);
    if (ok === null) return null;
    if (ok) { any = true; continue; }
    const save = c.i;
    // A BARE COMMA AFTER AN ADJECTIVE IS AN AND: "target nonartifact, nonblack creature" is one
    // creature with both, not two alternatives. A comma after a noun ("a Swamp, Mountain, ...") or
    // with "or"/"and" after it is a list.
    const cur = r.groups[r.groups.length - 1]!;
    if (c.peek() === "," && !["or", "and", "and/or"].includes(c.peek(1) ?? "")
      && cur.types.length === 0 && cur.subtypes.length === 0 && any) {
      c.i++;
      const ok2 = nominalWord(c, r);
      if (ok2 === null) return null;
      if (ok2) continue;
      c.i = save;
      return any;
    }
    // COLOURS JOINED BEFORE A NOUN are one alternative's colours: "a white and black Inkling token",
    // "a white or blue creature" -- `colors` is a list either way.
    if (cur.types.length === 0 && cur.subtypes.length === 0 && any
      && (c.peek() === "and" || c.peek() === "or") && COLOR_WORDS[c.peek(1) ?? ""]) {
      c.i++;
      continue;
    }
    const joined = (c.eat(",") && (c.eat("or") || c.eat("and") || c.eat("and/or") || true))
      || c.eat("or") || c.eat("and/or") || c.eat("and");
    if (!joined) return any;
    // "a" / "an" may restart after a joiner: "an artifact or an enchantment".
    const restart = c.eat("a") || c.eat("an");
    const before = c.i;
    // An article closes the alternative before it: "an artifact or a card" is two noun phrases.
    const prev = r.groups[r.groups.length - 1]!;
    if (restart && !prev.head) prev.head = prev.types.at(-1) ?? prev.subtypes.at(-1) ?? "object";
    if (restart) r.restarted = true;
    r.groups.push({ types: [], subtypes: [], adj: [] });
    const next = nominalWord(c, r);
    if (next === null) return null;
    if (!next) { r.groups.pop(); c.i = save; return any; }
    if (c.i === before) return null;
  }
}

/** A STAT COMPARISON after "with": "mana value 3 or less", "power equal to its toughness", "mana
 *  value X or less", "toughness less than the number of Islands you control", "lesser power", and
 *  the parity Void Winnower prints. A constant rhs is `value`, the subject's own other stat is `vs`,
 *  anything else -- X, a count, another object's stat -- is `variable` (see StatPredicate). */
type Metric = StatPredicate["metric"];
const RHS_VERBS = new Set(["can't", "can", "is", "are", "has", "have", "gets", "get", "gains", "gain", "loses", "would", "may", "must", "enters", "dies", "attacks", "blocks", "deals", "becomes", "assigns", "assign", "stations", "station", "attack", "block", "untap", "untaps"]);

function metricWord(c: Cursor): Metric | undefined {
  return c.eat("mana", "value") ? "mana-value" : c.eat("power") ? "power" : c.eat("toughness") ? "toughness" : undefined;
}

/** Where a variable rhs ends: the end of the phrase, or an origin phrase after it that reads to the
 *  end ("... less than the result FROM YOUR GRAVEYARD"). Never at "you control" or "in <zone>",
 *  which belong to a count inside the rhs as often as to the subject. */
function variableRhsEnd(c: Cursor): number {
  for (let k = c.i + 1; k < c.t.length; k++) {
    // Only at "from": "the number of cards IN your hand" is the count's own zone, never the subject's.
    if (c.t[k] !== "from") continue;
    const trial = new Cursor(c.t, c.spellNoun);
    trial.i = k;
    const r = reading();
    let ok = true;
    while (!trial.done) if (post(trial, r) !== true) { ok = false; break; }
    if (ok) return k;
  }
  return c.t.length;
}

function stat(c: Cursor, r: Reading): boolean {
  const save = c.i;
  if (c.eat("an", "odd", "mana", "value") || c.eat("odd", "mana", "values")) { r.stats.push({ metric: "mana-value", op: "odd" }); return true; }
  if (c.eat("an", "even", "mana", "value") || c.eat("even", "mana", "values")) { r.stats.push({ metric: "mana-value", op: "even" }); return true; }
  // "lesser power", "greater mana value", "equal or lesser toughness": compared with an object
  // named elsewhere in the sentence.
  const rel = c.eat("equal", "or", "lesser") ? "lte" : c.eat("equal", "or", "greater") ? "gte"
    : c.eat("lesser") ? "lt" : c.eat("greater") ? "gt" : undefined;
  if (rel) {
    const m = metricWord(c);
    if (m) { r.stats.push({ metric: m, op: rel, variable: true }); return true; }
    c.i = save; return false;
  }
  // "power or toughness 1 or less": either stat, so one branch per stat (`anyOf`).
  const m1 = metricWord(c);
  if (m1 && c.eat("or")) {
    const m2 = metricWord(c);
    const probe = reading();
    if (m2 && !r.statAlternatives) {
      const at = c.i;
      const pc = new Cursor([...(m1 === "mana-value" ? ["mana", "value"] : [m1]), ...c.t.slice(at)], c.spellNoun);
      if (stat(pc, probe) && probe.stats.length === 1) {
        c.i = at + pc.i - (m1 === "mana-value" ? 2 : 1);
        r.statAlternatives = [probe.stats[0]!, { ...probe.stats[0]!, metric: m2 }];
        return true;
      }
    }
    c.i = save; return false;
  }
  c.i = save;
  // "total mana value 3 or less": a sum no greater than N bounds each card by N.
  const total = c.eat("total");
  const metric = metricWord(c);
  if (!metric) { c.i = save; return false; }
  // "mana value 4, 5, or 6": a run of numbers with no gap is a range; a gap is refused.
  const nums: number[] = [];
  const at = c.i;
  while (/^\d+$/.test(c.peek() ?? "")) {
    nums.push(Number(c.peek())); c.i++;
    if (!(c.eat(",", "or") || c.eat(",") || c.eat("or"))) break;
  }
  if (nums.length >= 2 && !(c.t[c.i - 1] === "or" || c.t[c.i - 1] === ",")) {
    const sorted = [...nums].sort((a, b) => a - b);
    if (sorted.some((v, k) => k > 0 && v !== sorted[k - 1]! + 1)) { c.i = save; return false; }
    r.stats.push({ metric, op: "gte", value: sorted[0]! }, { metric, op: "lte", value: sorted.at(-1)! });
    return true;
  }
  c.i = at;
  const n = c.peek();
  if (n !== undefined && (/^\d+$/.test(n) || n === "x")) {
    c.i++;
    const base = n === "x" ? { variable: true as const } : { value: Number(n) };
    if (c.eat("or", "less") || c.eat("or", "fewer") || c.eat("or", "lower")) { r.stats.push({ metric, op: "lte", ...base }); return true; }
    if (total) { c.i = save; return false; }
    if (c.eat("or", "greater") || c.eat("or", "more") || c.eat("or", "higher")) { r.stats.push({ metric, op: "gte", ...base }); return true; }
    // A bare number is an equality: "an instant card with mana value 1".
    r.stats.push({ metric, op: "eq", ...base }); return true;
  }
  if (total) { c.i = save; return false; }
  const op = c.eat("less", "than", "or", "equal", "to") ? "lte" : c.eat("greater", "than", "or", "equal", "to") ? "gte"
    : c.eat("less", "than") ? "lt" : c.eat("greater", "than") ? "gt" : c.eat("equal", "to") ? "eq" : undefined;
  if (!op) { c.i = save; return false; }
  const v = c.peek();
  if (v !== undefined && /^\d+$/.test(v) && (c.i + 1 === c.t.length || ["from", "in", "you", "an", "that"].includes(c.t[c.i + 1]!))) {
    c.i++; r.stats.push({ metric, op, value: Number(v) }); return true;
  }
  // "power equal to its toughness": the subject's own other stat.
  if ((c.peek() === "its" || c.peek() === "their") && (c.peek(1) === "power" || c.peek(1) === "toughness") && c.peek(1) !== metric) {
    r.stats.push({ metric, op, vs: c.peek(1) as "power" | "toughness" }); c.i += 2; return true;
  }
  if (c.done) { c.i = save; return false; }
  // A VARIABLE RHS IS AN AMOUNT, NEVER A CLAUSE: it starts like one ("the number of ...", "that
  // card's power", "X") and holds no verb, or "power less than this creature's power CAN'T BLOCK ..."
  // would be read as a filter.
  const end = variableRhsEnd(c);
  const rhs = c.t.slice(c.i, end);
  if (!/^(?:the|that|this|its|their|x|\d+|twice|half)$/.test(rhs[0] ?? "")
    || rhs.some((w) => RHS_VERBS.has(w))) { c.i = save; return false; }
  c.i = end;
  r.stats.push({ metric, op, variable: true });
  return true;
}

/** "flying", "flying and vigilance", "flanking, protection from white, and haste": keywords
 *  joined by "and" or commas, longest first. A keyword's parameter is read and not kept: "toxic 1",
 *  "protection from white" -- the keyword is what a filter tests. */
function keywordList(c: Cursor): string[] | undefined {
  const out: string[] = [];
  do {
    const k = KEYWORD_WORDS.find((ws) => ws.every((w, j) => c.peek(j) === w));
    if (!k) return undefined;
    c.i += k.length;
    if (k.join(" ") === "protection" && c.eat("from")) { if (c.done) return undefined; c.i++; }
    else if (/^\d+$/.test(c.peek() ?? "")) c.i++;
    out.push(k.join(" "));
  } while (c.eat(",", "and") || c.eat("and") || (c.peek() === "," && KEYWORD_WORDS.some((ws) => ws.every((w, j) => c.peek(1 + j) === w)) && c.eat(",")));
  return out;
}

/** "with a +1/+1 counter on it", "with one or more oil counters on it". The kind must be one the
 *  counter dictionary knows: "with a counter on it" says no kind, and refusing it beats dropping it. */
function counterPhrase(c: Cursor, r: Reading): boolean {
  const save = c.i;
  if (!c.eat("a") && !c.eat("an")) c.eat("one", "or", "more");
  const start = c.i;
  while (!c.done && c.peek() !== "counter" && c.peek() !== "counters") c.i++;
  // No words before "counter" is no kind: "with a counter on it" (`hasCounter`).
  const kind = c.i === start ? "" : counterKindOf(c.t.slice(start, c.i).join(" "));
  if (kind !== undefined && (c.eat("counter") || c.eat("counters"))) {
    if (!c.eat("on", "it")) c.eat("on", "them");
    if (kind) r.counter = kind; else r.hasCounter = true;
    return true;
  }
  c.i = save;
  return false;
}

/** Who controls it, said after the noun. */
const CONTROLLERS: ReadonlyArray<readonly [string[], Control]> = [
  [["you", "don't", "control"], "opp"], [["you", "do", "not", "control"], "opp"],
  [["you", "control"], "you"],
  [["an", "opponent", "controls"], "opp"], [["your", "opponents", "control"], "opp"],
  [["opponents", "control"], "opp"], [["target", "opponent", "controls"], "opp"],
  [["each", "opponent", "controls"], "opp"], [["defending", "player", "controls"], "opp"],
  [["target", "player", "controls"], "any"], [["a", "player", "controls"], "any"],
];

/** Whose zone: the possessive before a zone noun. */
const ZONE_OWNERS: ReadonlyArray<readonly [string[], Control | undefined]> = [
  [["your"], "you"], [["an", "opponent's"], "opp"], [["target", "opponent's"], "opp"],
  [["each", "opponent's"], "opp"], [["defending", "player's"], "opp"], [["their"], undefined],
  [["target", "player's"], undefined], [["a", "single"], undefined], [["any"], undefined], [["its", "owner's"], undefined],
  [["each", "player's"], undefined], [["a"], undefined], [["the"], undefined],
];
const ZONES = new Map([
  ["graveyard", "graveyard"], ["graveyards", "graveyard"], ["exile", "exile"], ["library", "library"], ["hand", "hand"], ["hands", "hand"],
]);

function zonePhrase(c: Cursor, r: Reading): boolean {
  const save = c.i;
  const from = c.eat("from");
  if (!from && !c.eat("in")) return false;
  // "from the top of your library": the origin is still the library.
  // "from the top of your library", "from the top five cards of your library".
  let top = from && c.eat("the", "top", "of");
  if (from && !top && c.peek() === "the" && c.peek(1) === "top" && isNumber(c.peek(2)) && c.peek(3) === "cards" && c.peek(4) === "of") { c.i += 5; top = true; }
  let owner: Control | undefined;
  if (!c.eat("all")) for (const [ws, ctl] of ZONE_OWNERS) if (c.eat(...ws)) { owner = ctl; break; }
  const z = ZONES.get(c.peek() ?? "");
  if (z === undefined || (top && z !== "library")) { c.i = save; return false; }
  c.i++;
  if (from) r.fromZone = z; else r.zone = z;
  if (owner) r.control = owner;
  return true;
}

/** "named Rite of Flame": the name runs to the end, a comma, or the words that end it in
 *  `parseSubject`'s NAMED. */
const NAME_ENDS = new Set(["in", "on", "from", "under", "with", "that", "that's", "you", "a", "an", "to", ","]);

function post(c: Cursor, r: Reading): boolean | null {
  for (const [ws, ctl] of CONTROLLERS) if (c.eat(...ws)) { r.control = ctl; return true; }
  if (c.eat("you", "own")) { r.owner = "you"; return true; }
  // Who CASTS a spell is who controls it (CR 112.2).
  if (c.eat("you", "cast")) { r.control = "you"; return true; }
  if (c.eat("an", "opponent", "casts") || c.eat("your", "opponents", "cast") || c.eat("opponents", "cast")) { r.control = "opp"; return true; }
  // Words that do not narrow the class: whose choice it is, chance, and the default zone.
  if (c.eat("of", "their", "choice") || c.eat("of", "your", "choice") || c.eat("of", "an", "opponent's", "choice")
    || c.eat("at", "random") || c.eat("on", "the", "battlefield") || c.eat("from", "anywhere")
    // "from the battlefield" is the `dies` event's own origin, and `fromZone` deliberately never holds
    // it (see ORIGIN_ZONE in derive/subject.ts).
    || c.eat("from", "the", "battlefield")) return true;
  if (c.eat("with")) {
    if (stat(c, r) || counterPhrase(c, r)) return true;
    const ks = keywordList(c);
    if (ks) { r.keywords.push(...ks); return true; }
    return null;
  }
  if (c.eat("without")) {
    const ks = keywordList(c);
    if (ks) { r.notKeywords.push(...ks); return true; }
    return null;
  }
  if (zonePhrase(c, r)) return true;
  if (c.eat("named")) {
    const start = c.i;
    while (!c.done && (c.i === start || !NAME_ENDS.has(c.peek()!))) c.i++;
    // "a card named Ajani, Valiant Protector": a comma that ends the phrase's words is in the name.
    if (c.peek() === "," && c.t.slice(c.i + 1).length > 0 && c.t.slice(c.i + 1).every((w) => !NAME_ENDS.has(w))) c.i = c.t.length;
    if (!r.tokenHead) r.named = c.t.slice(start, c.i).join(" ").replace(/ ,/g, ",");
    return true;
  }
  // "of the creature type of your choice" is the chosen type, chosen as it resolves.
  if (c.eat("of", "the", "creature", "type", "of", "your", "choice")) { r.chosenType = true; return true; }
  if (c.eat("of", "the", "chosen")) {
    if (c.eat("type") || c.eat("color") || c.eat("colour") || c.eat("creature", "type")) { r.chosenType = true; return true; }
    return null;
  }
  // "a creature other than this creature": the same fact as "another" (`other`).
  if (c.eat("other", "than", "this")) {
    if (nominalWord(c, reading()) !== true) return null;
    r.other = true; return true;
  }
  // Relative clauses the schema can hold: a keyword the subject has, and its combat state.
  if (c.eat("that", "has") || c.eat("that", "have")) {
    const ks = keywordList(c);
    if (ks) { r.keywords.push(...ks); return true; }
    return null;
  }
  if (c.eat("that's") || c.eat("that", "is") || c.eat("that", "are")) {
    // "tokens that are tapped and attacking": the states the token enters with.
    if (c.eat("tapped", "and", "attacking")) { if (r.combat && r.combat !== "attacking") return null; r.tapped = true; r.combat = "attacking"; return true; }
    if (c.eat("tapped")) { r.tapped = true; return true; }
    const s = c.eat("attacking") ? "attacking" : c.eat("blocking") ? "blocking" : undefined;
    if (s) { if (r.combat && r.combat !== s) return null; r.combat = s; return true; }
    // "a spell that's white, blue, black, or red": its colours, joined as the nominal joins them.
    if (COLOR_WORDS[c.peek() ?? ""] && r.colors.size === 0) {
      do {
        if (!COLOR_WORDS[c.peek() ?? ""]) return null;
        r.colors.add(COLOR_WORDS[c.peek()!]!); c.i++;
      } while (c.eat(",") ? (c.eat("or") || c.eat("and") || true) : (c.eat("or") || c.eat("and/or")));
      return true;
    }
    // "a token that's a copy of X": the copy has X's COPIABLE values (CR 707.2) -- types, subtypes,
    // colour, keywords, size, a chosen type -- and nothing about whose X is, whether it is targeted,
    // attacking or a token.
    if (r.tokenHead && (c.eat("a", "copy", "of") || c.eat("copies", "of"))) {
      const self = c.eat("this");
      const x = reading();
      if (self) { while (!c.done && nominalWord(c, x) === true); if (!c.done) return null; }
      else { const o = object(c); if (!o) return null; Object.assign(x, o); }
      if (!x.groups.some((g) => g.types.length || g.subtypes.length)) return null;
      Object.assign(r, {
        groups: x.groups, notTypes: x.notTypes, notSubtypes: x.notSubtypes, colors: x.colors, stats: x.stats,
        keywords: x.keywords, notKeywords: x.notKeywords, legendary: x.legendary, chosenType: x.chosenType,
        historic: x.historic, outlaw: x.outlaw, snow: x.snow, basic: x.basic, notColors: x.notColors, colorCount: x.colorCount,
      });
      return true;
    }
    return null;
  }
  // What follows "attached to" is what the subject is attached TO; it must parse, and it is dropped.
  if (c.eat("attached", "to")) return object(c) !== null;
  // ", where X is the number of ...": the count of X tokens, a magnitude (parseSubject's COUNT_PHRASE).
  if (c.eat(",", "where", "x", "is") || c.eat("where", "x", "is")) { c.i = c.t.length; return true; }
  // A count is a magnitude, not a class: "a Treasure token for each opponent".
  if (c.eat("for", "each")) { const rest = c.t.slice(c.i).join(" "); c.i = c.t.length; return parse(rest) !== null || parse(`a ${rest}`) !== null; }
  // A targeting restriction nothing models: refuse the subject outright (`SubjectFilter.restricted`).
  if (c.eat("that", "targets", "only") || c.eat("that", "target", "only")) { r.restricted = true; c.i = c.t.length; return true; }
  // WHAT THE SPELL TARGETS (CR 115.1; owner 2026-10-01): "a spell that targets this creature" is
  // the "becomes the target of a spell" condition, carried as `targets`. "this <noun>" and "~" are
  // the card itself; anything else is a filter phrase of its own, and must parse completely.
  if (c.eat("that", "targets") || c.eat("that", "target")) {
    // After a second noun phrase the clause binds only the last one.
    if (r.restarted) return null;
    if (c.eat("~")) r.targets = { self: true };
    else if (c.eat("this")) {
      const x = reading();
      while (!c.done && nominalWord(c, x) === true);
      if (!c.done) return null;
      const t = lower(x);
      if (!t || t.type === undefined && t.subtype === undefined) return null;
      r.targets = { self: true, ...(t.type !== undefined ? { type: t.type } : {}), ...(t.subtype !== undefined ? { subtype: t.subtype } : {}) };
    } else {
      const rest = c.t.slice(c.i).join(" ");
      const t = parse(rest);
      if (!t) return null;
      c.i = c.t.length;
      r.targets = t;
    }
    return true;
  }
  return null;
}

/** An object phrase, consuming the cursor to the end; null when anything is left unread. */
function object(c: Cursor): Reading | null {
  const r = reading();
  quantifier(c, r);
  const n = nominal(c, r);
  // "any target", "any other target", "one or two targets": a target of any kind. The wildcard is
  // what `parseSubject` answers too: no class, scope target.
  if (n === false && (c.eat("targets") || r.target) && c.done) { r.target = true; return r; }
  if (n !== true) return null;
  while (!c.done) if (post(c, r) !== true) return null;
  return r;
}

// ---------------------------------------------------------------------------------------------
// Lowering to SubjectFilter

/** `parseScope`'s rule, read off the quantifier instead of the whole string. */
function scopeOf(r: Reading): SubjectFilter["scope"] {
  if (r.target) return "target";
  if (r.each) return "each";
  if (r.all || r.otherWord || r.plural) return "all";
  return undefined;
}

const inTypesOrder = (words: Iterable<string>) => {
  const set = new Set(words);
  return TYPES.filter((t) => set.has(t));
};

function lowerTypes(found: string[], notTypes: string[]) {
  const negated = CARD_TYPES.filter((t) => notTypes.includes(t));
  const { negationApplied: _n, ...r } = resolveTypes(inTypesOrder(found), negated);
  return r;
}

function lower(r: Reading): SubjectFilter | null {
  // A COLOUR THAT BELONGS TO ONE ALTERNATIVE. "a Swamp, Mountain, black permanent, or red permanent"
  // gives black to one branch and red to another, and `colors` binds every branch: the Swamp would
  // have to be black or red. Refused. Colours BEFORE the first noun are shared adjectives ("a white
  // or blue instant or sorcery spell") and fine.
  if (r.colorAfterHead && r.groups.filter((g) => g.types.length > 0 || g.subtypes.length > 0).length > 1) return null;
  // A ONE-VALUE ADJECTIVE IN ONE ALTERNATIVE ONLY. "target artifact or TAPPED creature", "target
  // tapped or blocking creature", "other snow and Zombie creatures": `tapped`, `snow` and the rest
  // bind the whole subject, so an adjective one alternative carries and another does not cannot be
  // said. Refused; "a multicolored creature or multicolored enchantment" says it in both and is fine.
  // An adjective before the FIRST noun of a noun list binds the whole list ("a multicolored instant
  // or sorcery spell"); one that stands alone as an alternative ("snow and Zombie creatures") does not.
  const leading = r.groups[0]!.adj.length > 0 && (r.groups[0]!.types.length > 0 || r.groups[0]!.subtypes.length > 0)
    && r.groups.slice(1).every((g) => g.adj.length === 0) && !r.restarted;
  if (r.groups.length > 1 && r.groups.some((g) => g.adj.length) && !leading
    && new Set(r.groups.map((g) => [...g.adj].sort().join())).size > 1) return null;
  // A ZONE BINDS THE NOUN BEFORE IT, NOT EVERY ALTERNATIVE. "target spell, nonland permanent, or card
  // in a graveyard" puts only the card in a graveyard; one `zone` on the subject would put the spell
  // and the permanent there too. Refused when the alternatives' heads differ. An alternative with no
  // head of its own takes the head after it ("an instant or sorcery card").
  if ((r.zone || r.fromZone) && r.groups.length > 1) {
    const heads: string[] = [];
    let next: string | undefined;
    for (const g of [...r.groups].reverse()) heads.push(next = g.head ?? next ?? "object");
    if (new Set(heads).size > 1) return null;
  }
  // An ability is not a card: a phrase naming both ("target spell, activated ability, or triggered
  // ability") is an OR across kinds of object the schema cannot say.
  if (r.ability && (r.groups.some((g) => g.types.length || g.subtypes.length) || r.token !== null)) return null;
  if (!r.ability && r.abilityKinds.length) return null;
  const out: SubjectFilter = { control: r.control ?? "any", token: r.token };
  if (r.abilityKinds.length) out.abilityKind = r.abilityKinds as NonNullable<SubjectFilter["abilityKind"]>;
  if (r.owner) out.owner = r.owner;
  const allTypeWords = r.groups.flatMap((g) => g.types);
  const subtypes = [...new Set(r.groups.flatMap((g) => g.subtypes))];
  const { type, notType, umbrella } = lowerTypes(allTypeWords, r.notTypes);
  if (type !== undefined) out.type = type;
  if (notType?.length) out.notType = notType;
  if (umbrella) out.umbrella = umbrella;
  // A compound noun: two concrete card types in ONE group, in the order printed.
  const compound = r.groups.map((g) => [...new Set(g.types.filter((t) => (CARD_TYPES as readonly string[]).includes(t)))]).find((ts) => ts.length >= 2);
  if (compound) out.allTypes = compound.slice(0, 2);
  if (subtypes.length) out.subtype = subtypes.length === 1 ? subtypes[0] : subtypes;
  if (r.notSubtypes.length) out.notSubtype = r.notSubtypes;
  // A CROSS-SLOT OR: one alternative names only a type, another only a subtype. The outer subject
  // keeps what every alternative shares; each branch keeps what differs. Plain alternatives of the
  // same slot share one branch, as `orBranches` builds them ("a Mutant, Ninja, Turtle, or land card").
  if (out.type !== undefined && out.subtype !== undefined && r.groups.length > 1
    && r.groups.some((g) => g.types.length > 0 && g.subtypes.length === 0)
    && r.groups.some((g) => g.subtypes.length > 0 && g.types.length === 0)) {
    delete out.type; delete out.subtype; delete out.allTypes;
    const branches: Partial<SubjectFilter>[] = [];
    let types: string[] | undefined, subs: string[] | undefined;
    for (const g of r.groups) {
      const cmp = [...new Set(g.types.filter((x) => (CARD_TYPES as readonly string[]).includes(x)))];
      if (g.subtypes.length === 0 && g.types.length > 0 && cmp.length < 2) {
        if (!types) branches.push({ type: types = [] });
        types.push(...g.types);
      } else if (g.types.length === 0 && g.subtypes.length > 0) {
        if (!subs) branches.push({ subtype: subs = [] });
        for (const x of g.subtypes) if (!subs.includes(x)) subs.push(x);
      } else if (g.types.length > 0) {
        branches.push({
          type: lowerTypes(g.types, []).type!,
          ...(cmp.length >= 2 ? { allTypes: cmp.slice(0, 2) } : {}),
          ...(g.subtypes.length ? { subtype: g.subtypes.length === 1 ? g.subtypes[0] : g.subtypes } : {}),
        });
      }
    }
    for (const b of branches) {
      if (Array.isArray(b.type)) b.type = lowerTypes(b.type, []).type!;
      if (Array.isArray(b.subtype) && b.subtype.length === 1) b.subtype = b.subtype[0];
    }
    out.anyOf = branches;
  }
  const scope = scopeOf(r);
  if (scope) out.scope = scope;
  if (r.other) out.other = true;
  if (r.colors.size) out.colors = WUBRG.filter((c) => r.colors.has(c));
  if (r.stats.length) out.stats = r.stats;
  if (r.statAlternatives) {
    if (out.anyOf) return null;
    out.anyOf = r.statAlternatives.map((p) => ({ stats: [p] }));
  }
  if (r.keywords.length) out.keyword = [...new Set(r.keywords)].sort();
  if (r.notKeywords.length) out.notKeyword = [...new Set(r.notKeywords)].sort();
  if (r.counter) out.counter = r.counter;
  if (r.combat) out.combat = r.combat;
  if (r.legendary !== undefined) out.legendary = r.legendary;
  if (r.basic !== undefined) out.basic = r.basic;
  if (r.snow) out.snow = true;
  if (r.tapped !== undefined) out.tapped = r.tapped;
  if (r.notColors.length) out.notColors = WUBRG.filter((x) => r.notColors.includes(x));
  if (r.colorCount) out.colorCount = r.colorCount;
  if (r.hasCounter) out.hasCounter = true;
  if (r.targets) out.targets = r.targets;
  if (r.historic) out.historic = true;
  if (r.outlaw) out.outlaw = true;
  if (r.modified) out.modified = true;
  if (r.prepared) out.prepared = true;
  if (r.commander) out.commander = true;
  if (r.chosenType) out.chosenType = true;
  if (r.restricted) out.restricted = true;
  if (r.named) out.named = r.named;
  if (r.fromZone) out.fromZone = r.fromZone;
  if (r.zone) out.zone = r.zone;
  return out;
}

// ---------------------------------------------------------------------------------------------
// Entry point

/** The filter a subject phrase denotes, or `null` when the grammar did not understand all of it. */
export function parse(text: string): SubjectFilter | null {
  // A TOKEN'S QUOTED ABILITY ("a 1/1 Rat creature token with \"This token can't block.\"") is
  // rules text the token has, not a class it belongs to. Read past, after "with" or "and".
  // CEILING: the ability is not kept; a demand on a granted ability would need it.
  if (/\btokens?\b/i.test(text)) text = text.replace(/\s+(?:and|with)\s+"[^"]*"/g, "").replace(/,?\s+and\s+"[^"]*"/g, "");
  const toks = lex(text);
  if (!toks || toks.length === 0) return null;
  // "Enchant creature you control": the keyword line names the class the Aura can enchant
  // (CR 303.4a), and that class is a filter phrase like any other.
  if (toks[0] === "enchant" && toks.length > 1) return parse(toks.slice(1).join(" "));
  // "Marit Lage, a legendary 20/20 black Avatar creature token with flying": the token's own name, then
  // the token. The name is the token's, never a card to look for (CR 111.4), so it is read past.
  const appos = toks.indexOf(",");
  // Only a NAME stands before the comma: "a Blood token, a Clue token" is a list, not a named token.
  if (appos > 0 && (toks[appos + 1] === "a" || toks[appos + 1] === "an") && toks.slice(appos).some((w) => w === "token" || w === "tokens")
    && parse(toks.slice(0, appos).join(" ")) === null) {
    const tail = parse(toks.slice(appos + 1).join(" "));
    if (tail?.token === true) return tail;
  }
  const spellNoun = toks.some((w) => /^(?:spells?|instants?|sorcery|sorceries|cards?)$/.test(w));
  const asPlayer = player(new Cursor(toks, spellNoun));
  if (asPlayer) return asPlayer;
  const r = object(new Cursor(toks, spellNoun));
  if (r) return lower(r);
  return nounPhraseList(toks);
}

/** Where a new noun phrase can start after "and" / "or": its determiner. */
const NP_START = new Set(["a", "an", "target", "each", "another", "up", "all", "other", "any", "one", "two", "three", "x", "your"]);

const stableJson = (v: unknown): string => Array.isArray(v) ? `[${v.map(stableJson).join(",")}]`
  : v && typeof v === "object" ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`).join(",")}}`
  : JSON.stringify(v);

/** A LIST OF WHOLE NOUN PHRASES: "target creature you control and target creature you don't
 *  control", "another creature you control or a land you control", "Skeletons you control and other
 *  Zombies you control". Each phrase must parse on its own; the subject is their union -- what every
 *  phrase says stays on the outer subject, what differs goes into one `anyOf` branch per phrase. A
 *  phrase naming a player ("each creature and each player") or carrying its own `anyOf` is refused:
 *  the schema has no player branch, and branches do not nest. */
function nounPhraseList(toks: string[]): SubjectFilter | null {
  const parts: string[][] = [];
  let from = 0;
  // Never inside a relative clause: "a spell that targets an opponent OR a creature ..." lists what
  // the spell targets, not two subjects.
  const relative = toks.findIndex((w) => w === "that" || w === "that's" || w === "who" || w === "which");
  for (let k = 1; k < (relative < 0 ? toks.length : relative) - 1; k++) {
    const joiner = toks[k] === "and" || toks[k] === "or" || toks[k] === "and/or";
    if (!joiner || !NP_START.has(toks[k + 1]!)) continue;
    const end = toks[k - 1] === "," ? k - 1 : k;
    parts.push(toks.slice(from, end));
    from = k + 1;
  }
  if (parts.length === 0) return null;
  parts.push(toks.slice(from));
  const parsed = parts.map((p) => parse(p.join(" ")));
  if (parsed.some((f) => !f || f.anyOf || (f.type === undefined && f.subtype === undefined))) return null;
  const fs = parsed as SubjectFilter[];
  const keys = new Set(fs.flatMap((f) => Object.keys(f)));
  const out: Record<string, unknown> = {};
  const differ: string[] = [];
  for (const k of keys) {
    const vals = fs.map((f) => stableJson((f as unknown as Record<string, unknown>)[k]));
    if (vals.every((v) => v === vals[0]) && (fs[0] as unknown as Record<string, unknown>)[k] !== undefined) out[k] = (fs[0] as unknown as Record<string, unknown>)[k];
    else differ.push(k);
  }
  if (out.control === undefined) out.control = "any";
  if (out.token === undefined) out.token = null;
  const branches: Partial<SubjectFilter>[] = [];
  for (const f of fs) {
    const b = Object.fromEntries(differ.filter((k) => (f as unknown as Record<string, unknown>)[k] !== undefined)
      .map((k) => [k, (f as unknown as Record<string, unknown>)[k]])) as Partial<SubjectFilter>;
    if (!branches.some((x) => stableJson(x) === stableJson(b))) branches.push(b);
  }
  // A phrase that adds nothing to the shared fields already admits everything the outer subject does,
  // so the union IS the outer subject ("target creature and another target creature").
  if (branches.length > 1 && !branches.some((b) => Object.keys(b).length === 0)) {
    // Alternatives that differ only in card type are a type OR-list, which is how the rest of the
    // schema says it ("each creature and each planeswalker").
    if (branches.every((b) => Object.keys(b).length === 1 && b.type !== undefined)) {
      out.type = lowerTypes(branches.flatMap((b) => (Array.isArray(b.type) ? b.type : [b.type!])), []).type;
    } else out.anyOf = branches;
  }
  return out as unknown as SubjectFilter;
}
