// The typed query syntax of /cards and /commanders (#1783): our own vocabulary, one text form that is also the
// `x=` URL parameter. Hand-written scanner and recursive descent over a char loop: NO regular expression
// (the issue rules them out, and CodeQL reads their shape as a risk).
//
// GRAMMAR (character offsets count from 0; keywords are lower case; field names are the catalogue's ids or aliases)
//
//   query  := or
//   or     := and { "or" and }                       loosest
//   and    := not { ["and"] not }                    "and" is optional: two terms side by side are both required
//   not    := ( "-" | "not" ) not | atom             tightest; "-" must touch what it negates
//   atom   := "(" or ")" | term
//   term   := "makes:" V                             the card causes this event   (an event key, e.g. dies|creature|-|-)
//           | "asks:" V                              the card asks for this event
//           | F ":" V                                has: a set field holds the value        st:borg
//           | "#" F [ "@" L ] BOUND                  count of a set field's values (within named list L)   #st@creature>=3
//           | F BOUND                                a numeric field within bounds           mv<=3
//           | F "<=" LETTERS | F "=" LETTERS         a set field's values all within / exactly these   id<=WUG, id=C
//   BOUND  := ">=" N | "<=" N | "=" N | "=" N ".." N        always inclusive; N is a whole number
//   V      := text up to a space or a parenthesis, or "quoted" with \" and \\ escapes
//
// `C` alone as LETTERS means no colour at all (an empty set), unless the field has a value spelled C.
// An unknown field, value, list or event is an error that names it and says where; nothing is ever dropped.
//
// `print` is the canonical text and `parse(print(ast)) = ast` for every canonical AST (`parse` property test).
import type { Node } from "./evaluate.js";

export type QueryLeaf =
  | { op: "event"; side: "makes" | "asks"; key: string }
  | Extract<Node, { field: string }>;
export type Query = { and: Query[] } | { or: Query[] } | { not: Query } | QueryLeaf;

/** `cannot`: the text is well formed but this build cannot check it (a vocabulary table it lacks). The page says so and
 *  draws no list, and "fix the query" would be the wrong advice. */
export interface QueryError { pos: number; message: string; cannot?: true }

/** One field the text may name. `values` undefined = this build cannot say which values are valid, so a value is
 *  refused as unjudgeable (`noValues` says why), never passed on to an empty answer. */
export interface SchemaField {
  id: string;
  kind: "set" | "number";
  alias?: string;
  values?: readonly string[];
  /** Why `values` is missing, in the words of "can't check value `x` for st: <this>". */
  noValues?: string;
}

export interface QuerySchema {
  fields: readonly SchemaField[];
  /** The named lists `@list` may name. */
  lists: readonly string[];
  /** The event keys each word accepts. null = not loaded yet: events are not judged (and `usesEvents` says so). */
  events: { makes: ReadonlySet<string>; asks: ReadonlySet<string> } | null;
}

export type ParseResult =
  | { ok: true; ast: Query | null; usesEvents: boolean }
  | { ok: false; error: QueryError };

const RESERVED: ReadonlySet<string> = new Set(["and", "or", "not", "makes", "asks"]);
/** What may not appear inside a field name or a list name. */
const NAME_STOP = " \t\r\n():#@<>=\"";
const WS = " \t\r\n";
const DIGITS = "0123456789";
const SAFE_VALUE = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-.|,*+/'!?";
const MAX_DIGITS = 9;

class Failure extends Error {
  constructor(readonly pos: number, message: string, readonly cannot = false) { super(message); }
}

interface Names { byName: Map<string, SchemaField>; display: Map<string, string> }
const compiled = new WeakMap<QuerySchema, Names>();

/** Every id and alias a player may type, and the one name each field prints as. A name two fields claim, a reserved
 *  word, and a name the scanner could not read back are not addressable (a field is then reached by its id, or not). */
function namesOf(schema: QuerySchema): Names {
  const hit = compiled.get(schema);
  if (hit) return hit;
  const claims = new Map<string, SchemaField[]>();
  const claim = (name: string, f: SchemaField): void => {
    if (name === "" || RESERVED.has(name) || [...name].some((c) => NAME_STOP.includes(c))) return;
    claims.set(name, [...(claims.get(name) ?? []), f]);
  };
  for (const f of schema.fields) { claim(f.id, f); if (f.alias) claim(f.alias, f); }
  const byName = new Map<string, SchemaField>();
  for (const [name, fs] of claims) if (new Set(fs).size === 1) byName.set(name, fs[0]!);
  const display = new Map<string, string>();
  for (const f of schema.fields) {
    const pick = f.alias !== undefined && byName.get(f.alias) === f ? f.alias : f.id;
    display.set(f.id, pick);
  }
  const made = { byName, display };
  compiled.set(schema, made);
  return made;
}

