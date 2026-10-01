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
 *  apostrophes and hyphens: "opponent's", "non-dragon", "assembly-worker"), or a comma. Anything
 *  else — a period, a colon, a parenthesis, the "~" of a self-reference — fails the lex, and a
 *  phrase that does not lex does not parse. */
const TOKEN = /\{[^}\s]{1,8}\}|[+-]?(?:\d{1,3}|x|\*)\/[+-]?(?:\d{1,3}|x|\*)|\d{1,3}|and\/or|[a-z][a-z'-]*|,/y;

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
  combat?: "attacking" | "blocking";
  legendary: boolean;
  basic: boolean;
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
  token: null, groups: [{ types: [], subtypes: [] }], plural: false, target: false, each: false,
  all: false, other: false, otherWord: false, notTypes: [], notSubtypes: [], colors: new Set(), colorAfterHead: false, stats: [], ability: false, abilityKinds: [],
  keywords: [], notKeywords: [], legendary: false, basic: false, historic: false, outlaw: false,
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
    if (c.eat("each") || c.eat("every")) { r.each = true; continue; }
    if (c.eat("all")) { r.all = true; continue; }
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
    // "attacking or blocking" is either, and `combat` holds one: refused, not narrowed to one half.
    case "attacking": if (r.combat === "blocking") return null; r.combat = "attacking"; c.i++; return true;
    case "blocking": if (r.combat === "attacking") return null; r.combat = "blocking"; c.i++; return true;
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
    // nonbasic, nonlegendary, nonhistoric, non-outlaw, nonattacking...: an inverse the schema
    // cannot say. `parseSubject` drops these, which widens the claim.
    return null;
  }
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
    const joined = (c.eat(",") && (c.eat("or") || c.eat("and") || c.eat("and/or") || true))
      || c.eat("or") || c.eat("and/or") || c.eat("and");
    if (!joined) return any;
    // "a" / "an" may restart after a joiner: "an artifact or an enchantment".
    const restart = c.eat("a") || c.eat("an");
    const before = c.i;
    // An article closes the alternative before it: "an artifact or a card" is two noun phrases.
    const prev = r.groups[r.groups.length - 1]!;
    if (restart && !prev.head) prev.head = prev.types.at(-1) ?? prev.subtypes.at(-1) ?? "object";
    r.groups.push({ types: [], subtypes: [] });
    const next = nominalWord(c, r);
    if (next === null) return null;
    if (!next) { r.groups.pop(); c.i = save; return any; }
    if (c.i === before) return null;
  }
}

/** The STAT comparisons `STAT_RE` reads, and the parity Void Winnower prints. */
function stat(c: Cursor, r: Reading): boolean {
  const save = c.i;
  const metric = c.eat("mana", "value") ? "mana-value" : c.eat("power") ? "power" : c.eat("toughness") ? "toughness" : undefined;
  if (metric) {
    const n = c.peek();
    if (n !== undefined && /^\d+$/.test(n)) {
      c.i++;
      if (c.eat("or", "less") || c.eat("or", "fewer") || c.eat("or", "lower")) { r.stats.push({ metric, op: "lte", value: Number(n) }); return true; }
      if (c.eat("or", "greater") || c.eat("or", "more") || c.eat("or", "higher")) { r.stats.push({ metric, op: "gte", value: Number(n) }); return true; }
    }
  } else if (c.eat("an", "odd", "mana", "value") || c.eat("odd", "mana", "values")) {
    r.stats.push({ metric: "mana-value", op: "odd" }); return true;
  } else if (c.eat("an", "even", "mana", "value") || c.eat("even", "mana", "values")) {
    r.stats.push({ metric: "mana-value", op: "even" }); return true;
  }
  c.i = save;
  return false;
}

/** "flying", "flying and vigilance": keywords joined by "and", longest first. */
function keywordList(c: Cursor): string[] | undefined {
  const out: string[] = [];
  do {
    const k = KEYWORD_WORDS.find((ws) => ws.every((w, j) => c.peek(j) === w));
    if (!k) return undefined;
    c.i += k.length;
    out.push(k.join(" "));
  } while (c.eat("and"));
  return out;
}

/** "with a +1/+1 counter on it", "with one or more oil counters on it". The kind must be one the
 *  counter dictionary knows: "with a counter on it" says no kind, and refusing it beats dropping it. */
