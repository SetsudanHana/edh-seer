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
import type { Control, PlayerCondition, StatPredicate, SubjectFilter } from "../schema.js";
import { CARD_TYPES, TYPES, counterKindOf, resolveTypes, singulars } from "../derive/subject.js";
import { KEYWORD_ABILITIES, SPELL_SUBTYPES, SUBTYPE_TYPES, SUBTYPES } from "../derive/subtypes.js";

// ---------------------------------------------------------------------------------------------
// Lexer

/** A mana symbol, a printed size or counter ("1/1", "+1/+1"), a number, a word (with its
 *  apostrophes and hyphens: "opponent's", "non-dragon", "assembly-worker"), a comma, or "~", the
 *  card's own name, which only a "that targets" clause reads. Anything else — a period, a colon, a
 *  parenthesis — fails the lex, and a phrase that does not lex does not parse. */
const TOKEN = /\{[^}\s]{1,8}\}|[+-]?(?:\d{1,3}|x|\*)\/[+-]?(?:\d{1,3}|x|\*)|\d{1,3}|and\/or|[a-z][a-z'-]*|[,;:]|~/y;

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

/** Statuses and designations a filter can demand (CR 110.5 and the keyword actions that mark an
 *  object). Closed: a word not here is not read as one. */
const STATUSES = new Set(["face-down", "face-up", "enchanted", "equipped", "blocked", "unblocked", "goaded", "suspected",
  "kicked", "renowned", "monstrous", "double-faced", "modal", "saddled", "suspended", "fortified", "unpaired", "paired", "warped"]);

/** "this turn" histories, as word sequences after an optional "that" / "that was" / "that were". */
const HISTORIES: ReadonlyArray<readonly [string[], string]> = [
  [["dealt", "damage", "by", "this", "creature"], "dealt-damage-by-self"], [["dealt", "damage", "by", "~"], "dealt-damage-by-self"],
  [["dealt", "damage", "by", "enchanted", "creature"], "dealt-damage-by-ref"], [["dealt", "damage", "by", "equipped", "creature"], "dealt-damage-by-ref"],
  [["dealt", "combat", "damage", "to", "you"], "dealt-combat-damage-to-you"], [["dealt", "damage", "to", "you"], "dealt-damage-to-you"],
  [["dealt", "damage"], "dealt-damage"], [["dealt", "combat", "damage"], "dealt-combat-damage"],
  [["put", "there", "from", "the", "battlefield"], "put-into-graveyard-from-battlefield"],
  [["put", "there", "from", "anywhere"], "put-into-graveyard"], [["put", "there", "from", "your", "library"], "put-into-graveyard-from-library"],
  [["put", "there", "from", "their", "library"], "put-into-graveyard-from-library"], [["put", "there", "from", "a", "library"], "put-into-graveyard-from-library"],
  [["put", "into", "your", "graveyard", "from", "the", "battlefield"], "put-into-graveyard-from-battlefield"],
  [["entered", "the", "battlefield"], "entered"], [["entered"], "entered"], [["enter"], "entered"], [["attacked"], "attacked"], [["blocked"], "blocked"],
  [["died", "under", "your", "control"], "died"], [["died"], "died"], [["milled"], "milled"], [["turned", "face", "up"], "turned-face-up"],
  [["cast"], "cast"], [["crewed", "it"], "crewed-ref"], [["saddled", "it"], "saddled-ref"],
  [["blocked", "this", "creature"], "blocked-self"], [["dealt", "damage", "to", "this", "creature"], "dealt-damage-to-self"],
  [["dealt", "damage", "to", "it"], "dealt-damage-to-ref"], [["attacked", "you"], "attacked-you"],
  [["was", "put", "there"], "put-into-graveyard"], [["put", "there"], "put-into-graveyard"],
  [["didn't", "attack"], "not-attacked"], [["didn't", "enter"], "not-entered"], [["blocked", "or", "was", "blocked"], "blocked-or-was-blocked"],
  [["blocked", "or", "were", "blocked"], "blocked-or-was-blocked"], [["attacked", "or", "blocked"], "attacked-or-blocked"],
];

/** What a player did this turn ("who lost life this turn"). */
const PLAYER_HISTORIES: ReadonlyArray<readonly [string[], string]> = [
  [["lost", "life"], "lost-life"], [["gained", "life"], "gained-life"], [["attacked"], "attacked"],
  [["was", "dealt", "combat", "damage"], "dealt-combat-damage"], [["was", "dealt", "damage"], "dealt-damage"],
  [["cast", "a", "spell"], "cast"], [["cast", "one", "or", "more", "sorcery", "spells"], "cast-sorcery"],
];

const ROLE_NAMES = [["young", "hero"], ["monster"], ["wicked"], ["sorcerer"], ["royal"], ["cursed"], ["virtuous"]];

const COLOR_WORDS: Record<string, string> = {
  white: "W", blue: "U", black: "B", red: "R", green: "G", colorless: "C", colourless: "C",
};
const WUBRG = ["W", "U", "B", "R", "G", "C"];

const NUMBERS = new Set([
  "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "x",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty",
]);
const isNumber = (w: string | undefined) => w !== undefined && (NUMBERS.has(w) || /^\d+$/.test(w));
const WORD_VALUES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen"];
/** The value of a number word or digits; undefined for X and anything else. */
const numberValue = (w: string | undefined) => w === undefined ? undefined : /^\d+$/.test(w) ? Number(w) : WORD_VALUES.indexOf(w) >= 0 ? WORD_VALUES.indexOf(w) : undefined;

/** Keyword abilities, longest first, as word lists — "first strike" before any one-word keyword. */
const KEYWORD_WORDS = [...KEYWORD_ABILITIES].sort((a, b) => b.length - a.length).map((k) => k.split(" "));

/** The subtype a word names, if any. A SPELL subtype ("Arcane", "Lesson") counts only when the
 *  phrase has a spell noun, the same guard `parseSubtypes` has: "lesson" and "trap" are English. */
function subtypeOf(w: string, spellNoun: boolean): { subtype: string; plural: boolean } | undefined {
  // Plurals `singulars` does not form.
  const irregular = ({ mice: "mouse", pegasi: "pegasus", oxen: "ox" } as Record<string, string>)[w];
  if (irregular) return { subtype: irregular, plural: true };
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
  /** A noun (a card type, "card", "token") was read: only another noun may follow in this
   *  alternative. "creatures BLOCKING enchanted creature" is a participle with an object, not more
   *  adjectives. */
  nounSeen?: boolean;
  /** This alternative is an ability ("activated ability"), with the kinds it names. */
  ability?: boolean;
  kinds?: string[];
  /** The one-value adjectives this alternative carries ("tapped", "nonblack", "snow", "nonbasic",
   *  "multicolored"): the subject has one field for each, so it must say the same in every
   *  alternative or the phrase is refused. */
  adj: string[];
  /** The head noun this alternative names itself ("card", "spell", "permanent"), or that its own
   *  article makes its last type word ("an artifact or a card": "artifact"). Unset when it shares the
   *  head of the alternative after it ("an instant or sorcery CARD"). */
  head?: string;
  /** Where this alternative's words sit in the cursor's tokens, and which of them are adjectives
   *  (colours included): `perAlternative` re-reads each alternative from them. */
  from?: number; to?: number; adjAt?: number[];
}

/** What the words said, before it is lowered to a `SubjectFilter`. */
interface Reading {
  /** The tokens the groups' positions index. */
  toks?: readonly string[];
  control?: Control;
  owner?: "you" | "opp";
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
  snow?: boolean;
  notColors: string[];
  colorCount?: SubjectFilter["colorCount"];
  hasCounter?: boolean;
  allColors?: string[];
  targets?: Partial<SubjectFilter>;
  /** "power or toughness N or less": the two stats as alternatives, lowered to `anyOf`. */
  statAlternatives?: StatPredicate[];
  status: string[];
  notStatus: string[];
  notCast?: true;
  except?: Partial<SubjectFilter>[];
  history: string[];
  shares?: SubjectFilter["shares"];
  nameRelation?: SubjectFilter["nameRelation"];
  notNamed?: string;
  abilityOf?: Partial<SubjectFilter>;
  statusAlternatives?: string[];
  /** Some quantifier word was read ("a", "target", "each" ...): "enchanted creature" with none is
   *  a reference to the enchanted object, not a class. */
  determined: boolean;
  ownOrControl?: boolean;
  notFromZone?: string;
  combatWith?: SubjectFilter["combatWith"];
  condition?: PlayerCondition;
  printedIn?: string;
  otherThanRef?: true;
  sharesAlternatives?: NonNullable<SubjectFilter["shares"]>[];
  zoneAlternatives?: string[];
  zoneAlternativesFrom?: boolean;
  keywordAlternatives?: string[];
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
  keywords: [], notKeywords: [], notColors: [], restarted: false, status: [], notStatus: [], history: [], determined: false, historic: false, outlaw: false,
  modified: false, prepared: false, commander: false, chosenType: false, restricted: false,
  tokenHead: false,
});

class Cursor {
  i = 0;
  constructor(public t: readonly string[], readonly spellNoun: boolean) {}
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
  // "one or more of your opponents".
  if (c.eat("of", "your", "opponents")) { if (!c.done) return null; return { control: "opp", token: null, scope: "all" }; }
  if (c.eat("defending", "player") || c.eat("attacking", "player")) control = "opp";
  else if (c.eat("opponent")) control = "opp";
  else if (c.eat("opponents")) { control = "opp"; r.plural = true; }
  else if (c.eat("player")) control = r.control ?? "any";
  else if (c.eat("players")) { control = r.control ?? "any"; r.plural = true; }
  else return null;
  // "each opponent who lost life this turn", "target player who attacked this turn": a player with a
  // history this turn.
  let history: string | undefined;
  // "an opponent chosen at random": whose choice, not which player.
  c.eat("chosen", "at", "random");
  let condition: PlayerCondition | undefined;
  if (c.peek() === "who") {
    // Only when it ends the phrase: "who cast a spell this turn WITH THE SAME NAME ..." says more.
    const h = PLAYER_HISTORIES.find(([ws]) => ws.every((x, j) => c.peek(1 + j) === x) && c.peek(1 + ws.length) === "this" && c.peek(2 + ws.length) === "turn" && c.i + 3 + ws.length === c.t.length);
    if (h) { c.i += 1 + h[0].length + 2; history = h[1]; }
  }
  // "each player this creature attacked this turn".
  if (!history && c.eat("this", "creature", "attacked", "this", "turn")) history = "attacked-by-self";
  // "target player dealt damage by this creature this turn": a history said as a participle.
  if (!history && !c.done && (c.peek() === "dealt" || c.peek() === "previously")) {
    const x = reading();
    while (!c.done) if (post(c, x) !== true) return null;
    if (x.history.length !== 1) return null;
    history = x.history[0];
  }
  // "any number of target opponents each": the "each" distributes the action.
  if (c.peek() === "each" && c.i + 1 === c.t.length) c.i++;
  if (!history && !c.done) {
    // "target player who has more life than the first player AND IS THEIR OPPONENT": an opponent.
    if (c.t.slice(-4).join(" ") === "and is their opponent") control = "opp";
    condition = playerCondition(c) ?? undefined; if (!condition) return null;
  }
  if (!c.done) return null;
  const out: SubjectFilter = { control, token: null, ...(history ? { history: [history] } : {}), ...(condition ? { condition } : {}) };
  const scope = scopeOf(r);
  if (scope) out.scope = scope;
  if (r.other) out.other = true;
  return out;
}

/** Verbs a punisher clause names: "each opponent who doesn't SACRIFICE a permanent". */
const PUNISHER_VERBS = new Set(["discard", "sacrifice", "pay", "exile", "return", "reveal", "draw", "attack", "cast"]);

/** WHAT A PLAYER IS OR DID, after the player noun (see `SubjectFilter.condition`): "who controls the
 *  most creatures", "who doesn't control an Elf", "who has three or more poison counters", "with
 *  exactly 13 life", "who doesn't sacrifice a permanent", "who chose silence", "whose coin comes up
 *  tails". Must run to the end of the phrase; null otherwise. */