/** The names a player can type, for the help text. */
export function fieldNames(schema: QuerySchema): { name: string; kind: "set" | "number"; id: string }[] {
  const { byName, display } = namesOf(schema);
  return schema.fields
    .filter((f) => byName.get(display.get(f.id) ?? "") === f)
    .map((f) => ({ name: display.get(f.id)!, kind: f.kind, id: f.id }));
}

// ---------------------------------------------------------------- print

function printValue(v: string): string {
  if (v.length > 0 && [...v].every((c) => SAFE_VALUE.includes(c))) return v;
  let out = "\"";
  for (const c of v) out += c === "\"" || c === "\\" ? `\\${c}` : c;
  return `${out}"`;
}

function printBounds(min: number | undefined, max: number | undefined): string {
  if (min !== undefined && max !== undefined) return min === max ? `=${min}` : `=${min}..${max}`;
  if (min !== undefined) return `>=${min}`;
  if (max !== undefined) return `<=${max}`;
  throw new Error("a count or a range needs at least one bound");
}

function printLeaf(q: QueryLeaf, display: (id: string) => string): string {
  if (q.op === "event") return `${q.side}:${printValue(q.key)}`;
  const name = display(q.field);
  switch (q.op) {
    case "has": return `${name}:${printValue(q.value)}`;
    case "count": return `#${name}${printBounds(q.min, q.max)}`;
    case "countIn": return `#${name}@${q.list}${printBounds(q.min, q.max)}`;
    case "cmp": return `${name}${printBounds(q.min, q.max)}`;
    case "within": return `${name}<=${q.value.length === 0 ? "C" : q.value.join("")}`;
    case "exactly": return `${name}=${q.value.length === 0 ? "C" : q.value.join("")}`;
  }
}

/** The canonical text of a query. An `and` / `or` inside an `and` / `or` keeps its parentheses, so the grouping the AST
 *  holds is the grouping the text says; an `and` inside an `or` needs none (it binds tighter). */
export function print(q: Query, schema?: QuerySchema): string {
  const display = (id: string): string => (schema ? namesOf(schema).display.get(id) ?? id : id);
  const go = (n: Query, parent: "and" | "or" | "not" | null): string => {
    if ("and" in n || "or" in n) {
      const kind = "and" in n ? "and" : "or";
      const kids = "and" in n ? n.and : n.or;
      const body = kids.map((k) => go(k, kind)).join(kind === "and" ? " " : " or ");
      const bare = parent === null || (parent === "or" && kind === "and");
      return bare ? body : `(${body})`;
    }
    if ("not" in n) return `-${go(n.not, "not")}`;
    return printLeaf(n, display);
  };
  return go(q, null);
}

// ---------------------------------------------------------------- parse

class Scanner {
  i = 0;
  constructor(readonly s: string, readonly schema: QuerySchema) {}

  get names(): Names { return namesOf(this.schema); }
  peek(): string { return this.s[this.i] ?? ""; }
  atEnd(): boolean { return this.i >= this.s.length; }
  ws(): void { while (!this.atEnd() && WS.includes(this.peek())) this.i++; }
  startsWith(t: string): boolean { return this.s.startsWith(t, this.i); }
  /** The word at the cursor (up to a space or a punctuation mark), without consuming it. */
  word(): string {
    let j = this.i;
    while (j < this.s.length && !NAME_STOP.includes(this.s[j]!)) j++;
    return this.s.slice(this.i, j);
  }
  /** A keyword is a whole word: `or` but not `orange`, and followed by a space, a parenthesis or the end. */
  keyword(k: string): boolean {
    if (!this.startsWith(k)) return false;
    const next = this.s[this.i + k.length] ?? "";
    return next === "" || WS.includes(next) || next === "(" || next === ")" || (k === "not" && next === "-");
  }

  parseOr(): Query {
    const items = [this.parseAnd()];
    for (;;) {
      this.ws();
      if (!this.keyword("or")) break;
      this.i += 2;
      this.ws();
      if (this.atEnd() || this.peek() === ")") throw new Failure(this.i, `a term must follow \`or\` at ${this.i}`);
      items.push(this.parseAnd());
    }
    return items.length === 1 ? items[0]! : { or: items };
  }