function counterPhrase(c: Cursor, r: Reading): boolean {
  const save = c.i;
  if (!c.eat("a") && !c.eat("an")) c.eat("one", "or", "more");
  const start = c.i;
  while (!c.done && c.peek() !== "counter" && c.peek() !== "counters") c.i++;
  const kind = counterKindOf(c.t.slice(start, c.i).join(" "));
  if (kind && (c.eat("counter") || c.eat("counters"))) {
    if (!c.eat("on", "it")) c.eat("on", "them");
    r.counter = kind; return true;
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
  [["target", "player's"], undefined], [["a"], undefined], [["the"], undefined],
];
const ZONES = new Set(["graveyard", "exile", "library", "hand"]);

function zonePhrase(c: Cursor, r: Reading): boolean {
  const save = c.i;
  const from = c.eat("from");
  if (!from && !c.eat("in")) return false;
  let owner: Control | undefined;
  for (const [ws, ctl] of ZONE_OWNERS) if (c.eat(...ws)) { owner = ctl; break; }
  const z = c.peek();
  if (z === undefined || !ZONES.has(z)) { c.i = save; return false; }
  c.i++;
  if (from) r.fromZone = z; else r.zone = z;
  if (owner) r.control = owner;
  return true;
}

/** "named Rite of Flame": the name runs to the end, a comma, or the words that end it in
 *  `parseSubject`'s NAMED. */
const NAME_ENDS = new Set(["in", "on", "from", "under", "with", "that", "you", "a", "an", "to", ","]);

function post(c: Cursor, r: Reading): boolean | null {
  for (const [ws, ctl] of CONTROLLERS) if (c.eat(...ws)) { r.control = ctl; return true; }
  if (c.eat("you", "own")) { r.owner = "you"; return true; }
  // Who CASTS a spell is who controls it (CR 112.2).
  if (c.eat("you", "cast")) { r.control = "you"; return true; }
  if (c.eat("an", "opponent", "casts") || c.eat("your", "opponents", "cast") || c.eat("opponents", "cast")) { r.control = "opp"; return true; }
  // Words that do not narrow the class: whose choice it is, chance, and the default zone.
  if (c.eat("of", "their", "choice") || c.eat("of", "your", "choice") || c.eat("of", "an", "opponent's", "choice")
    || c.eat("at", "random") || c.eat("on", "the", "battlefield") || c.eat("from", "anywhere")) return true;
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
    if (!r.tokenHead) r.named = c.t.slice(start, c.i).join(" ");
    return true;
  }
  if (c.eat("of", "the", "chosen")) {
    if (c.eat("type") || c.eat("color") || c.eat("colour") || c.eat("creature", "type")) { r.chosenType = true; return true; }
    return null;
  }
  // What follows "attached to" is what the subject is attached TO; it must parse, and it is dropped.
  if (c.eat("attached", "to")) return object(c) !== null;
  // A count is a magnitude, not a class: "a Treasure token for each opponent".
  if (c.eat("for", "each")) { const rest = c.t.slice(c.i).join(" "); c.i = c.t.length; return parse(rest) !== null || parse(`a ${rest}`) !== null; }
  // A targeting restriction nothing models: refuse the subject outright (`SubjectFilter.restricted`).
  if (c.eat("that", "targets", "only") || c.eat("that", "target", "only")) { r.restricted = true; c.i = c.t.length; return true; }
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
  if (r.keywords.length) out.keyword = [...new Set(r.keywords)].sort();
  if (r.notKeywords.length) out.notKeyword = [...new Set(r.notKeywords)].sort();
  if (r.counter) out.counter = r.counter;
  if (r.combat) out.combat = r.combat;
  if (r.legendary) out.legendary = true;
  if (r.basic) out.basic = true;
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
  const toks = lex(text);
  if (!toks || toks.length === 0) return null;
  const spellNoun = toks.some((w) => /^(?:spells?|instants?|sorcery|sorceries|cards?)$/.test(w));
  const asPlayer = player(new Cursor(toks, spellNoun));
  if (asPlayer) return asPlayer;
  const r = object(new Cursor(toks, spellNoun));
  return r ? lower(r) : null;
}