function playerCondition(c: Cursor, implicitWho = false): PlayerCondition | null {
  const rest = () => { const t = c.t.slice(c.i).join(" "); c.i = c.t.length; return t; };
  if (c.eat("whose", "coin", "comes", "up", "tails") || c.eat("whose", "coin", "comes", "up", "heads")) return c.done ? { kind: "coin" } : null;
  if (c.eat("with")) {
    if (c.eat("exactly")) { const v = numberValue(c.peek()); if (v !== undefined && c.peek(1) === "life") { c.i += 2; return c.done ? { kind: "count", what: "life", op: "eq", value: v } : null; } return null; }
    if (c.eat("no", "cards", "in", "hand")) return c.done ? { kind: "count", what: "hand", op: "eq", value: 0 } : null;
    if (c.eat("the", "most", "life")) { c.eat("among", "your", "opponents"); return c.done ? { kind: "count", what: "life", op: "eq", vs: "most" } : null; }
    return null;
  }
  if (!implicitWho && !c.eat("who")) return null;
  // "who was dealt combat damage by three or more Pirates this turn", "whose controller was dealt
  // combat damage by this creature this turn".
  {
    const save = c.i;
    const ev = c.eat("was", "dealt", "combat", "damage", "by") ? "dealt-combat-damage" : c.eat("was", "dealt", "damage", "by") ? "dealt-damage" : undefined;
    if (ev && c.t.at(-2) === "this" && c.t.at(-1) === "turn") {
      const by = c.t.slice(c.i, -2).join(" ");
      if (by === "this creature" || by === "~") { c.i = c.t.length; return { kind: "history", event: ev, by: "self" }; }
      // "three or more Pirates": a count of dealers, read as the class.
      const f = parse(by.replace(/^(?:\w+ or more|one or more) /, ""));
      if (f) { c.i = c.t.length; const { control: _c, token: _t, scope: _s, ...w } = f; return { kind: "history", event: ev, by: w }; }
    }
    c.i = save;
  }
  // "who voted for a choice you didn't vote for": a vote, as a choice.
  if (c.eat("voted", "for")) { const choice = c.t.slice(c.i).join(" "); c.i = c.t.length; return choice ? { kind: "chose", choice } : null; }
  // "who discarded a card that shares a card type with the card you discarded", "who cast a spell this
  // turn with the same name as that card": what the player did, and to what.
  for (const verb of ["discarded", "sacrificed", "cast"]) {
    const save = c.i;
    if (c.eat(verb)) {
      const rest = c.t.slice(c.i).filter((w, k, a) => !(w === "this" && a[k + 1] === "turn") && !(w === "turn" && a[k - 1] === "this"));
      const what = parse(rest.join(" "));
      if (what) { c.i = c.t.length; const { control: _c, token: _t, scope: _s, ...w } = what; return { kind: "did", verb, what: w }; }
    }
    c.i = save;
  }
  const negated = c.eat("doesn't") || c.eat("didn't") || c.eat("don't");
  const can = !negated && c.eat("can't");
  // "who controls a white creature", "who doesn't control an Elf", "who controls the most creatures",
  // "who controls more lands than you".
  if (c.eat("controls") || ((negated || can) && c.eat("control"))) {
    if (c.eat("more", "lands", "than", "you")) return c.done && !negated ? { kind: "count", what: "lands", op: "gt", vs: "you" } : null;
    const most = c.eat("the", "most");
    const what = parse(rest());
    if (!what) return null;
    const { scope: _s, token, control: _c, ...w } = what;
    return { kind: "controls", what: { ...w, ...(token !== null ? { token } : {}) }, ...(negated ? { negated: true as const } : {}), ...(most ? { most: true as const } : {}) };
  }
  if (negated && c.eat("have", "max", "speed")) return c.done ? { kind: "count", what: "speed", op: "lt", vs: "max" } : null;
  if (!negated && !can && (c.eat("has") || c.eat("have"))) {
    if (c.eat("more", "life", "than", "you")) { c.eat("do"); return c.done ? { kind: "count", what: "life", op: "gt", vs: "you" } : null; }
    // "who has more life than the first player and is their opponent": the opponent half is the
    // player phrase's own, said after the condition.
    if (c.eat("more", "life", "than", "the", "first", "player")) { c.eat("and", "is", "their", "opponent"); return c.done ? { kind: "count", what: "life", op: "gt", vs: "ref" } : null; }
    const v = numberValue(c.peek());
    if (v !== undefined && c.peek(1) === "or" && c.peek(2) === "more" && c.peek(3) === "poison" && c.peek(4) === "counters") { c.i += 5; return c.done ? { kind: "count", what: "poison", op: "gte", value: v } : null; }
    return null;
  }
  if (!negated && !can && c.eat("lost")) {
    const v = numberValue(c.peek());
    if (v !== undefined && c.eat(c.peek()!, "or", "more", "life", "this", "turn")) return c.done ? { kind: "count", what: "life-lost", op: "gte", value: v } : null;
    return null;
  }
  if (!negated && !can && c.eat("chose")) { const choice = rest(); return choice ? { kind: "chose", choice } : null; }
  // THE PUNISHER: "who doesn't sacrifice a permanent", "who can't discard", "who didn't": the
  // effect's own earlier choice, whoever made it.
  if (negated || can) {
    if (c.done) return negated && c.t[c.i - 1] === "didn't" ? { kind: "did", verb: "that", negated: true } : null;
    const verb = c.peek()!;
    if (!PUNISHER_VERBS.has(verb)) return null;
    c.i++;
    const base = { kind: "did" as const, verb, ...(negated ? { negated: true as const } : {}), ...(can ? { can: true as const } : {}) };
    if (c.done) return base;
    const what = parse(rest());
    if (!what) return null;
    const { scope: _s, token, control: _c, ...w } = what;
    return { ...base, what: { ...w, ...(token !== null ? { token } : {}) } };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Objects

/** Determiners and counts, in any order: "another target", "up to two target", "each other",
 *  "one or more", "any number of", "all". Records the quantifier; returns nothing. */
function quantifier(c: Cursor, r: Reading): void {
  const start = c.i;
  try { quantifierWords(c, r); } finally { if (c.i > start) r.determined = true; }
}

function quantifierWords(c: Cursor, r: Reading): void {
  for (;;) {
    // A possessive player before the noun: "target opponent's creature of their choice".
    if (c.eat("target", "opponent's") || c.eat("an", "opponent's") || c.eat("each", "opponent's")) { r.control = "opp"; continue; }
    if (c.eat("target", "player's")) continue;
    if (c.eat("a") || c.eat("an")) continue;
    if (c.eat("target")) { r.target = true; continue; }
    if (c.eat("another")) { r.other = true; continue; }
    if (c.eat("other")) { r.other = true; r.otherWord = true; continue; }
    // "each of up to two target creatures", "each of two targets".
    if (c.eat("each", "of") || c.eat("each") || c.eat("every")) { r.each = true; continue; }
    if (c.eat("all", "the") || c.eat("all")) { r.all = true; continue; }
    if (c.eat("your")) { r.control = "you"; continue; }
    if (c.eat("any", "number", "of") || c.eat("up", "to")) continue;
    // "two of three target creature cards": two chosen from three.
    if (isNumber(c.peek()) && c.peek(1) === "of" && isNumber(c.peek(2))) { c.i += 3; continue; }
    // "up to twice X target cards".
    if (c.eat("twice", "x")) continue;
    // "exactly two creatures", "at least two creatures": how many, not which.
    if (c.eat("exactly") || c.eat("at", "least")) continue;
    // "up to one hundred target creatures".
    if (c.eat("one", "hundred")) continue;
    // A count, or a list of them: "two", "one or more", "one or two", "one, two, or three".
    if (isNumber(c.peek())) {
      c.i++;
      while (c.eat("or", "more") || ((c.peek() === "," || c.peek() === "or") && (
        (isNumber(c.peek(1)) && (c.i += 2)) || (c.peek(1) === "or" && isNumber(c.peek(2)) && (c.i += 3)))));
      continue;
    }
    if (c.eat("any")) continue;
    // "a second target creature you control", "a third target": which one in order, not which kind.
    if (c.eat("second") || c.eat("third")) continue;
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
  if (g.nounSeen && !TYPE_WORDS.has(w) && !["card", "cards", "token", "tokens"].includes(w)) return false;
  const ty = TYPE_WORDS.get(w);
  if (ty) {
    g.nounSeen = true;
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
    case "token": r.token = true; r.tokenHead = true; g.nounSeen = true; c.i++; return true;
    case "tokens": r.token = true; r.tokenHead = true; r.plural = true; g.nounSeen = true; c.i++; return true;
    case "nontoken": r.token = false; c.i++; return true;
    case "card": case "cards": g.head = "card"; g.nounSeen = true; c.i++; return true;
    // "a source you control": any object that deals damage, so no type.
    case "source": case "sources": c.i++; return true;
    case "ability": case "abilities": r.ability = true; g.ability = true; c.i++; return true;
    case "activated": case "triggered": case "loyalty": case "mana":
      if (!r.abilityKinds.includes(w)) r.abilityKinds.push(w);
      (g.kinds ??= []).push(w);
      c.i++; return true;
    case "legendary": r.legendary = true; g.adj.push(w); c.i++; return true;
    case "basic": r.basic = true; g.adj.push(w); c.i++; return true;
    case "snow": r.snow = true; g.adj.push(w); c.i++; return true;
    // "an exiled card": a card in exile.
    case "exiled": r.zone = "exile"; c.i++; return true;
    // CR 110.5, a status.
    // "a tapped and attacking token": both states, one alternative.
    case "tapped": r.tapped = true; g.adj.push(w); c.i++; if (c.peek() === "and" && c.peek(1) === "attacking") { r.combat = "attacking"; c.i += 2; } return true;
    case "untapped": r.tapped = false; g.adj.push(w); c.i++; return true;
    case "multicolored": case "multicoloured": r.colorCount = "multi"; g.adj.push(w); c.i++; return true;
    case "monocolored": case "monocoloured": r.colorCount = "mono"; g.adj.push(w); c.i++; return true;
    // "attacking or blocking" is either, and `combat` holds one: refused, not narrowed to one half.
    // "attacking or blocking" is `in-combat` (CR 506.4), the state either way.
    case "attacking": r.combat = r.combat === "blocking" || r.combat === "in-combat" ? "in-combat" : "attacking"; g.adj.push("combat"); c.i++; return true;
    case "blocking": r.combat = r.combat === "attacking" || r.combat === "in-combat" ? "in-combat" : "blocking"; g.adj.push("combat"); c.i++; return true;
    case "historic": r.historic = true; g.adj.push(w); c.i++; return true;
    case "modified": r.modified = true; g.adj.push(w); c.i++; return true;
    case "outlaw": case "outlaws": r.outlaw = true; c.i++; return true;
    case "commander": case "commanders": r.commander = true; c.i++; return true;
    case "prepared": if (c.peek(1) === "spell" || c.peek(1) === "spells") { r.prepared = true; c.i++; return true; } return null;
  }
  // A STATUS or designation. "enchanted" and "equipped" only after a determiner: bare, "enchanted
  // creature" is the object the Aura is attached to -- a reference.
  if (STATUSES.has(w)) {
    if ((w === "enchanted" || w === "equipped") && !r.determined && r.groups.length === 1 && g.types.length === 0) return null;
    if (!r.status.includes(w)) r.status.push(w);
    g.adj.push(w); c.i++; return true;
  }
  if (w === "nonattacking" || w === "nonblocking") { r.notStatus.push(w.slice(3)); g.adj.push(w); c.i++; return true; }
  if (/^non-?[a-z]/.test(w)) {
    const rest = w.replace(/^non-?/, "");
    const neg = singulars(rest).find((s) => (CARD_TYPES as readonly string[]).includes(s));
    if (neg) { if (!r.notTypes.includes(neg)) r.notTypes.push(neg); if (rest !== neg) r.plural = true; c.i++; return true; }
    const sub = singulars(rest).find((s) => SUBTYPES.has(s));
    if (sub) { if (!r.notSubtypes.includes(sub)) r.notSubtypes.push(sub); c.i++; return true; }
    // "each non-Bolas planeswalker": a negated planeswalker subtype, before "planeswalker".
    if (SUBTYPE_TYPES[rest]?.includes("planeswalker") && (c.peek(1) === "planeswalker" || c.peek(1) === "planeswalkers")) {
      if (!r.notSubtypes.includes(rest)) r.notSubtypes.push(rest); c.i++; return true;
    }
    // "each noncommander creature": every one but the commanders.
    if (rest === "commander") { (r.except ??= []).push({ commander: true }); c.i++; return true; }
    if (rest === "outlaw") { (r.except ??= []).push({ outlaw: true }); c.i++; return true; }
    if (rest === "historic") { (r.except ??= []).push({ historic: true }); c.i++; return true; }
    if (COLOR_WORDS[rest]) { if (!r.notColors.includes(COLOR_WORDS[rest]!)) r.notColors.push(COLOR_WORDS[rest]!); g.adj.push(w); c.i++; return true; }
    if (rest === "basic") { r.basic = false; g.adj.push(w); c.i++; return true; }
    if (rest === "snow") { r.snow = false; g.adj.push(w); c.i++; return true; }
    if (rest === "legendary") { r.legendary = false; g.adj.push(w); c.i++; return true; }
    // nonhistoric, non-outlaw, nonattacking, nonsnow...: an inverse the schema cannot say.
    // `parseSubject` drops these, which widens the claim.
    return null;
  }
  // A KEYWORD ABILITY as the object: "an exhaust ability", "a ninjutsu ability", "an eternalize or embalm
  // ability" -- an ability, with the keyword it is.
  {
    const save = c.i;
    const ks = keywordList(c);
    // These keyword abilities are activated ones (exhaust, ninjutsu, boast, embalm, ...).
    const asAbility = () => { if (!r.abilityKinds.includes("activated")) r.abilityKinds.push("activated"); (g.kinds ??= []).push("activated"); };
    if (ks && (c.peek() === "ability" || c.peek() === "abilities")) { r.keywords.push(...ks); asAbility(); return true; }
    if (ks && c.peek() === "or") {
      c.i++; const more = keywordList(c);
      if (more && (c.peek() === "ability" || c.peek() === "abilities")) { r.keywordAlternatives = [...ks, ...more]; asAbility(); return true; }
    }
    c.i = save;
  }
  // A ROLE's own name ("a Wicked Role token", CR 111.10): the token's name, read past like any
  // token name (G2b); the class is the Role subtype.
  const role = ROLE_NAMES.find((ws) => ws.every((x, j) => c.peek(j) === x) && c.peek(ws.length) === "role");
  if (role) { c.i += role.length; return true; }
  if (w === "time" && (c.peek(1) === "lord" || c.peek(1) === "lords")) {
    g.subtypes.push("time lord"); if (c.peek(1) === "lords") r.plural = true; c.i += 2; return true;
  }
  // A PLANESWALKER subtype counts only right before "planeswalker" ("a Chandra planeswalker"): several
  // are English words, which is why SUBTYPES leaves them out.
  // ...or before "card" when it ends a list of subtypes ("an Elf, Warrior, or Tyvar card").
  if ((c.peek(1) === "planeswalker" || c.peek(1) === "planeswalkers"
    || ((c.peek(1) === "card" || c.peek(1) === "cards") && r.groups.length > 1 && r.groups.slice(0, -1).every((x) => x.subtypes.length && !x.types.length))
    // "a Jace": the planeswalker by its subtype alone, the whole phrase.
    || (c.i + 1 === c.t.length && r.determined && r.groups.length === 1 && !g.types.length && !g.subtypes.length && !g.adj.length))
    && SUBTYPE_TYPES[w]?.includes("planeswalker")) {
    if (!g.subtypes.includes(w)) g.subtypes.push(w); c.i++; return true;
  }
  const sub = subtypeOf(w, c.spellNoun);
  if (sub) { if (!g.subtypes.includes(sub.subtype)) g.subtypes.push(sub.subtype); if (sub.plural) r.plural = true; c.i++; return true; }
  return false;
}

/** The nominal: groups of words joined by "or", "and", "and/or" or commas. A joiner is taken only
 *  when a nominal word follows it, so "creatures you control and ..." is never swallowed. */
function nominal(c: Cursor, r: Reading): boolean | null {
  let any = false;
  const prevAll = c.t[c.i - 1] === "all";
  const word = () => {
    const i0 = c.i, adj0 = r.groups.at(-1)!.adj.length;
    const ok = nominalWord(c, r);
    if (ok) {
      const g = r.groups.at(-1)!;
      g.from ??= i0; g.to = c.i;
      if (g.adj.length > adj0 || COLOR_WORDS[c.t[i0] ?? ""]) for (let k = i0; k < c.i; k++) (g.adjAt ??= []).push(k);
    }
    return ok;
  };
  for (;;) {
    const ok = word();
    if (ok === null) return null;
    if (ok) { any = true; continue; }
    const save = c.i;
    // A BARE COMMA AFTER AN ADJECTIVE IS AN AND: "target nonartifact, nonblack creature" is one
    // creature with both, not two alternatives. A comma after a noun ("a Swamp, Mountain, ...") or
    // with "or"/"and" after it is a list.
    const cur = r.groups[r.groups.length - 1]!;
    // "target attacking, blocking, or tapped creature" goes on to ", or": a list after all.
    if (c.peek() === "," && !["or", "and", "and/or"].includes(c.peek(1) ?? "")
      && !(c.peek(2) === "," && ["or", "and"].includes(c.peek(3) ?? ""))
      && cur.types.length === 0 && cur.subtypes.length === 0 && any) {
      c.i++;
      const ok2 = word();
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
    // ", 4/4 Elemental creature" after a noun is what it BECOMES, not another alternative.
    if (c.peek() === "," && /^(?:\d+|x)\/(?:\d+|x)$/.test(c.peek(1) ?? "")) return any;
    const joined = (c.eat(",") && (c.eat("or") || c.eat("and") || c.eat("and/or") || true))
      || c.eat("or") || c.eat("and/or") || c.eat("and");
    if (!joined) return any;
    // "a" / "an" may restart after a joiner: "an artifact or an enchantment". So may "all" before a
    // colour: "all black and ALL red creature cards" are black or red creature cards.
    if (prevAll && c.peek() === "all" && COLOR_WORDS[c.peek(1) ?? ""]) c.i++;
    const restart = c.eat("a") || c.eat("an");
    const before = c.i;
    // An article closes the alternative before it: "an artifact or a card" is two noun phrases.
    const prev = r.groups[r.groups.length - 1]!;
    if (restart && !prev.head) prev.head = prev.types.at(-1) ?? prev.subtypes.at(-1) ?? "object";
    if (restart) r.restarted = true;
    r.groups.push({ types: [], subtypes: [], adj: [] });
    const next = word();
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
  // "the greatest power among creatures target opponent controls", "the least toughness among ...":
  // compared with a set named in the sentence.
  {
    const sup = c.eat("the", "greatest") ? "gte" : (c.eat("the", "least") || c.eat("the", "lowest")) ? "lte" : c.eat("the", "highest") ? "gte" : undefined;
    if (sup) {
      const m = metricWord(c);
      if (m && (c.done || c.eat("among"))) {
        if (!c.done) {
          // The subject is one of that set, so the set's controller is the subject's.
          const set = parse(c.t.slice(c.i).join(" "));
          if (!set) { c.i = save; return false; }
          c.i = c.t.length;
          if (set.control !== "any") r.control = set.control;
        }
        r.stats.push({ metric: m, op: sup, variable: true }); return true;
      }
      c.i = save; return false;
    }
  }
  // "power and toughness each equal to the number of ...": both, a variable amount.
  if (c.eat("power", "and", "toughness", "each", "equal", "to") || c.eat("base", "power", "and", "toughness", "each", "equal", "to")) {
    if (c.done) { c.i = save; return false; }
    c.i = variableRhsEnd(c);
    r.stats.push({ metric: "power", op: "eq", variable: true }, { metric: "toughness", op: "eq", variable: true });
    return true;
  }
  // "base power and toughness 2/2", "base power 1": the printed values, which is what stats compare.
  if (c.eat("base", "power", "and", "toughness")) {
    const pt = c.peek() ?? "";
    if (/^\d+\/\d+$/.test(pt)) { const [p, t] = pt.split("/").map(Number); r.stats.push({ metric: "power", op: "eq", value: p! }, { metric: "toughness", op: "eq", value: t! }); c.i++; return true; }
    c.i = save; return false;
  }
  if (c.peek() === "base" && (c.peek(1) === "power" || c.peek(1) === "toughness")) c.i++;
  if (c.eat("an", "odd", "mana", "value") || c.eat("odd", "mana", "values")) { r.stats.push({ metric: "mana-value", op: "odd" }); return true; }
  if (c.eat("an", "even", "mana", "value") || c.eat("even", "mana", "values")) { r.stats.push({ metric: "mana-value", op: "even" }); return true; }
  // "lesser power", "greater mana value", "equal or lesser toughness": compared with an object
  // named elsewhere in the sentence.
  const rel = c.eat("equal", "or", "lesser") ? "lte" : c.eat("equal", "or", "greater") ? "gte"
    : c.eat("lesser") ? "lt" : c.eat("greater") ? "gt" : undefined;
  if (rel) {
    const m = metricWord(c);
    if (m) {
      // "with lesser mana value than the creature that died": the object compared with, named.
      if (c.eat("than")) { if (c.done || c.t.slice(c.i).some((w) => RHS_VERBS.has(w) && w !== "died")) { c.i = save; return false; } c.i = c.t.length; }
      r.stats.push({ metric: m, op: rel, variable: true }); return true;
    }
    c.i = save; return false;
  }
  // "power, toughness, or mana value 4" / "mana value, power, or toughness equal to the chosen number".
  {
    const at0 = c.i;
    const ms: Metric[] = [];
    let m: Metric | undefined;
    while ((m = metricWord(c))) { ms.push(m); if (!(c.eat(",", "or") || c.eat(",") || c.eat("or"))) break; }
    if (ms.length >= 3) {
      const probe = reading();
      const rest = c.t.slice(c.i);
      const pc = new Cursor([...(ms[0] === "mana-value" ? ["mana", "value"] : [ms[0]!]), ...rest], c.spellNoun);
      if (stat(pc, probe) && probe.stats.length === 1 && !r.statAlternatives) {
        c.i += pc.i - (ms[0] === "mana-value" ? 2 : 1);
        r.statAlternatives = ms.map((x) => ({ ...probe.stats[0]!, metric: x }));
        return true;
      }
    }
    c.i = at0;
  }
  // "power or toughness 1 or less": either stat, so one branch per stat (`anyOf`).
  const at1 = c.i;
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
  c.i = at1;
  // "total mana value 3 or less": a sum no greater than N bounds each card by N.
  const total = c.eat("total");
  // "total power and toughness 5 or less": the same bound, on each of the two.
  if (total && c.peek() === "power" && c.peek(1) === "and" && c.peek(2) === "toughness" && /^\d+$/.test(c.peek(3) ?? "") && c.peek(4) === "or" && c.peek(5) === "less") {
    const value = Number(c.peek(3)); c.i += 6;
    r.stats.push({ metric: "power", op: "lte", value }, { metric: "toughness", op: "lte", value }); return true;
  }
  const metric = metricWord(c);
  if (!metric) { c.i = save; return false; }
  // "mana value 4, 5, or 6": a run of numbers with no gap is a range; a gap is refused.
  const nums: number[] = [];
  const at = c.i;
  while (/^\d+$/.test(c.peek() ?? "")) {
    nums.push(Number(c.peek())); c.i++;
    if (!(c.eat(",", "or") || c.eat(",", "and") || c.eat(",") || c.eat("or"))) break;
  }
  if (nums.length >= 2 && !(c.t[c.i - 1] === "or" || c.t[c.i - 1] === "," || c.t[c.i - 1] === "and")) {
    const sorted = [...nums].sort((a, b) => a - b);
    if (sorted.some((v, k) => k > 0 && v !== sorted[k - 1]! + 1)) { c.i = save; return false; }
    r.stats.push({ metric, op: "gte", value: sorted[0]! }, { metric, op: "lte", value: sorted.at(-1)! });
    return true;
  }
  c.i = at;
  const n = c.peek();
  if (n !== undefined && (/^\d+$/.test(n) || n === "x")) {
    c.i++;
    // "mana value X plus 1": still X's.
    if (n === "x" && c.peek() === "plus" && isNumber(c.peek(1))) c.i += 2;
    const base = n === "x" ? { variable: true as const } : { value: Number(n) };
    if (c.eat("or", "less") || c.eat("or", "fewer") || c.eat("or", "lower")) { r.stats.push({ metric, op: "lte", ...base }); return true; }
    // A sum the chosen objects reach together bounds none of them: kept as a total (the matcher abstains).
    const sum = total ? { total: true as const } : {};
    if (c.eat("or", "greater") || c.eat("or", "more") || c.eat("or", "higher")) { r.stats.push({ metric, op: "gte", ...base, ...sum }); return true; }
    // A bare number is an equality: "an instant card with mana value 1".
    r.stats.push({ metric, op: "eq", ...base, ...sum }); return true;
  }
  if (total && !(c.peek() === "less" || c.peek() === "greater" || c.peek() === "equal")) { c.i = save; return false; }
  // "power of the chosen quality" (odd or even, chosen as it resolves).
  if (c.eat("of", "the", "chosen", "quality")) { r.stats.push({ metric, op: "eq", variable: true }); return true; }
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
  // A named object's stat ("Narset's power", "Loki's power") or "your life total" is an amount too.
  const named = rhs.some((w) => /'s$/.test(w)) && /^(?:power|toughness|loyalty|mana)$/.test(rhs.at(-1) ?? rhs.at(-2) ?? "");
  // "Mirko's" alone, "his power": another object's stat too.
  const possessive = (rhs.length === 1 && /'s$/.test(rhs[0]!)) || ((rhs[0] === "his" || rhs[0] === "her") && rhs.length === 2);
  // "the number of experience counters YOU HAVE" counts what you have: no clause.
  const verbs = rhs.filter((w, k) => RHS_VERBS.has(w) && !(w === "have" && rhs[k - 1] === "you" && k === rhs.length - 1));
  if (!named && !possessive && !/^(?:the|that|this|its|their|your|x|\d+|twice|half)$/.test(rhs[0] ?? "")
    || verbs.length) { c.i = save; return false; }
  c.i = end;
  r.stats.push({ metric, op, variable: true, ...(total ? { total: true as const } : {}) });
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
    // A keyword's cost: "ward {2}", "equip {0}", "cumulative upkeep {G}".
    else while (/^\{[^}]+\}$/.test(c.peek() ?? "")) c.i++;
    out.push(k.join(" "));
    // A joiner continues the list only before another keyword: "flying AND it isn't legendary" ends it.
  } while ([[",", "and"], ["and"], [","]].some((j) => KEYWORD_WORDS.some((ws) => ws.every((w, k) => c.peek(j.length + k) === w)) && c.eat(...j)));
  return out;
}

/** "with a +1/+1 counter on it", "with one or more oil counters on it". The kind must be one the
 *  counter dictionary knows: "with a counter on it" says no kind, and refusing it beats dropping it. */
function counterPhrase(c: Cursor, r: Reading): boolean {
  const save = c.i;
  if (!c.eat("a") && !c.eat("an")) c.eat("one", "or", "more");
  const start = c.i;
  while (!c.done && c.peek() !== "counter" && c.peek() !== "counters") c.i++;
  // No words before "counter" is no kind: "with a counter on it" (`hasCounter`). One plain word the
  // dictionary lacks is still a named counter ("an impostor counter"): kept as its own kind, which
  // only that kind meets.
  const words = c.t.slice(start, c.i);
  // The kind is a few words with no clause in them: "with flying, where X is the number of COUNTERS"
  // is a keyword, then a count.
  if (words.length > 3 || words.some((w) => w === "," || w === "where")) { c.i = save; return false; }
  const kind = c.i === start ? "" : counterKindOf(words.join(" ")) ?? (words.length === 1 && /^[a-z]+$/.test(words[0]!) && !["no", "any", "each", "that", "those", "the"].includes(words[0]!) ? words[0] : undefined);
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
  [["each", "player", "controls"], "any"], [["each", "player", "owns"], "any"],
  [["the", "target", "opponent", "controls"], "opp"], [["opponent", "controls"], "opp"],
  [["the", "opponent", "to", "your", "left", "controls"], "opp"], [["the", "opponent", "to", "your", "right", "controls"], "opp"],
  [["the", "active", "player", "controls"], "any"], [["that", "target", "player", "casts"], "any"],
  [["controlled", "by", "the", "next", "player", "in", "the", "chosen", "direction"], "opp"],
  // "each player gains control of a nonland permanent ... controlled by the player to their right" (Inniaz).
  [["controlled", "by", "the", "player", "to", "their", "right"], "any"], [["controlled", "by", "the", "player", "to", "their", "left"], "any"], [["enchanted", "player", "controls"], "any"],
  // Two-Headed Giant's team (CR 810): in Commander, the team is you.
  [["your", "team", "controls"], "you"],
];

/** Whose zone: the possessive before a zone noun. */
const ZONE_OWNERS: ReadonlyArray<readonly [string[], Control | undefined]> = [
  // Longest first: "your opponents'" before "your", "all opponents'" before "all".
  [["your", "opponents'"], "opp"], [["all", "opponents'"], "opp"],
  [["your"], "you"], [["an", "opponent's"], "opp"], [["target", "opponent's"], "opp"],
  [["each", "opponent's"], "opp"], [["defending", "player's"], "opp"], [["their"], undefined],
  [["target", "player's"], undefined], [["a", "chosen", "player's"], undefined], [["a", "single"], undefined], [["any"], undefined], [["its", "owner's"], undefined],
  [["each", "player's"], undefined], [["each"], undefined], [["other", "players'"], "opp"], [["a"], undefined], [["the"], undefined],
];
const ZONES = new Map([
  ["graveyard", "graveyard"], ["graveyards", "graveyard"], ["exile", "exile"], ["library", "library"], ["hand", "hand"], ["hands", "hand"], ["deck", "library"],
]);

function zonePhrase(c: Cursor, r: Reading): boolean {
  const save = c.i;
  const from = c.eat("from");
  if (!from && !c.eat("in")) return false;
  // "from the top of your library": the origin is still the library.
  // "from outside the game", "from the command zone".
  if (from && c.eat("outside", "the", "game")) { r.fromZone = "outside"; return true; }
  if (c.eat("the", "command", "zone")) {
    // "from the command zone and from your graveyard": either.
    if (from && c.eat("and", "from", "your", "graveyard")) { r.zoneAlternatives = ["command", "graveyard"]; r.zoneAlternativesFrom = true; return true; }
    if (from) r.fromZone = "command"; else r.zone = "command"; return true;
  }
  // "from the top of your library", "from the top five cards of your library".
  let top = from && (c.eat("the", "top", "of") || c.eat("the", "bottom", "of"));
  if (from && !top && c.peek() === "the" && c.peek(1) === "top" && isNumber(c.peek(2)) && c.peek(3) === "cards" && c.peek(4) === "of") { c.i += 5; top = true; }
  // "from the top four of your library", and "from the top four" alone: the library.
  if (from && !top && c.peek() === "the" && c.peek(1) === "top" && isNumber(c.peek(2))) {
    c.i += 3;
    if (c.done) { r.fromZone = "library"; return true; }
    if (!c.eat("of")) { c.i = save; return false; }
    top = true;
  }
  let owner: Control | undefined;
  // "from target spell's controller's graveyard", "target creature's controller's hand": an object's
  // controller's zone -- whose, the phrase does not narrow.
  {
    const k = c.t.slice(c.i).findIndex((w) => w === "controller's" || w === "owner's");
    if (k > 0 && (c.peek() === "target" || c.peek() === "that") && ZONES.has(c.peek(k + 1) ?? "") && c.t.slice(c.i, c.i + k).every((w, j) => j === 0 || /'s$/.test(w) || TYPE_WORDS.has(w))) c.i += k + 1;
    else if ((c.peek() === "all" && c.peek(1) === "opponents'") || !c.eat("all")) for (const [ws, ctl] of ZONE_OWNERS) if (c.eat(...ws)) { owner = ctl; break; }
  }
  const z = ZONES.get(c.peek() ?? "");
  // "instant and sorcery spells from the top of your graveyard": a graveyard has a top too.
  if (z === undefined) { c.i = save; return false; }
  c.i++;
  if (from) r.fromZone = z; else r.zone = z;
  // "from your graveyard or hand", "from your hand and/or graveyard": either zone.
  {
    const save = c.i;
    // "from target player's hand and graveyard": both, which either-zone holds the same way.
    if (c.eat("or") || c.eat("and/or") || c.eat("and")) {
      c.eat("from"); if (!c.eat("your")) c.eat("their");
      // "from your hand or the top of your library".
      if (c.eat("the", "top", "of")) { if (!c.eat("your")) c.eat("their"); }
      const z2 = ZONES.get(c.peek() ?? "");
      if (z2 && z2 !== z) { c.i++; r.zoneAlternatives = [z, z2]; r.zoneAlternativesFrom = from; if (from) delete r.fromZone; else delete r.zone; }
      else c.i = save;
    }
  }
  if (owner) r.control = owner;
  return true;
}

/** "named Rite of Flame": the name runs to the end, a comma, or the words that end it in
 *  `parseSubject`'s NAMED. */
const NAME_ENDS = new Set(["in", "on", "from", "under", "with", "that", "that's", "you", "a", "an", "to", ",", ";", ":"]);

/** The object of a relation the subject has to it ("attached to THIS CREATURE", "enchanting TARGET
 *  PERMANENT"): the card itself, a player, a reference, or a filter phrase that runs to the end. */
function relatedObject(c: Cursor): boolean {
  // A reference is one word or two, and the phrase's other posts may follow it.
  if (c.eat("~") || c.eat("you") || c.eat("it") || c.eat("them")) return true;
  if (c.eat("this")) return nominalWord(c, reading()) === true;
  return object(c) !== null;
}

function post(c: Cursor, r: Reading): boolean | null {
  // ---- Single-card shapes from the census tail (#896), each read from the card's own text. ----
  // "a card you didn't control" (Valgavoth): one you never controlled.
  if (c.eat("you", "didn't", "control")) { if (!r.history.includes("not-controlled-by-you")) r.history.push("not-controlled-by-you"); return true; }
  // "a permanent owned by the money voter" (Expropriate): its owner voted money.
  if (c.eat("owned", "by", "the")) { const at = c.i; if (c.t.at(-1) === "voter" && c.t.length - at === 2) { r.condition = { kind: "chose", choice: c.t[at]!, of: "owner" }; c.i = c.t.length; return true; } c.i -= 3; }
  // "a 1/1 green Wolf creature token named Wolves of the Hunt with bands with other creatures named
  // Wolves of the Hunt": "bands with other" (CR 702.22b).
  if (c.eat("with", "bands", "with", "other") && !c.done) { r.keywords.push("bands with other"); c.i = c.t.length; return true; }
  // "target non-Elf creature whose power and toughness aren't equal" (Gilt-Leaf Winnower).
  if (c.eat("whose", "power", "and", "toughness", "aren't", "equal")) { r.statAlternatives = [{ metric: "power", op: "lt", vs: "toughness" }, { metric: "power", op: "gt", vs: "toughness" }]; return true; }
  // "a creature card with the same total power and toughness" (Wild Pair): as the creature that entered.
  if (c.eat("with", "the", "same", "total", "power", "and", "toughness")) { r.shares = { what: "total-power-toughness", with: "ref" }; return true; }
  // "from a graveyard with an instant or sorcery card in it" (Mysterious Stranger): the graveyard's.
  if ((r.zone || r.fromZone) && c.peek() === "with" && c.t.at(-2) === "in" && c.t.at(-1) === "it") { c.i = c.t.length; return true; }
  // "..., and the rest" (Liliana, Dreadhorde General): the ones not chosen go too -- the action's.
  if (c.eat(",", "and", "the", "rest") && c.done) return true;
  // "any target, then another target for each time this spell was kicked" (Comet Storm).
  if (c.eat(",", "then", "another", "target", "for", "each") && !c.done) { c.i = c.t.length; return true; }
  // "target creature spell you control, except it isn't legendary if the spell is legendary" (Double
  // Major): the COPY's exception, not the target's.
  if (c.eat(",", "except", "it", "isn't", "legendary", "if", "the", "spell", "is", "legendary")) return true;
  // "if it was exiled by an ability you controlled" (Evelyn, the Covetous).
  if (c.eat("if", "it", "was", "exiled", "by", "an", "ability", "you", "controlled")) { if (!r.history.includes("exiled-by-your-ability")) r.history.push("exiled-by-your-ability"); return true; }
  // "if it's controlled by the chosen player" (Stalking Leonin).
  if (c.eat("if", "it's", "controlled", "by", "the", "chosen", "player")) { r.condition = { kind: "chosen", of: "controller" }; return true; }
  // "if another permanent with the same name is on the battlefield" (Winnow).
  if (c.eat("if", "another", "permanent", "with", "the", "same", "name", "is", "on", "the", "battlefield")) { r.nameRelation = "same"; return true; }
  // "if it's a creature or if {G}{W} was spent to cast this spell" (Mythos of Nethroi): the class, or
  // anything once paid -- the union narrows nothing.
  if (c.peek() === "if" && c.peek(1) === "it's" && c.t.slice(c.i).join(" ").endsWith("was spent to cast this spell") && c.t.includes("or")) { c.i = c.t.length; return true; }
  // "all cards of each of the sacrificed creature's colors" (Mind Extraction).
  if (c.eat("of", "each", "of", "the", "sacrificed", "creature's", "colors")) { r.shares = { what: "color", with: "ref" }; return true; }
  // "that's blocking target creature attacking you" (Flash Foliage).
  {
    const save = c.i;
    if (c.eat("that's", "blocking")) { const w = parse(c.t.slice(c.i).join(" ")); if (w) { r.combatWith = { role: "blocking", with: w }; c.i = c.t.length; return true; } }
    c.i = save;
  }
  // "a creature that blocks or becomes blocked by this creature this combat, first strike until end of
  // turn" (Goblin Flotilla): the combat relation; what it gains is the action's.
  if (c.eat("that", "blocks", "or", "becomes", "blocked", "by", "this", "creature", "this", "combat")) {
    r.combatWith = { role: "blocking-or-blocked-by", with: "self" };
    if (c.eat(",")) { const kc = new Cursor(c.t.slice(c.i), false); if (!keywordList(kc) || !(kc.done || (kc.eat("until", "end", "of", "turn") && kc.done))) return null; c.i = c.t.length; }
    return true;
  }
  for (const [ws, h] of [
    [["that", "transforms", "into", "a", "phyrexian"], "transformed-into-phyrexian"],
    [["that", "would", "die", "this", "turn"], "would-die"],
    [["that", "hasn't", "been", "phased", "out", "with", "this", "attraction"], "not-phased-out-by-self"],
    [["that", "couldn't", "attack"], "could-not-attack"],
  ] as const) if (c.eat(...ws)) { if (!r.history.includes(h)) r.history.push(h); return true; }
  // "that doesn't have the same name as another permanent you control" (Yenna): a name it alone has.
  if (c.eat("that", "doesn't", "have", "the", "same", "name", "as", "another", "permanent", "you", "control")) { r.nameRelation = "different"; return true; }
  // "that don't have the same name as this creature" (Marvin, Murderous Mimic).
  if (c.eat("that", "don't", "have", "the", "same", "name", "as", "this", "creature")) { r.notNamed = "~"; return true; }
  // "creatures that would enter from exile or after being cast from exile" (Don't Blink).
  if (c.eat("that", "would", "enter", "from", "exile", "or", "after", "being", "cast", "from", "exile")) { r.fromZone = "exile"; if (!r.history.includes("would-enter")) r.history.push("would-enter"); return true; }
  // "each spell that would cost less than three mana to cast" (Trinisphere): its cost, not its mana
  // value -- the matcher abstains.
  {
    const save = c.i;
    if (c.eat("that", "would", "cost", "less", "than") && isNumber(c.peek()) && c.peek(1) === "mana" && c.peek(2) === "to" && c.peek(3) === "cast" && c.i + 4 === c.t.length) {
      c.i = c.t.length; r.stats.push({ metric: "mana-value", op: "lt", variable: true }); return true;
    }
    c.i = save;
  }
  // "two target creatures that share no creature types" (Rivals' Duel): none with the other.
  if (c.eat("that", "share", "no", "creature", "types")) { r.shares = { what: "creature-type", with: "ref", negated: true }; return true; }
  // "an artifact creature until end of turn": what it becomes, for how long -- the action's duration.
  // Only straight after one noun phrase: "target artifact creature, BLUE until end of turn" is a grant.
  if (c.peek() === "until" && c.peek(1) === "end" && c.peek(2) === "of" && c.peek(3) === "turn" && c.i + 4 === c.t.length
    && r.groups.length === 1 && (r.groups[0]!.types.length || r.groups[0]!.subtypes.length) && !c.t.slice(0, c.i).includes(",")) { c.i += 4; return true; }
  // "target land, 4/4 Elemental creature": what it becomes.
  if (c.peek() === "," && /^(?:\d+|x)\/(?:\d+|x)$/.test(c.peek(1) ?? "") && parse(c.t.slice(c.i + 1).join(" "))) { c.i = c.t.length; return true; }
  // "target creature with the triggered ability from clause 2": an ability the sentence grants.
  if (c.eat("with", "the", "triggered", "ability", "from") || c.eat("with", "the", "ability", "from")) { c.i = c.t.length; return true; }
  // "a creature that attacks you or a planeswalker you control": the combat relation, as an event.
  {
    const save = c.i;
    if (c.eat("that", "attacks")) {
      const w = parse(c.t.slice(c.i).join(" "));
      if (w && c.t[c.i] === "you") { r.combatWith = { role: "attacking", with: w }; c.i = c.t.length; return true; }
    }
    c.i = save;
  }
  // "a spell that shares a color or mana value with the exiled card": either.
  {
    const save = c.i;
    if (c.eat("that", "shares", "a", "color", "or", "mana", "value", "with") && ["the", "that", "it"].includes(c.peek() ?? "") && c.t.length - c.i <= 3) {
      c.i = c.t.length; r.sharesAlternatives = [{ what: "color", with: "ref" }, { what: "mana-value", with: "ref" }]; return true;
    }
    c.i = save;
  }
  // "with a target spell with mana value 2 or less, OR MANA VALUE 4 OR LESS IF THIS SPELL WAS KICKED":
  // the kicked bound, the looser, is the union.
  {
    const save = c.i;
    const last = r.stats.at(-1);
    if (last && c.eat(",", "or")) {
      const x = reading();
      if (stat(c, x) && x.stats.length === 1 && x.stats[0]!.metric === last.metric && c.eat("if", "this", "spell", "was", "kicked") && c.done) { r.stats[r.stats.length - 1] = x.stats[0]!; return true; }
    }
    c.i = save;
  }
  // "with a name originally printed in the Arabian Nights expansion".
  {
    const save = c.i;
    if (c.eat("with", "a", "name", "originally", "printed", "in", "the")) {
      const at = c.i;
      while (!c.done && c.peek() !== "expansion") c.i++;
      if (c.i > at && c.eat("expansion")) { c.eat("on", "the", "battlefield"); r.printedIn = c.t.slice(at, c.i - 1 - (c.t[c.i - 1] === "battlefield" ? 3 : 0)).join(" "); return true; }
    }
    c.i = save;
  }
  // "with a time counters on it equal to its mana value": a counter of that kind, its count the action's.
  {
    const save = c.i;
    if (c.eat("with", "a", "number", "of")) {
      const x = reading();
      const at = c.i;
      while (!c.done && c.peek() !== "counters") c.i++;
      const kind = counterKindOf(c.t.slice(at, c.i).join(" ")) ?? (c.i - at === 1 ? c.t[at] : undefined);
      if (kind && c.eat("counters", "on", "it", "equal", "to") && !c.done) { x.counter = kind; r.counter = kind; c.i = c.t.length; return true; }
    }
    c.i = save;
  }
  // "with an art sticker on it", "with a sticker on it": a status (Unfinity stickers).
  if (c.eat("with", "a", "sticker", "on", "it") || c.eat("with", "an", "art", "sticker", "on", "it") || c.eat("with", "a", "name", "sticker", "on", "it")) { if (!r.status.includes("sticker")) r.status.push("sticker"); return true; }
  // "a creature paired with it" (soulbond, CR 702.95).
  if (c.eat("paired", "with", "it") || c.eat("paired", "with", "~")) { if (!r.status.includes("paired")) r.status.push("paired"); return true; }
  // "that's attacking alone": attacking, with no other attacker.
  if (c.eat("that's", "attacking", "alone")) { r.combat = "attacking"; if (!r.status.includes("alone")) r.status.push("alone"); return true; }
  // "each other creature with the same controller", "another permanent you control that shares a
  // permanent type with it".
  if (c.eat("with", "the", "same", "controller")) { r.shares = { what: "controller", with: "ref" }; return true; }
  if (c.eat("that", "shares", "a", "permanent", "type", "with", "it")) { r.shares = { what: "card-type", with: "ref" }; return true; }
  // "artifacts target player controls in excess of the number you control": the count is the action's.
  if (c.eat("in", "excess", "of") && !c.done) { c.i = c.t.length; return true; }
  // "target spell that wasn't cast from its owner's hand": cast from anywhere else.
  if (c.eat("that", "wasn't", "cast", "from", "its", "owner's", "hand")) { r.notFromZone = "hand"; return true; }
  // "a creature card put into your graveyard from anywhere this turn".
  if (c.eat("put", "into", "your", "graveyard", "from", "anywhere", "this", "turn")) { if (!r.history.includes("put-into-graveyard")) r.history.push("put-into-graveyard"); return true; }
  // "each creature you control that didn't attack or enter this turn": neither.
  if (c.eat("that", "didn't", "attack", "or", "enter", "this", "turn")) { for (const h of ["not-attacked", "not-entered"]) if (!r.history.includes(h)) r.history.push(h); return true; }
  // "that entered since your last turn ended".
  if (c.eat("that", "entered", "since", "your", "last", "turn", "ended")) { if (!r.history.includes("entered-since-your-last-turn")) r.history.push("entered-since-your-last-turn"); return true; }
  // "that blocked or was blocked by a Zombie this turn": a combat this turn, with whom it must parse.
  {
    const save = c.i;
    if ((c.eat("that", "blocked", "or", "was", "blocked", "by") || c.eat("that", "blocked", "or", "were", "blocked", "by") || c.eat("that", "were", "blocked", "by") || c.eat("that", "was", "blocked", "by"))
      && c.t.at(-2) === "this" && c.t.at(-1) === "turn") {
      const role = c.t[save + 2] === "or" ? "blocked-or-was-blocked" : "was-blocked";
      const by = c.t.slice(c.i, -2);
      if (by.join(" ") === "the target creature" || parse(by.join(" "))) { c.i = c.t.length; const h = `${role}-by-ref`; if (!r.history.includes(h)) r.history.push(h); return true; }
    }
    c.i = save;
  }
  // "Spells you cast this turn that are black and/or red": the duration, then the class.
  if (c.peek() === "this" && c.peek(1) === "turn" && c.peek(2) === "that" && r.control === "you" && r.groups.some((g) => g.types.includes("spell"))) { c.i += 2; return true; }
  // "that have first strike, double strike, vigilance, and/or haste": any of them.
  {
    const save = c.i;
    if (c.eat("that", "have") || c.eat("that", "has")) {
      const ks = keywordList(c);
      if (ks && ks.length >= 2 && c.t[c.i - 1] !== "and" && (c.eat(",", "and/or") || c.eat(",", "or") || c.eat("and/or") || c.eat("or"))) {
        const more = keywordList(c);
        if (more && c.done) { r.keywordAlternatives = [...ks, ...more]; return true; }
      }
    }
    c.i = save;
  }
  // "with enchant creature": an Aura's enchant keyword. CEILING: what it can enchant is not kept --
  // nearly every Aura says "creature", and the class is read past, as a keyword's parameter is.
  if (c.eat("with", "enchant") && !c.done) { c.i = c.t.length; if (!r.keywords.includes("enchant")) r.keywords.push("enchant"); return true; }
  // "any number of target opponents each": the "each" distributes the action.
  if (c.peek() === "each" && c.i + 1 === c.t.length) { c.i++; return true; }
  // "creatures attacking the last chosen player", "creatures blocking enchanted creature".
  {
    const save = c.i;
    const role = c.eat("attacking") ? "attacking" : c.eat("blocking") ? "blocking" : undefined;
    if (role && ["the last chosen player", "enchanted creature", "equipped creature"].includes(c.t.slice(c.i).join(" "))) {
      c.i = c.t.length; r.combatWith = { role, with: "ref" }; return true;
    }
    c.i = save;
  }
  // A CONDITION ON THE CONTROLLER: "target creature whose controller controls an Island", "creatures
  // controlled by players who chose peace".
  {
    const save = c.i;
    const whose = c.eat("whose", "controller");
    if (whose || c.eat("controlled", "by", "players") || c.eat("controlled", "by", "a", "player")) {
      const cond = playerCondition(c, whose);
      if (cond && c.done && !r.condition) { r.condition = { ...cond, of: "controller" }; return true; }
      c.i = save; return null;
    }
    if (c.peek() === "whose" && c.peek(1) === "coin") { const cond = playerCondition(c); if (cond && c.done) { r.condition = cond; return true; } c.i = save; return null; }
  }
  // "that are enchanted by an Aura you control": enchanted, by what it must parse and is dropped,
  // as "attached to" below.
  if (c.eat("that", "are", "enchanted", "by") || c.eat("that's", "enchanted", "by") || c.eat("that", "is", "enchanted", "by")) {
    if (!r.status.includes("enchanted")) r.status.push("enchanted");
    return relatedObject(c);
  }
  // "from anywhere other than your hand", "other than the battlefield".
  if (c.eat("from", "anywhere", "other", "than")) {
    if (c.eat("your", "hand") || c.eat("their", "hand")) { r.notFromZone = "hand"; return true; }
    if (c.eat("the", "battlefield")) { r.notFromZone = "battlefield"; return true; }
    return null;
  }
  // OWNERSHIP: "a spell you don't own", "you both own and control".
  if (c.eat("you", "don't", "own")) { r.owner = "opp"; return true; }
  if (c.eat("you", "both", "own", "and", "control") || c.eat("you", "own", "and", "control")) { r.owner = "you"; r.control = "you"; return true; }
  // A COMBAT RELATION: "blocking this creature", "blocking or blocked by ~", "that's attacking you".
  {
    const save = c.i;
    const role = c.eat("blocking", "or", "blocked", "by") ? "blocking-or-blocked-by" : c.eat("blocked", "by") ? "blocked-by"
      : c.eat("blocking") ? "blocking" : (c.eat("that's", "attacking") || c.eat("attacking")) ? "attacking" : undefined;
    if (role) {
      let w: NonNullable<SubjectFilter["combatWith"]>["with"] | undefined;
      // "attacking you or a planeswalker you control": a list, read whole first.
      const whole = c.peek() === "you" && c.peek(1) === "or" ? parse(c.t.slice(c.i).join(" ")) : null;
      if (whole) { w = whole; c.i = c.t.length; }
      else if (c.eat("~") || (c.eat("this") && nominalWord(c, reading()) === true)) w = "self";
      else if (c.eat("you")) w = "you";
      else if (c.eat("one", "of", "your", "opponents") || c.eat("an", "opponent")) w = { control: "opp" };
      else if (c.eat("it") || c.eat("them")) w = "ref";
      else if (!c.done) { const f = parse(c.t.slice(c.i).join(" ")); if (f) { w = f; c.i = c.t.length; } }
      if (w && (c.done || c.peek() === "you" || c.peek() === "an" || c.peek() === "if")) { r.combatWith = { role: role as NonNullable<SubjectFilter["combatWith"]>["role"], with: w }; return true; }
      c.i = save;
      if (role !== "attacking") return null;
    }
  }
  // "other than this", "other than a basic land", "other than basic land cards".
  if (c.eat("other", "than")) {
    if (c.eat("this") && (c.done || nominalWord(c, reading()) === true)) { r.other = true; return true; }
    const rest = c.t.slice(c.i);
    // "other than enchanted creature": not the object the card names.
    if ((rest[0] === "enchanted" || rest[0] === "equipped") && rest.length === 2) { r.otherThanRef = true; c.i = c.t.length; return true; }
    // "other than your first spell each turn", "other than the first spell they cast each turn".
    if (["your first spell each turn", "your first spell that turn", "the first spell they cast each turn"].includes(rest.join(" "))) {
      if (!r.history.includes("not-first-spell-this-turn")) r.history.push("not-first-spell-this-turn"); c.i = c.t.length; return true;
    }
    if (rest[0] === "enchanted" || rest[0] === "equipped" || rest.includes("chosen")) return null;
    const f = parse(rest.join(" "));
    if (!f) return null;
    const { control, token, scope: _s, ...x } = f;
    (r.except ??= []).push({ ...x, ...(control !== "any" ? { control } : {}), ...(token !== null ? { token } : {}) });
    c.i = c.t.length; return true;
  }
  // "you own or control": either.
  if (c.eat("you", "own", "or", "control")) { r.ownOrControl = true; return true; }
  // OWNERSHIP beside control (CR 108.3): "a card an opponent owns", "you control but don't own".
  if (c.eat("an", "opponent", "owns") || c.eat("your", "opponents", "own") || c.eat("target", "opponent", "owns")
    || c.eat("owned", "by", "another", "player") || c.eat("owned", "by", "an", "opponent")) { r.owner = "opp"; return true; }
  if (c.eat("target", "player", "owns")) return true;
  if (c.eat("you", "own", "but", "don't", "control")) { r.owner = "you"; r.control = "opp"; return true; }
  if (c.eat("you", "control", "but", "don't", "own")) { r.control = "you"; r.owner = "opp"; return true; }
  // NAMES: a relation, or a name it does not have.
  // "all creatures with a name chosen for this enchantment".
  if (c.eat("with", "a", "name", "chosen", "for", "this", "enchantment")) { r.nameRelation = "chosen"; return true; }
  // "with the same power and/or same toughness as this creature": either.
  if (c.eat("with", "the", "same", "power", "and/or", "same", "toughness", "as", "this", "creature")) { r.sharesAlternatives = [{ what: "power", with: "self" }, { what: "toughness", with: "self" }]; return true; }
  if (c.eat("with", "the", "chosen", "name") || c.eat("with", "a", "chosen", "name")) { r.nameRelation = "chosen"; return true; }
  // "with the chosen nonland card name", "with a chosen nonartifact, nonland card name", "with chosen
  // creature card name".
  {
    const save = c.i;
    if (c.eat("with") && (c.eat("the") || c.eat("a") || true) && c.eat("chosen")) {
      while (!c.done && c.peek() !== "name" && c.peek() !== "names") c.i++;
      if (c.eat("name") || c.eat("names")) { r.nameRelation = "chosen"; return true; }
    }
    c.i = save;
  }
  if (c.eat("with", "that", "name")) { r.nameRelation = "same"; return true; }
  // "all cards with the same name": with each other, or as an object the sentence names.
  {
    const save = c.i;
    if ((c.eat("with", "the", "same", "name") || c.eat("that", "has", "the", "same", "name") || c.eat("that", "have", "the", "same", "name")) && c.done) { r.nameRelation = "same"; return true; }
    c.i = save;
  }
  // "with the same mana value as the sacrificed creature", "with the same mana value": shared with an
  // object named elsewhere.
  {
    const save = c.i;
    if (c.eat("with", "the", "same", "mana", "value")) {
      if (c.done) { r.shares = { what: "mana-value", with: "ref" }; return true; }
      if (c.eat("as") && ["the", "that", "it", "~", "this"].includes(c.peek() ?? "") && !c.t.slice(c.i).some((w) => RHS_VERBS.has(w))) {
        r.shares = { what: "mana-value", with: c.peek() === "~" || c.peek() === "this" ? "self" : "ref" }; c.i = c.t.length; return true;
      }
    }
    c.i = save;
  }
  // Selection rules over several objects, not their class: "with different mana values", "with equal
  // toughness", "with different powers".
  if (c.eat("with", "different", "mana", "values") || c.eat("with", "different", "powers") || c.eat("with", "equal", "toughness") || c.eat("with", "equal", "power")) return true;
  // "a spell with a single target", "a spell with one or more targets": a targeting condition nothing
  // models, refused like "that targets only" (`restricted`).
  if (c.eat("with", "a", "single", "target") || c.eat("with", "one", "or", "more", "targets") || c.eat("that", "targets", "a", "single", "player")) { r.restricted = true; return true; }
  if (c.eat("with", "different", "names")) { r.nameRelation = "different"; return true; }
  if (c.eat("with", "the", "same", "name", "as") || c.eat("that", "has", "the", "same", "name", "as") || c.eat("that", "have", "the", "same", "name", "as")) {
    // What follows is a reference ("this creature", "that spell", "the exiled card", "~") or a
    // filter phrase; either must end the phrase, or "... as this creature ARE GOADED" would parse.
    // ", except for basic lands" after it binds the subject: left for the next post.
    const cut = c.t.findIndex((w, k) => k >= c.i && w === "," && c.t[k + 1] === "except");
    const rest = c.t.slice(c.i, cut < 0 ? c.t.length : cut);
    const ref = rest.length >= 1 && (rest[0] === "~" ? rest.length === 1
      : ["this", "that", "the"].includes(rest[0]!) && rest.length <= 3 && !rest.some((w) => RHS_VERBS.has(w))
      // "as one of the exiled cards"
      || (rest[0] === "one" && rest[1] === "of" && rest[2] === "the" && rest.length <= 5)
      // "as a card exiled with this enchantment", "as a card in that player's graveyard", "as a card
      // spliced onto that spell": a card the sentence names.
      || (rest[0] === "a" && rest[1] === "card" && (["exiled", "spliced"].includes(rest[2]!) || rest.includes("that") || rest.includes("player's")) && !rest.some((w) => RHS_VERBS.has(w))));
    // "as that card FROM YOUR GRAVEYARD": the reference, then the subject's zone.
    const z = rest.findIndex((w, k) => k >= 1 && k <= 3 && (w === "from" || w === "in"));
    if (!ref && z > 0 && ["this", "that", "the"].includes(rest[0]!)) { c.i += z; r.nameRelation = "same"; return true; }
    if (!ref && !parse(rest.join(" "))) return null;
    c.i = cut < 0 ? c.t.length : cut; r.nameRelation = "same"; return true;
  }
  for (const [ws, ctl] of CONTROLLERS) if (c.eat(...ws)) { r.control = ctl; return true; }
  if (c.eat("you", "own")) { r.owner = "you"; return true; }
  // Who CASTS a spell is who controls it (CR 112.2).
  if (c.eat("you", "cast")) {
    r.control = "you";
    // "spells you cast this turn [cost {1} less]": the effect's duration. A PERMANENT you cast this
    // turn ("target creature you cast this turn") is a history.
    if (c.peek() === "this" && c.peek(1) === "turn" && !r.groups.some((g) => g.types.includes("spell"))) { c.i += 2; if (!r.history.includes("cast")) r.history.push("cast"); }
    return true;
  }
  // "spells you cast from exile this turn" reads "from exile" here, then the duration.
  if (c.peek() === "this" && c.peek(1) === "turn" && c.i + 2 === c.t.length && r.groups.some((g) => g.types.includes("spell"))) { c.i += 2; return true; }
  // "target spell cast from a graveyard": where it was cast from.
  {
    const save = c.i;
    if (c.eat("cast") && c.peek() === "from" && zonePhrase(c, r)) return true;
    c.i = save;
  }
  // "creature cards chosen from each opponent's graveyard": where they are.
  {
    const save = c.i;
    if (c.eat("chosen") && c.peek() === "from" && zonePhrase(c, r)) return true;
    c.i = save;
  }
  // "from a graveyard or cast from a graveyard": either way out of the same zone.
  {
    const save = c.i;
    const z = r.fromZone;
    if (z && c.eat("or", "cast") && c.peek() === "from" && zonePhrase(c, r) && r.fromZone === z) return true;
    c.i = save; if (z) r.fromZone = z;
  }
  // How the action puts it, not which: "a card from your hand face down", "tokens created".
  if (["face down", "face up", "created"].includes(c.t.slice(c.i).join(" "))) { c.i = c.t.length; return true; }
  // "Spells you cast but don't own".
  if (c.eat("but", "don't", "own") && r.control === "you") { r.owner = "opp"; return true; }
  // "a spell you've cast", "each spell they've cast this turn": a history.
  if (c.eat("you've", "cast") || c.eat("they've", "cast")) { if (c.t[c.i - 2] === "you've") r.control = "you"; c.eat("this", "turn"); if (!r.history.includes("cast")) r.history.push("cast"); return true; }
  // "that's attacking or blocking", "that's blocking": the combat state.
  if (c.peek() === "that's" && (c.peek(1) === "attacking" || c.peek(1) === "blocking")) {
    const save = c.i; c.i += 1;
    const w = c.t[c.i++]!;
    const both = c.eat("or", w === "attacking" ? "blocking" : "attacking");
    if (c.done) { const v = both ? "in-combat" : w as "attacking" | "blocking"; if (r.combat && r.combat !== v) return null; r.combat = v; return true; }
    c.i = save;
  }
  // "that's attached to a permanent".
  if (c.eat("that's", "attached", "to")) return relatedObject(c);
  // "that's not historic": every one but the historic ones.
  if (c.eat("that's", "not", "historic") || c.eat("that", "isn't", "historic")) { (r.except ??= []).push({ historic: true }); return true; }
  // A participle that ends the phrase: "a creature you control attacking".
  if ((c.peek() === "attacking" || c.peek() === "blocking") && c.i + 1 === c.t.length) {
    const w = c.t[c.i++]!;
    if (r.combat && r.combat !== w) return null;
    r.combat = w as "attacking" | "blocking"; return true;
  }
  if (c.eat("an", "opponent", "casts") || c.eat("your", "opponents", "cast") || c.eat("opponents", "cast")) { r.control = "opp"; return true; }
  // Who ACTIVATES an ability controls it on the stack (CR 113.8).
  if (r.ability && (c.eat("your", "opponents", "activate") || c.eat("an", "opponent", "activates"))) { r.control = "opp"; return true; }
  if (r.ability && c.eat("you", "activate")) { r.control = "you"; return true; }
  // Words that do not narrow the class: whose choice it is, chance, and the default zone.
  if (c.eat("of", "their", "choice") || c.eat("of", "your", "choice") || c.eat("of", "an", "opponent's", "choice")
    || c.eat("at", "random") || c.eat("on", "the", "battlefield") || c.eat("from", "anywhere")
    // "from the battlefield" is the `dies` event's own origin, and `fromZone` deliberately never holds
    // it (see ORIGIN_ZONE in derive/subject.ts).
    || c.eat("from", "the", "battlefield")
    // Selection rules over several chosen objects, not their class.
    || c.eat("controlled", "by", "different", "players") || c.eat("with", "different", "controllers") || c.eat("divided", "as", "you", "choose")) return true;
  // "tokens created under your control": the creator's.
  if (c.eat("created", "under", "your", "control")) { r.control = "you"; return true; }
  if (c.eat("with")) {
    if (c.eat("no", "counters", "on", "it") || c.eat("no", "counters", "on", "them")) { r.hasCounter = false; return true; }
    if (stat(c, r) || counterPhrase(c, r)) return true;
    // "with a cycling ability", "with a morph ability": the keyword, named as an ability.
    {
      const save = c.i;
      if (c.eat("a") || c.eat("an")) {
        const ks = keywordList(c);
        if (ks && ks.length === 1 && (c.eat("ability") || c.eat("abilities"))) { r.keywords.push(...ks); return true; }
      }
      c.i = save;
      // "with morph abilities", "with cycling abilities".
      const ks = keywordList(c);
      if (ks && ks.length === 1 && c.eat("abilities")) { r.keywords.push(...ks); return true; }
      c.i = save;
    }
    if (c.eat("no", "abilities")) { if (!r.status.includes("no-abilities")) r.status.push("no-abilities"); return true; }
    const ks = keywordList(c);
    if (ks) {
      // "with flash or flying", "with flying, deathtouch, and/or lifelink": any of them.
      if (c.peek() === "or" || c.peek() === "and/or" || (c.peek() === "," && (c.peek(1) === "or" || c.peek(1) === "and/or"))) {
        c.eat(","); c.i++;
        const more = keywordList(c);
        if (!more) return null;
        r.keywordAlternatives = [...ks, ...more]; return true;
      }
      r.keywords.push(...ks); return true;
    }
    return null;
  }
  // "one or more lands without being played": put onto the battlefield some other way.
  if (c.eat("without", "being", "played")) { if (!r.history.includes("not-played")) r.history.push("not-played"); return true; }
  if (c.eat("without")) {
    // "without a +1/+1 counter on it": every one but those with that counter.
    {
      const save = c.i, x = reading();
      if (counterPhrase(c, x) && x.counter && c.done) { (r.except ??= []).push({ counter: x.counter }); return true; }
      c.i = save;
    }
    const ks = keywordList(c);
    if (ks) { r.notKeywords.push(...ks); return true; }
    return null;
  }
  if (zonePhrase(c, r)) return true;
  if (c.eat("named")) {
    // "named ~" is the card's own name, one token: "named ~ and all other ..." does not run on.
    if (c.eat("~")) { if (!r.tokenHead) r.named = "~"; return true; }
    const start = c.i;
    while (!c.done && (c.i === start || !NAME_ENDS.has(c.peek()!))) c.i++;
    // "a card named Ajani, Valiant Protector": a comma that ends the phrase's words is in the name.
    if (c.peek() === "," && c.t.slice(c.i + 1).length > 0 && c.t.slice(c.i + 1).every((w) => !NAME_ENDS.has(w))) c.i = c.t.length;
    // ...and one a zone phrase ends: "a card named Nissa, Genesis Mage FROM your graveyard".
    else if (c.peek() === ",") {
      const k = c.t.findIndex((w, j) => j > c.i && NAME_ENDS.has(w));
      if (k > c.i + 1 && (c.t[k] === "from" || c.t[k] === "in") && c.t.slice(c.i + 1, k).every((w) => !NP_START.has(w) && !["or", "and"].includes(w))) c.i = k;
    }
    if (!r.tokenHead) r.named = c.t.slice(start, c.i).join(" ").replace(/ ,/g, ",");
    return true;
  }
  // Whose choice, or chance: not a narrowing.
  if (c.eat("of", "target", "opponent's", "choice") || c.eat("of", "target", "player's", "choice") || c.eat("chosen", "at", "random")
    || c.eat("chosen", "by", "you") || c.eat("chosen", "by", "defending", "player") || c.eat("chosen", "by", "each", "opponent")) return true;
  // "each with mana value 2 or less": the "each" distributes the condition; read past it.
  if (c.peek() === "each" && c.peek(1) === "with") { c.i++; return true; }
  // EXCLUSIONS: "except for Krakens, Leviathans, Octopuses, and Serpents", "except for tokens you control".
  // "cards in your hand except X cards you choose": which are left, a selection, not a class.
  {
    const save = c.i;
    if (c.eat("except") && (isNumber(c.peek()) && (c.peek(1) === "card" || c.peek(1) === "cards"))) {
      c.i += 2;
      if ((c.eat("you", "choose") || c.eat("of", "their", "choice")) && c.done) return true;
    }
    c.i = save;
  }
  // ", except for basic lands" after a clause that ended at the comma.
  if (c.peek() === "," && c.peek(1) === "except" && c.peek(2) === "for") c.i++;
  if (c.eat("except", "for")) {
    const items: string[][] = [[]];
    for (const w of c.t.slice(c.i)) {
      if (w === "," || w === "and" || w === "or") { if (items.at(-1)!.length) items.push([]); continue; }
      items.at(-1)!.push(w);
    }
    // "except for Mageta": one word no class reads, a card's name.
    const parsed = items.filter((x) => x.length).map((x) => parse(x.join(" ")) ?? (x.length === 1 && /^[a-z]+$/.test(x[0]!) && !SUBTYPES.has(x[0]!) && !TYPE_WORDS.has(x[0]!) ? { control: "any" as const, token: null, named: x[0]! } : null));
    if (parsed.length === 0 || parsed.some((x) => x === null)) return null;
    r.except = parsed.map((x) => {
      const { control, token, scope: _s, ...rest } = x!;
      return { ...rest, ...(control !== "any" ? { control } : {}), ...(token !== null ? { token } : {}) };
    });
    c.i = c.t.length; return true;
  }
  if (c.eat("not", "named", "~")) { r.notNamed = "~"; return true; }
  if (c.eat("not", "named")) { const at = c.i; while (!c.done && !NAME_ENDS.has(c.peek()!)) c.i++; if (c.i === at) return null; r.notNamed = c.t.slice(at, c.i).join(" "); return true; }
  // WHAT IT SHARES: "that shares a creature type with this creature", "that doesn't share a color with it".
  {
    const save = c.i;
    const negated = c.eat("that", "doesn't", "share") || c.eat("that", "don't", "share") || c.eat("that", "share", "no") || c.eat("that", "shares", "no");
    if (negated || c.eat("that", "shares") || c.eat("that", "share") || c.eat("shares")) {
      if (!c.eat("a")) c.eat("an");
      // "share no creature TYPES": the plural of the same relation.
      // "share no creature types" relates the chosen objects to each other, which `shares` cannot say.
      if (negated && c.peek() === "creature" && c.peek(1) === "types") { c.i = save; return null; }
      const what = c.eat("creature", "type") ? "creature-type" : c.eat("color") ? "color" : c.eat("card", "type") ? "card-type"
        : c.eat("name") ? "name" : c.eat("mana", "value") ? "mana-value" : undefined;
      if (what && c.eat("with")) {
        let withWhom: NonNullable<SubjectFilter["shares"]>["with"] | undefined;
        if (c.eat("~") || (c.eat("this") && nominalWord(c, reading()) === true)) withWhom = "self";
        else if (c.eat("it") || c.eat("them")) withWhom = "ref";
        // "with equipped creature", "with the sacrificed creature", "with the top card of your library",
        // "with the chosen card": an object named elsewhere.
        else if (["that", "the", "enchanted", "equipped"].includes(c.peek() ?? "") && !c.t.slice(c.i).some((w) => RHS_VERBS.has(w))) { c.i = c.t.length; withWhom = "ref"; }
        // "with each creature tapped this way", "with a card exiled with this creature".
        else if (c.t.slice(c.i).join(" ").endsWith("this way") || (c.peek() === "a" && c.peek(1) === "card" && c.peek(2) === "exiled")) { c.i = c.t.length; withWhom = "ref"; }
        if (withWhom && c.done) { r.shares = { what, with: withWhom, ...(negated ? { negated: true as const } : {}) }; return true; }
        if (!withWhom) { const rest = parse(c.t.slice(c.i).join(" ")); if (rest) { c.i = c.t.length; r.shares = { what, with: rest, ...(negated ? { negated: true as const } : {}) }; return true; } }
      }
      c.i = save; return null;
    }
  }
  // DAMAGE BY A NAMED DEALER, in either order and over any span: "dealt damage this turn by a Spider
  // you controlled", "dealt damage by ~", "previously dealt damage by this creature", "dealt combat
  // damage this game by a creature named ~". The dealer must parse or be the card itself.
  {
    const save = c.i;
    if (!(c.eat("that", "was") || c.eat("that", "were"))) c.eat("previously");
    const combat = c.eat("dealt", "combat", "damage") ? true : c.eat("dealt", "damage") ? false : undefined;
    if (combat !== undefined) {
      if (!c.eat("this", "turn")) c.eat("this", "game");
      if (c.eat("by")) {
        let self = false;
        const end = c.t.length - (c.t.at(-2) === "this" && (c.t.at(-1) === "turn" || c.t.at(-1) === "game") ? 2 : 0);
        const by = c.t.slice(c.i, end);
        if ((by.length === 1 && by[0] === "~") || (by.length === 2 && by[0] === "this")) self = true;
        // "you controlled": past tense of the controller.
        // "enchanted creature", "equipped creature", "it": the object the card names.
        // "by Zurgo": the card by its short name, an object the sentence names.
        else if (!(by.length <= 2 && ["enchanted", "equipped", "it", "that"].includes(by[0]!)) && !(by.length === 1 && /^[a-z]+$/.test(by[0]!) && !SUBTYPES.has(by[0]!))
          && !parse(by.join(" ").replace(/ you controlled$/, " you control"))) { c.i = save; return null; }
        c.i = c.t.length;
        const h = `dealt-${combat ? "combat-" : ""}damage-by-${self ? "self" : "ref"}`;
        if (!r.history.includes(h)) r.history.push(h);
        return true;
      }
    }
    c.i = save;
  }
  // THIS TURN: "that was dealt damage this turn", "that attacked this turn", "dealt damage by this
  // creature this turn". The history must end the clause with "this turn".
  {
    const save = c.i;
    if (!(c.eat("that", "was") || c.eat("that", "were") || c.eat("that"))) { /* a bare participle */ }
    const h = HISTORIES.find(([ws]) => ws.every((x, j) => c.peek(j) === x) && c.peek(ws.length) === "this" && c.peek(ws.length + 1) === "turn");
    if (h) { c.i += h[0].length + 2; if (!r.history.includes(h[1])) r.history.push(h[1]); return true; }
    c.i = save;
  }
  // A HISTORY a relative clause states. Each refused by the matcher, as every history is.
  for (const [ws, h] of [
    [["crewed", "by", "~"], "crewed-by-self"], [["crewed", "by", "this", "vehicle"], "crewed-by-self"],
    [["that", "you", "controlled", "since", "the", "beginning", "of", "the", "turn"], "controlled-since-turn-start"],
    [["that", "you", "cycled", "or", "discarded", "this", "turn"], "cycled-or-discarded"],
    [["that", "convoked", "this", "spell"], "convoked-self"],
    [["that", "wasn't", "put", "there", "this", "combat"], "not-put-into-graveyard-this-combat"],
    [["that", "was", "discarded", "or", "put", "there", "from", "a", "library", "this", "turn"], "discarded-or-put-into-graveyard-from-library"],
    [["that's", "the", "second", "spell", "cast", "this", "turn"], "second-spell-this-turn"],
    [["using", "teamwork"], "cast-using-teamwork"],
  ] as const) if (c.eat(...ws)) { if (!r.history.includes(h)) r.history.push(h); return true; }
  // "creature spells from your graveyard using their sneak abilities": cast by that keyword.
  {
    const save = c.i;
    if (c.eat("using", "their")) { const ks = keywordList(c); if (ks?.length === 1 && c.eat("abilities") && c.done) { const h = `cast-using-${ks[0]}`; if (!r.history.includes(h)) r.history.push(h); return true; } }
    c.i = save;
  }
  // "a Room you fully unlock".
  if (c.eat("you", "fully", "unlock")) { r.control = "you"; if (!r.history.includes("fully-unlocked")) r.history.push("fully-unlocked"); return true; }
  // "a card you choose from target opponent's hand": which one, a selection.
  if (c.peek() === "you" && c.peek(1) === "choose" && (c.i + 2 === c.t.length || c.peek(2) === "from")) { c.i += 2; return true; }
  // "land creatures only".
  if (c.peek() === "only" && c.i + 1 === c.t.length) { c.i++; return true; }
  // "all Equipment from target creature": what it is unattached from, dropped as "attached to" is.
  {
    const save = c.i;
    // Not an ability's source ("activated ability FROM an artifact source"): that is `abilityOf`.
    if (!r.ability && c.eat("from") && ["target", "a", "an", "each"].includes(c.peek() ?? "") && relatedObject(c) && c.done) return true;
    c.i = save;
  }
  // THE ACTION'S CONDITION, not the subject's: "a 1/1 blue Spirit creature token if it's the second
  // time this ability has resolved this turn", "target creature if this spell was kicked".
  if (c.eat("if", "it's", "the") || c.eat("if", "this", "is", "the")) {
    if (["first", "second", "third"].includes(c.peek() ?? "") && c.peek(1) === "time") { c.i = c.t.length; return true; }
    return null;
  }
  if (c.eat("if", "this", "spell", "was", "kicked")) return c.done || null;
  // A SUPERLATIVE as a condition: "target creature if no other creature has greater power", "if it
  // has the least power or is tied for least power among creatures on the battlefield".
  if (c.eat("if", "no", "other", "creature", "has", "greater", "power")) { r.stats.push({ metric: "power", op: "gte", variable: true }); return c.done || null; }
  if (c.eat("if", "it", "has", "the", "least", "power", "or", "is", "tied", "for", "least", "power", "among", "creatures", "on", "the", "battlefield")) { r.stats.push({ metric: "power", op: "lte", variable: true }); return true; }
  // "that each have a different mana value X or less": the selection, then the stat.
  {
    const save = c.i;
    if (c.eat("that", "each", "have", "a", "different") && stat(c, r)) return true;
    c.i = save;
  }
  // "that has the same mana value as the discarded card".
  {
    const save = c.i;
    if (c.eat("that", "has", "the", "same", "mana", "value", "as") && ["the", "that", "it"].includes(c.peek() ?? "") && c.t.length - c.i <= 3) { r.shares = { what: "mana-value", with: "ref" }; c.i = c.t.length; return true; }
    c.i = save;
  }
  // "spells you cast that target enchanted creature / enchanted player". CEILING: the target is the
  // ONE object the Aura enchants; held as an enchanted one, which `targets` refuses anyway.
  {
    const save = c.i;
    if ((c.eat("that", "target", "enchanted") || c.eat("that", "targets", "enchanted")) && c.i + 1 === c.t.length) {
      const w = c.t[c.i++]!;
      if (w === "player") { r.targets = { status: ["enchanted"], player: true }; return true; }
      const t = parse(`a ${w}`);
      if (t && (t.type !== undefined || t.subtype !== undefined)) { const { control: _c, token: _t, ...x } = t; r.targets = { ...x, status: ["enchanted"] }; return true; }
    }
    c.i = save;
  }
  // WHEN IT WAS CAST: "spells your opponents cast during your turn".
  if (c.eat("during", "your", "turn") && r.groups.some((g) => g.types.includes("spell"))) { if (!r.history.includes("cast-during-your-turn")) r.history.push("cast-during-your-turn"); return true; }
  // AN EVENT IN THE PARTICIPLE: "a creature entering the battlefield under an opponent's control", "a
  // creature you control dealing combat damage to a player". The event is the trigger's; held as a
  // history, which the matcher refuses, rather than dropped (dropping widens the claim).
  if (c.eat("entering", "the", "battlefield")) {
    if (c.eat("under", "an", "opponent's", "control")) r.control = "opp";
    else if (c.eat("under", "your", "control")) r.control = "you";
    if (!r.history.includes("entering")) r.history.push("entering");
    return true;
  }
  {
    const save = c.i;
    const kind = c.eat("dealing", "combat", "damage", "to") ? "dealing-combat-damage" : c.eat("dealing", "noncombat", "damage", "to") ? "dealing-noncombat-damage" : undefined;
    if (kind) {
      const to = c.eat("a", "player") ? "player" : c.eat("an", "opponent") || c.eat("one", "or", "more", "of", "your", "opponents") ? "opponent" : undefined;
      if (to) {
        c.eat("during", "your", "turn");
        const h = `${kind}-to-${to}`;
        if (!r.history.includes(h)) r.history.push(h);
        return true;
      }
    }
    c.i = save;
  }
  // "that has a -1/-1 counter on it", "that have -1/-1 counters on them".
  {
    const save = c.i;
    if (c.eat("that", "has") || c.eat("that", "have")) { if (counterPhrase(c, r)) return true; }
    c.i = save;
  }
  // "that wasn't cast": a copy, put on the stack without being cast (`notCast`).
  if (c.eat("that", "wasn't", "cast") && c.done) { r.notCast = true; return true; }
  // "that doesn't have first strike, double strike, vigilance, or haste": none of them.
  if (c.eat("that", "doesn't", "have") || c.eat("that", "don't", "have")) {
    const ks = keywordList(c);
    if (ks && (c.eat(",", "or") || c.eat("or") || true)) { const more = keywordList(c); r.notKeywords.push(...ks, ...(more ?? [])); return c.done || null; }
    return null;
  }
  // "that defending player controls", "that each opponent controls": a controller after "that".
  if (c.peek() === "that") {
    const save = c.i; c.i++;
    for (const [ws, ctl] of CONTROLLERS) if (c.eat(...ws)) { r.control = ctl; return true; }
    c.i = save;
  }
  // "spells that target this": the card itself.
  {
    const save = c.i;
    if ((c.eat("that", "target", "this") || c.eat("that", "targets", "this")) && c.done) { r.targets = { self: true }; return true; }
    c.i = save;
  }
  // "a creature spell that has an Adventure" (CR 715): a card characteristic, held as a status.
  // "cards that have mana value 9", "that each have mana value X or less": the stat "with" would print.
  {
    const save = c.i;
    if ((c.eat("that", "has") || c.eat("that", "have") || c.eat("that", "each", "have")) && stat(c, r)) return true;
    c.i = save;
  }
  // "that is another Hero": the class, and not the card itself.
  {
    const save = c.i;
    if (c.eat("that", "is", "another") || c.eat("that's", "another")) {
      const x = reading();
      if (nominal(c, x) === true && c.done && x.groups.length === 1 && !x.groups[0]!.types.length && x.groups[0]!.subtypes.length) {
        r.groups[0]!.subtypes.push(...x.groups[0]!.subtypes); r.other = true; return true;
      }
    }
    c.i = save;
  }
  // "with lifelink equal to the number of cards you've drawn", "creatures you control equal to the
  // number of lands ...": HOW MANY, the action's amount, read past as ", where X is".
  if (c.peek() === "equal" && c.peek(1) === "to" && ["the", "its", "their"].includes(c.peek(2) ?? "") && r.groups.some((g) => g.nounSeen || g.subtypes.length)) { c.i = c.t.length; return true; }
  if (c.eat("that", "has", "an", "adventure") || c.eat("that", "have", "an", "adventure")) { if (!r.status.includes("adventure")) r.status.push("adventure"); return true; }
  // "that has a cycling ability": the keyword.
  {
    const save = c.i;
    if (c.eat("that", "has", "a") || c.eat("that", "have", "a") || c.eat("that", "has", "an")) {
      const ks = keywordList(c);
      if (ks && ks.length === 1 && (c.eat("ability") || c.eat("abilities")) && c.done) { r.keywords.push(...ks); return true; }
    }
    c.i = save;
  }
  // "that's enchanted", "that are enchanted or equipped".
  if ((c.peek() === "that's" || (c.peek() === "that" && (c.peek(1) === "is" || c.peek(1) === "are"))) && STATUSES.has(c.peek(c.peek() === "that's" ? 1 : 2) ?? "")) {
    c.i += c.peek() === "that's" ? 1 : 2;
    const alts = [c.t[c.i++]!];
    while (c.eat("or") && STATUSES.has(c.peek() ?? "")) alts.push(c.t[c.i++]!);
    if (alts.length === 1) { if (!r.status.includes(alts[0]!)) r.status.push(alts[0]!); }
    else r.statusAlternatives = alts;
    return true;
  }
  // A CONDITION ON THE TARGET narrows what the effect touches: "target creature if it's white",
  // "target spell if it was kicked", "target creature if it's tapped".
  if (c.eat("if", "it's") || c.eat("if", "it", "is")) {
    if (COLOR_WORDS[c.peek() ?? ""] && c.i + 1 === c.t.length) { r.colors.add(COLOR_WORDS[c.t[c.i++]!]!); return true; }
    if (c.eat("tapped")) { r.tapped = true; return c.done || null; }
    const save = c.i;
    if (!c.eat("a")) c.eat("an");
    const x = reading();
    if (nominal(c, x) === true && c.done) {
      const types = x.groups.flatMap((g) => g.types), subs = x.groups.flatMap((g) => g.subtypes);
      if (types.length && !subs.length && r.groups.length === 1 && !r.groups[0]!.types.some((t) => (CARD_TYPES as readonly string[]).includes(t))) {
        r.groups[0]!.types.push(...types); return true;
      }
    }
    c.i = save; return null;
  }
  // "target creature if its power is less than or equal to ...", "target spell if its mana value is
  // X": the stat comparison "with" would print, said as a condition.
  if (c.peek() === "if" && c.peek(1) === "its") {
    const at = c.i + 2;
    const m = c.t[at] === "mana" && c.t[at + 1] === "value" ? 2 : c.t[at] === "power" || c.t[at] === "toughness" ? 1 : 0;
    if (m && c.t[at + m] === "is") {
      const sub = new Cursor([...c.t.slice(at, at + m), ...c.t.slice(at + m + 1)], c.spellNoun);
      if (stat(sub, r) && sub.done) { c.i = c.t.length; return true; }
    }
    return null;
  }
  // "if it has the same name as that card", "if it shares a card type with a card exiled with this
  // creature": the relation, said as a condition.
  if (c.peek() === "if" && c.peek(1) === "it" && (c.peek(2) === "has" || c.peek(2) === "shares")) {
    const save = c.i;
    c.i += 2;
    const sub = new Cursor(["that", ...c.t.slice(c.i)], c.spellNoun);
    if (post(sub, r) === true && sub.done) { c.i = c.t.length; return true; }
    c.i = save; return null;
  }
  if (c.eat("if", "it", "attacked", "or", "blocked", "this", "turn")) { if (!r.history.includes("attacked-or-blocked")) r.history.push("attacked-or-blocked"); return true; }
  if (c.eat("if", "it", "was", "kicked")) { if (!r.status.includes("kicked")) r.status.push("kicked"); return true; }
  // A DESTINATION is the action's: "target creature into their library", "target Equipment you control
  // to target creature", "up to two Forest cards onto the battlefield tapped".
  if (c.eat("onto", "the", "battlefield")) { c.eat("tapped"); return c.done || null; }
  // The EVENT's participle ("land cards put onto the battlefield", "all land cards returned to the
  // battlefield"): the trigger's event, not the class. CEILING: read past.
  if (c.eat("put", "onto", "the", "battlefield") || c.eat("returned", "to", "the", "battlefield") || (c.peek() === "returned" && c.i + 1 === c.t.length && (c.i++, true))) return true;
  // "on top of your library", "on the bottom of its owner's library": a destination.
  if (c.eat("on", "top", "of") || c.eat("on", "the", "bottom", "of") || c.eat("on", "the", "top", "of")) {
    if (!(c.eat("your") || c.eat("its", "owner's") || c.eat("their"))) return null;
    return c.eat("library") ? true : null;
  }
  // "target land you control as a 4/4 Elemental creature", "a creature as your Ring-bearer": what it
  // becomes or is chosen as -- the action's, like a destination.
  if (c.peek() === "as" && c.i + 1 < c.t.length) {
    const rest = c.t.slice(c.i + 1);
    if (rest[0] === "your" || parse(rest.join(" ")) || rest.some((w) => /^(?:\d+|x)\/(?:\d+|x)$/.test(w))) { c.i = c.t.length; return true; }
    return null;
  }
  // "... to the battlefield with a finality counter on it": the destination, then the rest.
  if (c.eat("to", "the", "battlefield")) return true;
  if (c.peek() === "into" || c.peek() === "to") {
    let rest = c.t.slice(c.i + 1);
    // "into a Frog with base power and toughness 3/3 until end of turn": the duration is the action's.
    const u = rest.indexOf("until");
    if (u > 0) rest = rest.slice(0, u);
    if (rest[0] === "its" || rest[0] === "their" || rest[0] === "your") { c.i = c.t.length; return true; }
    // "an Equipment you control to it", "to ~", "a Curse attached to you to one of your opponents".
    if ((rest.length === 1 && ["it", "them", "~"].includes(rest[0]!)) || (rest[0] === "one" && rest[1] === "of")) { c.i = c.t.length; return true; }
    if (rest.length && (parse(rest.join(" ")) || /^(?:\d+|x)\/(?:\d+|x)$/.test(rest.at(-1) ?? ""))) { c.i = c.t.length; return true; }
    return null;
  }
  // "of each color", "of each card type": a selection rule over the chosen cards, not their class.
  // ...but what it implies of each card stays: one "of each permanent type" is a permanent card, and
  // one "of each color" has a colour.
  if (c.eat("of", "each", "permanent", "type")) { r.groups[r.groups.length - 1]!.types.push("permanent"); return true; }
  if (c.eat("of", "each", "color")) { if (!r.colorCount) r.colorCount = "colored"; return true; }
  if (c.eat("of", "each", "card", "type")) return true;
  // "of a chosen color", "of the color of your choice": the chosen-quality filter `chosenType` holds.
  if (c.eat("of", "a", "chosen", "color") || c.eat("of", "a", "chosen", "type") || c.eat("of", "the", "color", "of", "your", "choice")) { r.chosenType = true; return true; }
  // "of the creature type of your choice" is the chosen type, chosen as it resolves.
  if (c.eat("of", "the", "creature", "type", "of", "your", "choice")) { r.chosenType = true; return true; }
  if (c.eat("of", "the", "chosen")) {
    if (c.eat("color", "and", "type")) { r.chosenType = true; return true; }
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
  // "that isn't a Demon, Devil, or Imp", "that aren't of the chosen type", "that's not attacking".
  if (c.eat("that", "isn't") || c.eat("that", "aren't") || c.eat("that's", "not") || c.eat("that", "is", "not") || c.eat("that", "are", "not")) {
    // "that aren't of the chosen type": every one but the chosen type.
    if (c.eat("of", "the", "chosen", "type") || c.eat("of", "the", "chosen", "creature", "type")) { (r.except ??= []).push({ chosenType: true }); return true; }
    if (c.eat("a", "commander")) { (r.except ??= []).push({ commander: true }); return true; }
    if (c.eat("attacking")) { r.notStatus.push("attacking"); return true; }
    if (c.eat("blocking")) { r.notStatus.push("blocking"); return true; }
    if (STATUSES.has(c.peek() ?? "")) { r.notStatus.push(c.t[c.i++]!); return true; }
    if (c.eat("legendary")) { r.legendary = false; return true; }
    // "that isn't all colors", "that isn't exactly two colors": every one but those.
    if (c.eat("all", "colors")) { (r.except ??= []).push({ colorCount: "all" }); return true; }
    if (c.eat("exactly", "two", "colors")) { (r.except ??= []).push({ colorCount: "exactly-two" }); return true; }
    const x = reading();
    if (!c.eat("a")) c.eat("an");
    const n = nominal(c, x);
    if (n !== true || !c.done) return null;
    const types = x.groups.flatMap((g) => g.types), subs = x.groups.flatMap((g) => g.subtypes);
    if (types.length && subs.length) return null;
    for (const t of types) if ((CARD_TYPES as readonly string[]).includes(t) && !r.notTypes.includes(t)) r.notTypes.push(t);
    for (const t of subs) if (!r.notSubtypes.includes(t)) r.notSubtypes.push(t);
    if (!types.length && !subs.length) return null;
    return true;
  }
  // "token copies of target permanent": the same as "tokens that are copies of".
  if (r.tokenHead && c.peek() === "copies" && c.peek(1) === "of") { c.t = [...c.t.slice(0, c.i), "that", "are", ...c.t.slice(c.i)]; }
  if (c.eat("that's") || c.eat("that", "is") || c.eat("that", "are")) {
    // COLOUR COUNTS: "that's all colors", "exactly two colors", "one or more colors", "both black and green".
    if (c.eat("all", "colors")) { r.colorCount = "all"; return true; }
    if (c.eat("exactly", "two", "colors")) { r.colorCount = "exactly-two"; return true; }
    if (c.eat("one", "or", "more", "colors")) { r.colorCount = "colored"; return true; }
    if (c.eat("both") && COLOR_WORDS[c.peek() ?? ""] && c.peek(1) === "and" && COLOR_WORDS[c.peek(2) ?? ""]) {
      r.allColors = [COLOR_WORDS[c.peek()!]!, COLOR_WORDS[c.peek(2)!]!]; c.i += 3; return true;
    }
    // A CLASS THE SUBJECT IS ALSO: "each creature you control that's a Wolf or a Werewolf", "target
    // card that's an instant or sorcery". Only where it narrows what the head left open: a subtype
    // beside a type, or a type beside an umbrella or nothing.
    {
      const save = c.i;
      const x = reading();
      if (!c.eat("a")) c.eat("an");
      const n = nominal(c, x);
      const types = x.groups.flatMap((g) => g.types), subs = x.groups.flatMap((g) => g.subtypes);
      // Only a clause that names a class; "that's attacking" falls through to the states below.
      if (n === true && c.done && (types.length || subs.length)) {
        const headTypes = r.groups.flatMap((g) => g.types).filter((t) => (CARD_TYPES as readonly string[]).includes(t));
        const headSubs = r.groups.flatMap((g) => g.subtypes);
        if (subs.length && !types.length && !headSubs.length && r.groups.length === 1) { r.groups[0]!.subtypes.push(...subs); return true; }
        // The clause's alternatives become the subject's: "an instant or sorcery" stays an OR.
        if (types.length && !subs.length && !headTypes.length && r.groups.length === 1) {
          const head = r.groups[0]!;
          r.groups = x.groups.map((g, i) => ({ ...g, types: i === 0 ? [...head.types, ...g.types] : g.types, adj: i === 0 ? [...head.adj, ...g.adj] : g.adj, from: undefined }));
          return true;
        }
        return null;
      }
      c.i = save;
    }
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
      // ", except it isn't legendary", ", except it has haste": the copy's exceptions (CR 707.9b).
      // Read off the end first, so the original is parsed without them. An exception that sets new
      // characteristics ("except it's a 1/1 green Frog") is refused.
      const ex = c.t.findIndex((w, k) => k >= c.i && w === "," && c.t[k + 1] === "except");
      let exception: { legendary?: boolean; keywords: string[]; notKeywords: string[]; counter?: string; sets?: Reading } | undefined;
      if (ex >= 0) {
        const e = new Cursor(c.t.slice(ex + 2), c.spellNoun);
        exception = { keywords: [], notKeywords: [] };
        do {
          if (e.eat("it's", "legendary") && (e.done || e.peek() === "and")) { exception.legendary = true; continue; }
          // "except it's a 4/4 black Zombie", "except the token is 1/1": characteristics the
          // exception SETS (CR 707.9b), which replace the copied ones it names.
          if (e.eat("it's", "a") || e.eat("it's", "an") || e.eat("the", "token", "is") || e.eat("it's")) {
            const x2 = reading();
            if (nominal(e, x2) !== true || exception.sets) return null;
            while (!e.done && e.peek() !== "and") if (post(e, x2) !== true) return null;
            exception.sets = x2; continue;
          }
          // "except it has haste AND LOSES soulbond": the subject carries over the "and".
          const carried = e.i > 0 && e.t[e.i - 1] === "and" && ["has", "loses", "isn't"].includes(e.peek() ?? "");
          if (!carried && !(e.eat("it") || e.eat("the", "token"))) return null;
          if (e.eat("isn't", "legendary") || e.eat("is", "not", "legendary")) exception.legendary = false;
          else if (e.eat("has")) {
            const ks = keywordList(e); if (!ks) return null; exception.keywords.push(...ks);
            // "except it has haste and the ability from clause 3": an ability the sentence states.
            if (e.eat("and", "the", "ability", "from")) e.i = e.t.length;
          }
          else if (e.eat("loses")) { const ks = keywordList(e); if (!ks) return null; exception.notKeywords.push(...ks); }
          // "except it enters with an additional +1/+1 counter on it".
          else if (e.eat("enters", "with")) { if (!e.eat("an", "additional")) e.eat("additional"); const x3 = reading(); if (!counterPhrase(e, x3) || !x3.counter) return null; exception.counter = x3.counter; }
          else return null;
        } while (e.eat("and"));
        if (!e.done) return null;
        c.t = c.t.slice(0, ex);
      }
      // What the exception sets replaces what was copied: its size, colours, subtypes, types, name.
      const applyException = (): boolean => {
        if (!exception) return true;
        if (exception.legendary !== undefined) r.legendary = exception.legendary;
        r.keywords.push(...exception.keywords); r.notKeywords.push(...exception.notKeywords);
        if (exception.counter) r.counter = exception.counter;
        const set = exception.sets;
        if (!set) return true;
        const types = set.groups.flatMap((g) => g.types), subs = set.groups.flatMap((g) => g.subtypes);
        if (set.groups.length > 1) return false;
        if (set.stats.length) r.stats = set.stats;
        if (set.colors.size) { r.colors = set.colors; r.notColors = []; r.colorCount = undefined; }
        if (subs.length || types.length) {
          r.groups = [{ types: types.length ? types : r.groups.flatMap((g) => g.types), subtypes: subs, adj: [] }];
          r.notSubtypes = []; if (types.length) r.notTypes = [];
        }
        if (set.legendary !== undefined) r.legendary = set.legendary;
        if (set.named) r.named = set.named;
        // "except it's a 3/3 black Wraith WITH MENACE": abilities it has in addition.
        r.keywords.push(...set.keywords);
        return true;
      };
      // "a copy of the card Armadillo Cloak": a card by name.
      if (c.eat("the", "card") && !c.done) { r.named = c.t.slice(c.i).join(" "); c.i = c.t.length; return applyException() || null; }
      // "a copy of chosen artifact token or creature token": the chosen one's class.
      c.eat("chosen");
      const self = c.eat("this");
      const x = reading();
      // A copy of an object named elsewhere ("it", "that creature", "the exiled card") has that
      // object's class, which this phrase does not say: the token is all that is known. CEILING: the
      // class comes from the reference (task 4).
      // "a token that's a copy of it for each token you control ...": the count is the action's.
      { const fe = c.t.findIndex((w, k) => k > c.i && w === "for" && c.t[k + 1] === "each"); if (fe > 0) c.t = c.t.slice(0, fe); }
      if (!self && (c.eat("it") || ((c.eat("that") || c.eat("the") || c.eat("enchanted") || c.eat("equipped") || c.eat("chosen")) && !c.done && (c.eat("exiled", "card") || c.eat("sacrificed", "creature") || nominalWord(c, reading()) === true)))) {
        if (!c.done) return null;
        return applyException() || null;
      }
      if (self) {
        while (!c.done && nominalWord(c, x) === true);
        // "copies of this creature AND THAT ARE TAPPED AND ATTACKING" (Nacatl War-Pride): the states the
        // copies enter with.
        if (c.eat("and", "that", "are", "tapped", "and", "attacking")) { r.tapped = true; r.combat = "attacking"; }
        if (!c.done) return null;
      }
      else {
        const at = c.i;
        const o = object(c);
        if (o) Object.assign(x, o);
        else {
          // "copies of target artifact card in a graveyard or artifact on the battlefield" (Daretti): a
          // list whose items share a class -- the copy has it, wherever the original was.
          const f = parse(c.t.slice(at).join(" "));
          const type = f?.type ?? (f?.anyOf && new Set(f.anyOf.map((b) => stableJson(b.type))).size === 1 ? f.anyOf[0]!.type : undefined);
          if (!f || type === undefined || f.subtype !== undefined) return null;
          c.i = c.t.length;
          x.groups = [{ types: [type].flat(), subtypes: [], adj: [] }];
        }
      }
      // A copy of a token ("a copy of target token you control") has the token's class, which the
      // phrase says no more of than that it is a token.
      if (!x.groups.some((g) => g.types.length || g.subtypes.length) && x.token !== true) return null;
      Object.assign(r, {
        groups: x.groups, notTypes: x.notTypes, notSubtypes: x.notSubtypes, colors: x.colors, stats: x.stats,
        keywords: x.keywords, notKeywords: x.notKeywords, legendary: x.legendary, chosenType: x.chosenType,
        historic: x.historic, outlaw: x.outlaw, snow: x.snow, basic: x.basic, notColors: x.notColors, colorCount: x.colorCount,
        // The name is copiable too.
        named: x.named, notNamed: x.notNamed,
      });
      return applyException() || null;
    }
    return null;
  }
  // WHOSE ABILITY: "a triggered ability of a permanent you control", "target activated ability from an
  // artifact source".
  if (r.ability && (c.eat("of") || c.eat("from"))) {
    const rest = c.t.slice(c.i);
    // A relative clause after the source ("... that target this creature") is the ABILITY's, which the
    // schema cannot say; and "enchanted creature" bare is a reference.
    // "of creatures you control that don't have the same name as this creature": the relative is the
    // SOURCES' (Marvin); "of Equipment you control that target this creature": the ABILITIES' (Bladegraft
    // Aspirant), what they target.
    {
      const k = rest.indexOf("that");
      const tail = k < 0 ? "" : rest.slice(k).join(" ");
      if (tail === "that don't have the same name as this creature") { const f = parse(rest.join(" ")); if (f) { c.i = c.t.length; const { token: _t, scope: _s, ...of } = f; r.abilityOf = of; return true; } }
      if (tail === "that target this creature") { const f = parse(rest.slice(0, k).join(" ")); if (f) { c.i = c.t.length; const { token: _t, scope: _s, ...of } = f; r.abilityOf = of; r.targets = { self: true, type: "creature" }; return true; } }
    }
    if (rest.some((w) => w === "that" || w === "which") || rest[0] === "enchanted" || rest[0] === "equipped") return null;
    // "of the top card of your library": a card, where it is.
    if (rest.join(" ") === "the top card of your library") { c.i = c.t.length; r.abilityOf = { zone: "library" }; return true; }
    const src = rest.at(-1) === "source" ? rest.slice(0, -1) : rest;
    const f = parse((src.length && !["a", "an", "target", "another"].includes(src[0]!) ? ["a", ...src] : src).join(" ").replace(/^(a|an) (a|an) /, "$1 "));
    if (!f) return null;
    c.i = c.t.length;
    const { token: _t, scope: _s, ...of } = f;
    r.abilityOf = of; return true;
  }
  // What follows "attached to" is what the subject is attached TO; it must parse, and it is dropped.
  // "enchanting target permanent", "enchanted by an Aura you control" say the same of an Aura.
  if (c.eat("attached", "to") || c.eat("enchanting")) return relatedObject(c);
  // ", where X is the number of ...": the count of X tokens, a magnitude (parseSubject's COUNT_PHRASE).
  if (c.eat(",", "where", "x", "is") || c.eat("where", "x", "is")) { c.i = c.t.length; return true; }
  // A count is a magnitude, not a class: "a Treasure token for each opponent".
  // CEILING: the count's own words are the amount's (scaling.ts), not read here, as ", where X is".
  if (c.eat("for", "each")) { if (c.done) return null; c.i = c.t.length; return true; }
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
  r.toks = c.t;
  quantifier(c, r);
  const n = nominal(c, r);
  // "any target", "any other target", "one or two targets": a target of any kind. The wildcard is
  // what `parseSubject` answers too: no class, scope target.
  if (n === false && (c.eat("targets") || r.target)) {
    r.target = true;
    while (!c.done) if (post(c, r) !== true) return null;
    return r;
  }
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

/** AN ADJECTIVE OR COLOUR ONE ALTERNATIVE CARRIES AND ANOTHER DOES NOT: "target artifact, enchantment,
 *  or TAPPED creature", "target Forest, GREEN enchantment, or GREEN planeswalker", "target tapped or
 *  blocking creature". The subject has one field for each, so each alternative is read on its own
 *  into an `anyOf` branch, and the rest of the phrase -- quantifier, controller, what follows -- is
 *  read once with the alternatives' adjectives taken out. An alternative with no noun takes the next
 *  one's ("tapped" + "creature"). In a first alternative with two adjectives and no noun, the first
 *  binds the whole list ("a goaded attacking or blocking creature"). */
function perAlternative(r: Reading): SubjectFilter | null {
  const toks = r.toks;
  if (!toks || r.restarted || r.ability || r.groups.some((g) => g.from === undefined || g.to === undefined)) return null;
  const nounOf = (g: Group) => { const at = new Set(g.adjAt ?? []); return toks.slice(g.from, g.to).filter((_, k) => !at.has(g.from! + k)); };
  const drop = new Set<number>();
  const branches: Partial<SubjectFilter>[] = [];
  for (let i = 0; i < r.groups.length; i++) {
    const g = r.groups[i]!;
    let words = toks.slice(g.from, g.to);
    if (nounOf(g).length === 0) {
      const next = r.groups[i + 1];
      const head = r.groups.slice(i + 1).map(nounOf).find((n) => n.length > 0);
      // Two adjectives before the first "or": the first binds the whole list ("a GOADED attacking or
      // blocking creature" is goaded either way), and stays in the outer reading.
      let shared = 0;
      if (words.length > 1) { if (i !== 0 || words.length > 2) return null; shared = 1; }
      if (!next || !head) return null;
      // Two states joined by "and" are both: "a tapped AND attacking token" is one token, tapped and
      // attacking. ("snow and Zombie creatures" joins a state to a class: two alternatives.)
      if (toks.slice(g.to, next.from).includes("and") && next.adjAt?.includes(next.from!)) return null;
      // Only the head noun: "snow and Zombie creatures" is snow creatures or Zombie creatures.
      words = [...words.slice(shared), head.at(-1)!];
      for (let k = g.from! + shared; k < next.from!; k++) drop.add(k);
    } else for (const k of g.adjAt ?? []) drop.add(k);
    const f = parse(words.join(" "));
    if (!f) return null;
    const { control, token, scope, ...rest } = f;
    // The quantifier is the whole phrase's: a branch's own plural scope says nothing.
    if (control !== "any" || (scope !== undefined && scope !== "all") || f.anyOf) return null;
    const b: Partial<SubjectFilter> = token === null ? rest : { ...rest, token };
    if (!branches.some((x) => stableJson(x) === stableJson(b))) branches.push(b);
  }
  const outer = parse(toks.filter((_, k) => !drop.has(k)).join(" "));
  // The outer reading's own alternatives are the same nouns split by slot ("a Swamp, Mountain, ...,
  // or permanent"): the branches replace them. Any other alternatives would be lost.
  if (!outer || outer.anyOf?.some((b) => Object.keys(b).some((k) => !["type", "subtype", "allTypes"].includes(k)))) return null;
  delete outer.anyOf;
  delete outer.type; delete outer.subtype; delete outer.allTypes; delete outer.umbrella;
  if (outer.token === null && branches.some((b) => b.token !== undefined)) outer.token = null;
  // What every branch says the same is the subject's ("black spells and green spells": spells), and
  // branches left naming only a type are one type list ("target black creature or black planeswalker").
  for (const k of Object.keys(branches[0]!) as (keyof SubjectFilter)[]) {
    const v = stableJson(branches[0]![k]);
    if (branches.every((b) => k in b && stableJson(b[k]) === v)) {
      (outer as unknown as Record<string, unknown>)[k] = branches[0]![k];
      for (const b of branches) delete b[k];
    }
  }
  if (branches.every((b) => Object.keys(b).length === 1 && Array.isArray(b.type) === false && typeof b.type === "string")) {
    outer.type = lowerTypes(branches.map((b) => b.type as string), []).type!;
    return outer;
  }
  if (branches.some((b) => Object.keys(b).length === 0)) return null;
  return { ...outer, anyOf: branches };
}

function lower(r: Reading): SubjectFilter | null {
  // A COLOUR THAT BELONGS TO ONE ALTERNATIVE. "a Swamp, Mountain, black permanent, or red permanent"
  // gives black to one branch and red to another, and `colors` binds every branch: the Swamp would
  // have to be black or red. Refused. Colours BEFORE the first noun are shared adjectives ("a white
  // or blue instant or sorcery spell") and fine.
  if (r.colorAfterHead && r.groups.filter((g) => g.types.length > 0 || g.subtypes.length > 0).length > 1) return perAlternative(r);
  // A ONE-VALUE ADJECTIVE IN ONE ALTERNATIVE ONLY. "target artifact or TAPPED creature", "target
  // tapped or blocking creature", "other snow and Zombie creatures": `tapped`, `snow` and the rest
  // bind the whole subject, so an adjective one alternative carries and another does not cannot be
  // said. Refused; "a multicolored creature or multicolored enchantment" says it in both and is fine.
  // An adjective before the FIRST noun of a noun list binds the whole list ("a multicolored instant
  // or sorcery spell"); one that stands alone as an alternative ("snow and Zombie creatures") does not.
  const leading = r.groups[0]!.adj.length > 0 && (r.groups[0]!.types.length > 0 || r.groups[0]!.subtypes.length > 0)
    && r.groups.slice(1).every((g) => g.adj.length === 0) && !r.restarted;
  if (r.groups.length > 1 && r.groups.some((g) => g.adj.length) && !leading
    && new Set(r.groups.map((g) => [...g.adj].sort().join())).size > 1) return perAlternative(r);
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
  // "target spell or ability", "target instant spell, sorcery spell, activated ability, or triggered
  // ability": an OR across a card and an ability, one branch each. A spell-or-ability with no kind
  // named is an activated or triggered one, the abilities that use the stack (CR 113.3, 605.3b).
  if (r.ability && r.groups.some((g) => g.types.length || g.subtypes.length)) {
    if (r.token !== null || r.groups.some((g) => !g.ability && !g.types.length && !g.subtypes.length && g.kinds?.length)) return null;
    const kinds = [...new Set(r.groups.filter((g) => g.ability || g.kinds?.length).flatMap((g) => g.kinds ?? []))];
    const typeWords = r.groups.filter((g) => !g.ability && !g.kinds?.length).flatMap((g) => g.types);
    const subs = r.groups.filter((g) => !g.ability && !g.kinds?.length).flatMap((g) => g.subtypes);
    if (!typeWords.length || subs.length) return null;
    const { type } = lowerTypes(typeWords, r.notTypes);
    const spellOrAbility: SubjectFilter = { control: r.control ?? "any", token: null,
      anyOf: [{ type: type! }, { abilityKind: (kinds.length ? kinds : ["activated", "triggered"]) as NonNullable<SubjectFilter["abilityKind"]> }] };
    const scope = scopeOf(r);
    if (scope) spellOrAbility.scope = scope;
    if (r.other) spellOrAbility.other = true;
    if (r.colors.size || r.stats.length || r.keywords.length || r.status.length || r.legendary !== undefined || r.colorCount) return null;
    // A targeting restriction or a stated target binds both alternatives, and must not be dropped.
    if (r.restricted) spellOrAbility.restricted = true;
    if (r.targets) spellOrAbility.targets = r.targets;
    return spellOrAbility;
  }
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
  // ALTERNATIVES WITH TYPES OF THEIR OWN: "a creature card or Garruk planeswalker card", "target
  // Dragon creature card or Ugin planeswalker card". One `type` and one `subtype` would AND every
  // subtype with every type (a Garruk creature); each alternative is its own branch instead. An
  // alternative with no type of its own takes the next one's ("an Elf or Warrior creature"), and
  // when every alternative ends up with the same types the plain encoding stands.
  // A subtype that LEADS the list, with none in the alternatives after it, is shared by all of them
  // ("an Adventure instant or sorcery spell"): the plain encoding says that.
  const leadingSubtype = r.groups[0]!.subtypes.length > 0 && r.groups.slice(1).every((g) => g.subtypes.length === 0);
  if (!out.anyOf && !leadingSubtype && r.groups.length > 1 && r.groups.some((g) => g.subtypes.length && g.types.length)) {
    const eff = r.groups.map((g) => [...g.types]);
    for (let i = eff.length - 2; i >= 0; i--) if (eff[i]!.length === 0 && !r.groups[i]!.head) eff[i] = [...eff[i + 1]!];
    if (new Set(eff.map((t) => stableJson(lowerTypes(t, []).type))).size > 1) {
      delete out.type; delete out.subtype; delete out.allTypes;
      const branches: Partial<SubjectFilter>[] = [];
      r.groups.forEach((g, i) => {
        const t = lowerTypes(eff[i]!, []).type;
        const b: Partial<SubjectFilter> = {
          ...(t !== undefined ? { type: t } : {}),
          ...(g.subtypes.length ? { subtype: g.subtypes.length === 1 ? g.subtypes[0] : [...g.subtypes] } : {}),
        };
        if (Object.keys(b).length && !branches.some((x) => stableJson(x) === stableJson(b))) branches.push(b);
      });
      out.anyOf = branches;
    }
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
  if (r.snow !== undefined) out.snow = r.snow;
  if (r.tapped !== undefined) out.tapped = r.tapped;
  if (r.notColors.length) out.notColors = WUBRG.filter((x) => r.notColors.includes(x));
  if (r.colorCount) out.colorCount = r.colorCount;
  if (r.hasCounter !== undefined) out.hasCounter = r.hasCounter;
  if (r.allColors) out.allColors = r.allColors;
  if (r.targets) out.targets = r.targets;
  if (r.status.length) out.status = [...r.status];
  if (r.notStatus.length) out.notStatus = [...r.notStatus];
  if (r.except) out.except = r.except;
  if (r.history.length) out.history = [...r.history];
  if (r.shares) out.shares = r.shares;
  if (r.nameRelation) out.nameRelation = r.nameRelation;
  if (r.notNamed) out.notNamed = r.notNamed;
  if (r.abilityOf) out.abilityOf = r.abilityOf;
  if (r.notFromZone) out.notFromZone = r.notFromZone;
  if (r.notCast) out.notCast = true;
  if (r.combatWith) out.combatWith = r.combatWith;
  if (r.condition) out.condition = r.condition;
  if (r.printedIn) out.printedIn = r.printedIn;
  if (r.otherThanRef) out.otherThanRef = true;
  // Alternatives the outer subject cannot hold, each as `anyOf` (and only one such list per subject).
  const alts: Partial<SubjectFilter>[][] = [];
  if (r.ownOrControl) { if (out.control !== "any") return null; alts.push([{ owner: "you" }, { control: "you" }]); }
  if (r.zoneAlternatives) alts.push(r.zoneAlternatives.map((z) => (r.zoneAlternativesFrom ? { fromZone: z } : { zone: z })));
  if (r.keywordAlternatives) alts.push(r.keywordAlternatives.map((k) => ({ keyword: [k] })));
  if (alts.length > 1 || (alts.length && (out.anyOf || r.statusAlternatives))) return null;
  if (alts.length) out.anyOf = alts[0];
  if (r.statusAlternatives) {
    if (out.anyOf) return null;
    out.anyOf = r.statusAlternatives.map((x) => ({ status: [x] }));
  }
  if (r.sharesAlternatives) {
    if (out.anyOf) return null;
    out.anyOf = r.sharesAlternatives.map((x) => ({ shares: x }));
  }
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
  // "a number of 1/1 red Warrior creature tokens equal to the number of ...": the count is the action's.
  {
    const m = /^a number of (.+?) equal to\b/i.exec(text.trim());
    if (m) return parse(m[1]!);
  }
  // "a land's ability": an ability, of an object of that class.
  {
    const m = /^an? (\w+)'s ability$/i.exec(text.trim());
    if (m) { const of = parse(`a ${m[1]}`); if (of && (of.type !== undefined || of.subtype !== undefined)) { const { token: _t, scope: _s, ...o } = of; return { control: "any", token: null, abilityOf: o }; } }
  }
  // A DESTINATION'S OBJECT with its preposition ("on target creature you control", "to legendary
  // creature"): the noun phrase after it is the filter.
  {
    const m = /^(?:on|to|onto) ((?:target|a|an|each|another) .+|legendary .+)$/i.exec(text.trim()) ?? /^with ((?:an|target) opponent)$/i.exec(text.trim());
    if (m) return parse(m[1]!);
  }
  // A TOKEN NAMED AFTER A CARD ("a Tarmogoyf token", "a Walker token", "a Spellgorger Weird token"): the
  // capitalised words before "token" that are no type, subtype or colour are its name, read past
  // (CR 111.4: the token's own name is never a card to look for).
  {
    const m = /^((?:an?|two|three|X|\d+) (?:tapped )?)((?:[A-Z][\w'-]* )+)(tokens?\b.*)$/.exec(text.trim());
    const plain = (w: string) => { const l = w.toLowerCase(); return !SUBTYPES.has(l) && !SUBTYPES.has(l.replace(/s$/, "")) && !TYPE_WORDS.has(l) && !COLOR_WORDS[l] && !ROLE_NAMES.some((r) => r.includes(l)); };
    if (m) {
      // The name is the leading words that are no class: "a Spellgorger WEIRD token" keeps Weird.
      const ws = m[2]!.trim().split(" ");
      const n = ws.findIndex((w) => !plain(w));
      const name = n < 0 ? ws : ws.slice(0, n);
      if (name.length && ws.slice(name.length).every((w) => !plain(w))) text = m[1]! + ws.slice(name.length).map((w) => w + " ").join("") + m[3]!;
    }
  }
  // A TOKEN'S QUOTED ABILITY ("a 1/1 Rat creature token with \"This token can't block.\"") is
  // rules text the token has, not a class it belongs to. Read past, after "with" or "and".
  // CEILING: the ability is not kept; a demand on a granted ability would need it.
  // ", \"Equipped creature gets +5/+5 ...,\" and equip {0}": a quoted ability inside a keyword list too.
  // "and that ability" / "and this ability" names one the sentence quoted.
  if (/\btokens?\b/i.test(text)) text = text.replace(/ with "[^"]*" and /g, " with ").replace(/,? and "[^"]*"/g, "").replace(/ (?:and|with) "[^"]*"/g, "").replace(/, "[^"]*"/g, "").replace(/,? and (?:that|this) ability$/, "").replace(/ with (?:that|this) ability$/, "");
  // A GRANTED ABILITY after the recipient ("Planeswalkers you control, \"[-4]: ...\"", "... and the
  // ability: Whenever this token enters, ..."), and a copy's exception that only grants one: the
  // ability is the action's, as above.
  text = text.replace(/, "[^"]*"\.?$/, "").replace(/, except it has "[^"]*"\.?$/, "");
  { const k = text.indexOf(" and the ability: "); if (k >= 0) text = text.slice(0, k).replace(/,$/, ""); }
  // A TOKEN'S UNQUOTED ABILITY: "Eldrazi Spawn creature tokens with Sacrifice this token: Add {C}".
  if (/\btokens?\b/i.test(text)) {
    const w = text.search(/ with [A-Z]/), colon = w < 0 ? -1 : text.indexOf(": ", w);
    if (colon > 0 && !text.slice(w, colon).includes('"')) text = text.slice(0, w);
  }
  // "which have the same name": "which" is "that".
  text = text.replace(/\bwhich\b/g, "that");
  const toks = lex(text);
  if (!toks || toks.length === 0) return null;
  // "Enchant creature you control": the keyword line names the class the Aura can enchant
  // (CR 303.4a), and that class is a filter phrase like any other.
  if (toks[0] === "enchant" && toks.length > 1) return parse(toks.slice(1).join(" "));
  // "target creature's controller", "target spell's owner": a PLAYER, named through an object. The
  // object is targeted, the player is not; what is known of the player is that it is one.
  {
    const last = toks.at(-1);
    if ((last === "controller" || last === "owner") && toks.length >= 3 && /'s$/.test(toks.at(-2)!)) {
      const obj = [...toks.slice(0, -2), toks.at(-2)!.replace(/'s$/, "")];
      if ((obj[0] === "target" || obj[0] === "each") && parse(obj.join(" "))) return { control: "any", token: null, ...(obj[0] === "each" ? { scope: "each" as const } : {}) };
    }
  }
  // "Marit Lage, a legendary 20/20 black Avatar creature token with flying": the token's own name, then
  // the token. The name is the token's, never a card to look for (CR 111.4), so it is read past.
  // The name may hold commas of its own ("Voja, Friend to Elves, a legendary 3/3 ... token"): the
  // apposition is the first comma that a/an follows.
  const appos = toks.findIndex((w, k) => w === "," && (toks[k + 1] === "a" || toks[k + 1] === "an"));
  // Only a NAME stands before the comma: "a Blood token, a Clue token" is a list, not a named token.
  if (appos > 0 && toks.slice(appos).some((w) => w === "token" || w === "tokens")
    && parse(toks.slice(0, appos).join(" ")) === null) {
    const tail = parse(toks.slice(appos + 1).join(" "));
    if (tail?.token === true) return tail;
  }
  const spellNoun = toks.some((w) => /^(?:spells?|instants?|sorcery|sorceries|cards?)$/.test(w));
  const asPlayer = player(new Cursor(toks, spellNoun));
  if (asPlayer) return asPlayer;
  const r = object(new Cursor(toks, spellNoun));
  // A reading that lowering refuses (a colour or adjective in one alternative) may still be a list of
  // whole noun phrases, each with its own ("a black creature or a red creature").
  const f = r ? lower(r) : null;
  if (f) return f;
  return nounPhraseList(toks) ?? grantRecipient(toks);
}

/** A GRANT OBJECT: "target creature, trample", "creatures you control; haste", "target creature
 *  +2/+0", "Commander creatures you own flying" -- the clause store writes the recipient and what it
 *  gains as one object. The recipient is the filter. CEILING: what it gains belongs to the action
 *  (`grant-ability`, `pump`), not to the subject, and is not kept here. */
function grantRecipient(toks: string[]): SubjectFilter | null {
  const isGrant = (rest0: string[]): boolean => {
    // A duration or a count after the grant is the action's: "haste until end of turn", "+X/+X until
    // end of turn, where X is ...".
    let rest = rest0;
    const w = rest.findIndex((x, k) => x === "," && rest[k + 1] === "where");
    if (w >= 0) rest = rest.slice(0, w);
    // "+1/+0 for each time counter on this artifact", "shroud for as long as this creature remains
    // tapped", "+2/+2 until end of turn if it is a Snake": a count, a duration, or a condition on it.
    const tail = rest.findIndex((x, k) => (x === "for" && (rest[k + 1] === "each" || rest[k + 1] === "as")) || (x === "if" && rest[k + 1] === "it" || x === "if" && rest[k + 1] === "it's"));
    if (tail > 0) rest = rest.slice(0, tail);
    if (rest.at(-1) === ",") rest = rest.slice(0, -1);
    // "the ability from this effect": an ability the sentence grants.
    if (rest[0] === "the" && rest[1] === "ability" && rest[2] === "from") return true;
    for (const tail of [["until", "end", "of", "turn"], ["until", "your", "next", "turn"]]) {
      if (rest.length > tail.length && tail.every((x, j) => rest[rest.length - tail.length + j] === x)) rest = rest.slice(0, -tail.length);
    }
    if (rest.length === 0) return false;
    // A colour or a status granted: "blue until end of turn", "saddled until end of turn".
    if (rest.length === 1 && (COLOR_WORDS[rest[0]!] || STATUSES.has(rest[0]!) || rest[0] === "saddled")) return true;
    if (rest.every((w) => /^[+-](?:\d+|x)\/[+-](?:\d+|x)$/.test(w))) return true;
    const kc = new Cursor(rest, false);
    return keywordList(kc) !== undefined && kc.done;
  };
  for (let k = toks.length - 1; k > 0; k--) {
    const sep = toks[k - 1] === "," || toks[k - 1] === ";" || toks[k - 1] === ":";
    const head = sep ? toks.slice(0, k - 1) : toks.slice(0, k);
    if (head.length === 0 || !isGrant(toks.slice(k))) continue;
    const f = parse(head.join(" "));
    if (f && (f.type !== undefined || f.subtype !== undefined || f.anyOf !== undefined || f.token === true)) return f;
  }
  return null;
}

const PLAYER_WORDS = new Set(["player", "players", "opponent", "opponents", "you"]);
const QUANTIFIER_WORDS = new Set(["a", "an", "target", "another", "each", "up", "to", "one", "two", "three", "x", "any", "number", "of", "other", "all"]);

function isPlayerPhrase(toks: string[]): boolean {
  const spellNoun = toks.some((w) => /^(?:spells?|instants?|sorcery|sorceries|cards?)$/.test(w));
  return player(new Cursor(toks, spellNoun)) !== null;
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
  const stop = relative < 0 ? toks.length : relative;
  // A LIST NAMING A PLAYER ("target player or planeswalker", "another target creature, planeswalker, or
  // player") splits at every joiner and comma: its items are nouns, and a player is no adjective.
  // A player as an ITEM, not "you control" or "an opponent controls" inside another item.
  const withPlayer = toks.slice(0, stop).some((w, k) => PLAYER_WORDS.has(w)
    && !["control", "controls", "own", "owns", "cast", "casts", "don't"].includes(toks[k + 1] ?? "")
    && (w !== "you" || k === 0 || [",", "or", "and", "and/or"].includes(toks[k - 1]!)));
  for (let k = 1; k < stop - 1; k++) {
    // "tokens plus a Mutagen token": one more, joined like "and".
    const joiner = toks[k] === "and" || toks[k] === "or" || toks[k] === "and/or" || toks[k] === "plus";
    // A comma list that ends ", or X" splits at every comma: "target Spirit, creature with disturb, or
    // enchantment" (only reached when the one-noun-phrase reading failed).
    // The first item is one bare noun, so no leading adjective is left behind ("target ATTACKING
    // Cleric, Rogue, ..." shares "attacking" with every item).
    const q = toks.findIndex((w) => !QUANTIFIER_WORDS.has(w));
    // ...or an ability ("target activated ability, triggered ability, or legendary spell", Tale's End).
    const commaList = (toks[q + 1] === "," || (toks[q + 1] === "ability" && toks[q + 2] === ",")) && toks.slice(0, stop).some((w, j) => w === "," && (toks[j + 1] === "or" || toks[j + 1] === "and"));
    const comma = toks[k] === "," && !["and", "or", "and/or"].includes(toks[k + 1]!) && (withPlayer || NP_START.has(toks[k + 1]!) || commaList);
    // A colour after "or" starts a new noun phrase once the one before has its noun: "a Swamp or black
    // permanent", "target black creature or black planeswalker".
    const colourStart = joiner && /^(?:non-?)?(?:white|blue|black|red|green|colorless)$/.test(toks[k + 1]!) && k > 0 && !/^(?:non-?)?(?:white|blue|black|red|green)$/.test(toks[k - 1]!);
    // A joiner after a finished noun phrase ("creatures you CONTROL and/or creature cards in your graveyard",
    // "target creature on the BATTLEFIELD or creature card in a graveyard") starts the next one.
    // ...but "from your hand OR GRAVEYARD" is one zone list.
    const closed = joiner && ["control", "controls", "own", "owns", "battlefield", "graveyard", "hand", "library", "exile"].includes(toks[k - 1]!)
      && !["control", "controls", "own", "owns", "your", "their", "the", "from"].includes(toks[k + 1]!) && !ZONES.has(toks[k + 1]!);
    // "... or its controller": the player who controls the item before.
    const itsController = joiner && toks[k + 1] === "its" && toks[k + 2] === "controller";
    // "two lands and THIS ARTIFACT": the card itself as the last item.
    const thisItem = joiner && toks[k + 1] === "this" && k + 3 === toks.length;
    // "all creatures and GRAVEYARDS".
    const zoneItem = joiner && toks[k + 1] === "graveyards" && k + 2 === toks.length;
    if (!comma && (!joiner || !(NP_START.has(toks[k + 1]!) || withPlayer || colourStart || closed || itsController || thisItem || zoneItem || (commaList && toks[k - 1] === ",")))) continue;
    const end = toks[k - 1] === "," ? k - 1 : k;
    parts.push(toks.slice(from, end));
    from = k + 1;
  }
  if (parts.length === 0) return null;
  parts.push(toks.slice(from));
  // A bare item takes the first item's quantifier: "target player or planeswalker" is a target too.
  const lead: string[] = [];
  for (const w of parts[0]!) { if (QUANTIFIER_WORDS.has(w)) lead.push(w); else break; }
  const items = parts.map((p, i) => (i > 0 && !QUANTIFIER_WORDS.has(p[0]!) && p[0] !== "you" && p[0] !== "this" ? [...lead, ...p] : p));
  const parsed = items.map((p, i) => {
    // "up to one target creature or ITS CONTROLLER": the player who controls the other item.
    if (p.join(" ") === "its controller" || p.join(" ") === "target its controller" || p.join(" ") === "up to one target its controller") return { control: "any" as const, token: null, player: true as const };
    // "all creatures and GRAVEYARDS" (Ultimate Nullification): every card in them.
    if (p.join(" ") === "graveyards" || p.join(" ") === "all graveyards") return { control: "any" as const, token: null, zone: "graveyard" };
    // "a loyalty ability ACTIVATION" (Repeated Reverberation): the ability.
    if (p.at(-1) === "activation" && p.at(-2) === "ability") return parse(p.slice(0, -1).join(" "));
    // "two lands and THIS ARTIFACT": the card itself, of its type. Never FIRST: "this creature or
    // another Ally you control" is the self-or-class twin derive builds (#295, task 4).
    if (p[0] === "this" && p.length === 2 && i > 0) { const t = parse(`a ${p[1]}`); return t && (t.type !== undefined || t.subtype !== undefined) ? { ...t, self: true } : null; }
    const f = parse(p.join(" "));
    // A player item is a branch of its own (`player`), never a wildcard.
    return f && isPlayerPhrase(p) ? { ...f, player: true as const } : f;
  });
  // "you and any target": a player and any target -- the union is any target, or you.
  if (items.length === 2 && parsed[0]?.player && parsed[0].control === "you" && items[1]!.join(" ") === "any target") {
    return { control: "any", token: null, anyOf: [{ player: true, control: "you" }, { scope: "target" }] };
  }
  // An item must name SOMETHING beyond the quantifier ("a white card", "a card with mana value 4 or
  // greater", "a card from your graveyard"); "another card" alone adds nothing and is still an item.
  // Each item needs its own noun, too: "all BLACK and all red creature cards" is one noun shared, not
  // two items.
  const NOUNS = /^(?:cards?|tokens?|spells?|permanents?|abilit(?:y|ies)|players?|opponents?|you|targets?)$/;
  if (parsed.some((f, i) => !f || (Object.keys(f).every((k) => k === "control" || k === "token" || k === "scope") && f.control === "any" && f.token === null)
    || (f.type === undefined && f.subtype === undefined && f.anyOf === undefined && f.zone === undefined && !items[i]!.some((w) => NOUNS.test(w))))) return null;
  // Only players ("you and target opponent"): each its own player branch.
  if (parsed.every((f) => f!.player === true)) {
    const bs: Partial<SubjectFilter>[] = parsed.map((f) => { const { control, token: _t, scope: _s, player: _p, ...rest } = f!; return { player: true as const, ...(control !== "any" ? { control } : {}), ...rest } as Partial<SubjectFilter>; });
    return { control: "any", token: null, anyOf: bs };
  }
  const fs = parsed as SubjectFilter[];
  // A POST-MODIFIER AFTER THE LAST ITEM binds them all ("Black spells and green spells YOU CAST",
  // "artifact spells and colorless spells FROM THE TOP OF YOUR LIBRARY") when the items before it have
  // none of their own.
  const last = fs.at(-1)!;
  const POST_WORDS = new Set(["you", "control", "controls", "own", "owns", "from", "in", "on", "with", "without", "named", "that", "who", "cast", "an", "opponent"]);
  // The head noun: the word before the first post-modifier.
  const headOf = (it: string[]) => { const k = it.findIndex((w, j) => j > 0 && POST_WORDS.has(w)); return (k < 0 ? it : it.slice(0, k)).at(-1); };
  items.slice(0, -1).forEach((it, i) => {
    if (it.slice(1).some((w) => POST_WORDS.has(w)) || fs[i]!.player) return;
    const f = fs[i] as unknown as Record<string, unknown>;
    // A zone binds the noun it follows: "an artifact or a CARD in your hand" puts only the card there,
    // and "your" there names the zone's owner, not the artifact's controller. The same noun twice
    // ("artifact spells and colorless spells from ...") shares it.
    const sameHead = headOf(it) === headOf(items.at(-1)!);
    if (!sameHead && (last.zone !== undefined || last.fromZone !== undefined)) return;
    if (f.control === "any" && last.control !== "any" && !last.player) f.control = last.control;
    if (f.owner === undefined && last.owner !== undefined) f.owner = last.owner;
    if (!sameHead) return;
    for (const k of ["fromZone", "zone", "notFromZone"] as const) if (f[k] === undefined && last[k] !== undefined) f[k] = last[k];
  });
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