  parseAnd(): Query {
    const items = [this.parseNot()];
    for (;;) {
      this.ws();
      if (this.atEnd() || this.peek() === ")" || this.keyword("or")) break;
      if (this.keyword("and")) {
        this.i += 3;
        this.ws();
        if (this.atEnd() || this.peek() === ")" || this.keyword("or")) throw new Failure(this.i, `a term must follow \`and\` at ${this.i}`);
      }
      items.push(this.parseNot());
    }
    return items.length === 1 ? items[0]! : { and: items };
  }

  parseNot(): Query {
    this.ws();
    if (this.peek() === "-") {
      const at = this.i;
      this.i++;
      const next = this.peek();
      if (next === "" || WS.includes(next) || next === ")") throw new Failure(at, `\`-\` must touch the term it negates, at ${at}`);
      return { not: this.parseNot() };
    }
    if (this.keyword("not")) {
      this.i += 3;
      this.ws();
      if (this.atEnd() || this.peek() === ")") throw new Failure(this.i, `a term must follow \`not\` at ${this.i}`);
      return { not: this.parseNot() };
    }
    if (this.peek() === "(") {
      const open = this.i;
      this.i++;
      this.ws();
      if (this.peek() === ")") throw new Failure(this.i, `empty parentheses at ${open}`);
      const inner = this.parseOr();
      this.ws();
      if (this.peek() !== ")") throw new Failure(open, `the \`(\` at ${open} is never closed`);
      this.i++;
      return inner;
    }
    return this.parseTerm();
  }

  fieldNamed(name: string, at: number): SchemaField {
    const f = this.names.byName.get(name);
    if (!f) throw new Failure(at, `unknown field \`${name}\` at ${at}`);
    return f;
  }

  /** A value: quoted, or text up to a space or a parenthesis. */
  value(forWhat: string): { text: string; at: number } {
    const at = this.i;
    if (this.peek() === "\"") {
      this.i++;
      let out = "";
      for (;;) {
        if (this.atEnd()) throw new Failure(at, `the quote at ${at} is never closed`);
        const c = this.peek();
        this.i++;
        if (c === "\"") break;
        if (c === "\\") {
          const e = this.peek();
          if (e !== "\"" && e !== "\\") throw new Failure(this.i - 1, `a backslash may only escape a quote or a backslash, at ${this.i - 1}`);
          out += e;
          this.i++;
        } else out += c;
      }
      if (out === "") throw new Failure(at, `an empty value ${forWhat} at ${at}`);
      return { text: out, at };
    }
    let j = this.i;
    while (j < this.s.length && !WS.includes(this.s[j]!) && this.s[j] !== "(" && this.s[j] !== ")") j++;
    const text = this.s.slice(this.i, j);
    if (text === "") throw new Failure(at, `a value is missing ${forWhat} at ${at}`);
    this.i = j;
    return { text, at };
  }

  // CEILING: bounds are whole numbers, so a half-mana card (mana value 0.5) cannot be told apart from 0 or 1 in typed text. The builder's ranges are whole numbers too; the upgrade is a decimal reader here and in `printBounds`.
  number(): number {
    const at = this.i;
    let j = this.i;
    while (j < this.s.length && DIGITS.includes(this.s[j]!)) j++;
    if (j === this.i) throw new Failure(at, `a whole number is expected at ${at}`);
    if (j - this.i > MAX_DIGITS) throw new Failure(at, `the number at ${at} is too large`);
    const n = Number(this.s.slice(this.i, j));
    this.i = j;
    return n;
  }

  /** `>=N`, `<=N`, `=N` or `=N..N`, inclusive; the cursor is on the operator. */
  bounds(): { min?: number; max?: number } {
    const at = this.i;
    if (this.startsWith(">=")) { this.i += 2; return { min: this.number() }; }
    if (this.startsWith("<=")) { this.i += 2; return { max: this.number() }; }
    if (this.peek() === "=") {
      this.i++;
      const a = this.number();
      if (!this.startsWith("..")) return { min: a, max: a };
      this.i += 2;
      const nAt = this.i;
      const b = this.number();
      if (a > b) throw new Failure(nAt, `the range ${a}..${b} is empty, at ${at}`);
      return { min: a, max: b };
    }
    if (this.peek() === "<" || this.peek() === ">") throw new Failure(at, `bounds are inclusive: write ${this.peek()}= at ${at}`);
    throw new Failure(at, `a bound (>=n, <=n, =n or =n..m) is expected at ${at}`);
  }

  valueOf(f: SchemaField, text: string, at: number): string {
    if (!f.values) {
      throw new Failure(at, `can't check value \`${text}\` for ${this.names.display.get(f.id) ?? f.id}: ${f.noValues ?? "this build lists no values for it"} at ${at}`, true);
    }
    if (f.values.includes(text)) return text;
    const folded = text.toLowerCase();
    const near = f.values.find((v) => v.toLowerCase() === folded);
    if (near !== undefined) return near;
    throw new Failure(at, `unknown value \`${text}\` for ${this.names.display.get(f.id) ?? f.id} at ${at}`);
  }

  parseTerm(): Query {
    this.ws();
    const start = this.i;
    if (this.peek() === "#") {
      this.i++;
      const nameAt = this.i;
      const name = this.word();
      if (name === "") throw new Failure(nameAt, `a field name must follow \`#\` at ${nameAt}`);
      const f = this.fieldNamed(name, nameAt);
      this.i += name.length;
      if (f.kind !== "set") throw new Failure(nameAt, `\`${name}\` is a number, so it has no count: write ${name}>=n, ${name}<=n or ${name}=n at ${nameAt}`);
      let list: string | undefined;
      if (this.peek() === "@") {
        this.i++;
        const listAt = this.i;
        list = this.word();
        if (list === "") throw new Failure(listAt, `a list name must follow \`@\` at ${listAt}`);
        if (!this.schema.lists.includes(list)) throw new Failure(listAt, `unknown list \`${list}\` at ${listAt}`);
        this.i += list.length;
      }
      const b = this.bounds();
      return list === undefined ? { field: f.id, op: "count", ...b } : { field: f.id, op: "countIn", list, ...b };
    }
    const name = this.word();
    if (name === "") {
      const c = this.peek();
      throw new Failure(start, c === ")" ? `an unexpected \`)\` at ${start}` : `a term is expected at ${start}, found \`${c || "the end"}\``);
    }
    if (name === "makes" || name === "asks") {
      if (this.s[this.i + name.length] !== ":") throw new Failure(start, `\`${name}\` is followed by \`:\` and an event key at ${start}`);
      this.i += name.length + 1;
      const v = this.value(`after \`${name}:\``);
      const events = this.schema.events;
      if (events && !events[name].has(v.text)) throw new Failure(v.at, `unknown event \`${v.text}\` for ${name} at ${v.at}`);
      return { op: "event", side: name, key: v.text };
    }
    const f = this.fieldNamed(name, start);
    this.i += name.length;
    const after = this.peek();
    if (after === ":") {
      if (f.kind !== "set") throw new Failure(start, `\`${name}\` is a number: write ${name}>=n, ${name}<=n or ${name}=n at ${start}`);
      this.i++;
      const v = this.value(`after \`${name}:\``);
      return { field: f.id, op: "has", value: this.valueOf(f, v.text, v.at) };
    }
    if (f.kind === "number") {
      const b = this.bounds();
      return { field: f.id, op: "cmp", ...b };
    }
    if (this.startsWith("<=") || (after === "=" && !this.startsWith("=="))) {
      const within = this.startsWith("<=");
      this.i += within ? 2 : 1;
      const v = this.value(`after \`${name}${within ? "<=" : "="}\``);
      const letters: string[] = [];
      if (!(v.text === "C" && !(f.values ?? []).includes("C"))) {
        for (const c of v.text) {
          if (letters.includes(c)) throw new Failure(v.at, `\`${c}\` is repeated at ${v.at}`);
          letters.push(this.valueOf(f, c, v.at));
        }
      }
      return { field: f.id, op: within ? "within" : "exactly", value: letters };
    }
    throw new Failure(start, `\`${name}\` is a list of values: write ${name}:value, #${name}>=n, ${name}<=LETTERS or ${name}=LETTERS at ${start}`);
  }
}

/** Reads typed text. Empty text is `ok` with no query. The first problem is returned with its character offset. */
export function parse(text: string, schema: QuerySchema): ParseResult {
  const sc = new Scanner(text, schema);
  try {
    sc.ws();
    if (sc.atEnd()) return { ok: true, ast: null, usesEvents: false };
    const ast = sc.parseOr();
    sc.ws();
    if (!sc.atEnd()) throw new Failure(sc.i, sc.peek() === ")" ? `an unexpected \`)\` at ${sc.i}` : `unexpected \`${sc.peek()}\` at ${sc.i}`);
    return { ok: true, ast, usesEvents: eventsOf(ast).length > 0 };
  } catch (e) {
    if (e instanceof Failure) return { ok: false, error: { pos: e.pos, message: e.message, ...(e.cannot ? { cannot: true as const } : {}) } };
    throw e;
  }
}

// ---------------------------------------------------------------- reading a parsed query

/** The events the query names, once each. */
export function eventsOf(q: Query, out: { side: "makes" | "asks"; key: string }[] = []): { side: "makes" | "asks"; key: string }[] {
  if ("and" in q) q.and.forEach((n) => eventsOf(n, out));
  else if ("or" in q) q.or.forEach((n) => eventsOf(n, out));
  else if ("not" in q) eventsOf(q.not, out);
  else if (q.op === "event" && !out.some((e) => e.side === q.side && e.key === q.key)) out.push({ side: q.side, key: q.key });
  return out;
}

/** The evaluator's tree. An event becomes the rows `rowsOf` gives for it; a query with an event `rowsOf` cannot give
 *  yet is `null`, never a tree that treats the event as empty. */
export function toNode(q: Query, rowsOf: (side: "makes" | "asks", key: string) => readonly number[] | undefined): Node | null {
  if ("and" in q || "or" in q) {
    const kids: Node[] = [];
    for (const k of "and" in q ? q.and : q.or) {
      const n = toNode(k, rowsOf);
      if (n === null) return null;
      kids.push(n);
    }
    return "and" in q ? { and: kids } : { or: kids };
  }
  if ("not" in q) {
    const n = toNode(q.not, rowsOf);
    return n === null ? null : { not: n };
  }
  if (q.op === "event") {
    const rows = rowsOf(q.side, q.key);
    return rows === undefined ? null : { op: "rows", rows };
  }
  return q;
}

/** A tree of the query's shape with its events empty, for asking which fields and lists it needs. */
export function shapeNode(q: Query): Node {
  return toNode(q, () => [])!;
}

/** The evaluator's tree as a query, for showing what the builder asks. null when it holds rows a caller supplied (which
 *  have no words). Single-child groups collapse. */
export function fromNode(n: Node): Query | null {
  if ("and" in n || "or" in n) {
    const kids: Query[] = [];
    for (const k of "and" in n ? n.and : n.or) {
      const q = fromNode(k);
      if (q === null) return null;
      kids.push(q);
    }
    if (kids.length === 1) return kids[0]!;
    return "and" in n ? { and: kids } : { or: kids };
  }
  if ("not" in n) {
    const q = fromNode(n.not);
    return q === null ? null : { not: q };
  }
  return n.op === "rows" ? null : n;
}

/** What the page's legend shows: one line per form of the grammar. */
export const QUERY_HELP: readonly { form: string; means: string; example: string }[] = [
  { form: "field:value", means: "the card has this value", example: "st:elf" },
  { form: "-field:value", means: "the card does not", example: "-st:borg" },
  { form: "#field>=n", means: "how many values the card has (also <= and =; n..m for a span)", example: "#t=1..2" },
  { form: "#field@list>=n", means: "how many of them are in a named list", example: "#stBest@creature>=3" },
  { form: "field>=n", means: "a number field (also <= and =)", example: "mv<=3" },
  { form: "field<=LETTERS", means: "colours fit inside these; = for exactly these, C for none", example: "id<=WUG" },
  { form: "makes:event", means: "the card causes this event", example: "makes:create-token|creature|-|t" },
  { form: "asks:event", means: "the card asks for this event", example: "asks:dies|creature|-|-" },
  { form: "and, or, not, ( )", means: "side by side means and; not binds tightest, then and, then or", example: "t:creature (st:elf or st:human)" },
];

/** The creature-type words the query negates directly (`-st:borg`): what a changeling would be hidden by. */
export function notSubtypesOf(q: Query, out: string[] = []): string[] {
  if ("and" in q) q.and.forEach((n) => notSubtypesOf(n, out));
  else if ("or" in q) q.or.forEach((n) => notSubtypesOf(n, out));
  else if ("not" in q) {
    const c = q.not;
    if ("field" in c && c.field === "st" && c.op === "has" && !out.includes(c.value)) out.push(c.value);
    else notSubtypesOf(c, out);
  }
  return out;
}

/** The query with changelings kept (`changelings=keep`): each `-st:<creature type>` also lets through a card that has every
 *  creature type, as the builder's NOT row does (CR 702.73a). */
export function keepChangelings(q: Query, creature: ReadonlySet<string>): Query {
  if ("and" in q) return { and: q.and.map((n) => keepChangelings(n, creature)) };
  if ("or" in q) return { or: q.or.map((n) => keepChangelings(n, creature)) };
  if ("not" in q) {
    const c = q.not;
    if ("field" in c && c.field === "st" && c.op === "has" && creature.has(c.value)) {
      return { or: [q, { field: "everyCreatureType", op: "has", value: "true" }] };
    }
    return { not: keepChangelings(c, creature) };
  }
  return q;
}
