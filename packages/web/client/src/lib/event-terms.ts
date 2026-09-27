import type { EventQuery } from "./facets.js";

/** THE SEARCH AS A SENTENCE (owner, 2026-09-27: mockup B, "the search is a sentence; tap a
 *  joining word"). "Black cards that gain life or return an artifact from a graveyard, but never
 *  make a player lose life."
 *
 *  A TERM IS AN EVENT, A SIDE AND AN OPERATOR. The side is the engine's two questions about one
 *  event -- the card MAKES it happen (`produce`) or PAYS OFF when it happens (`consume`); the
 *  operator is how it joins the rest:
 *
 *    and  -- every one must hold (the only operator there was before; `produce`/`consume`)
 *    or   -- at least one of the `or` terms must hold (one group, drawn together)
 *    not  -- none may hold
 *
 *  ONE `or` GROUP, NOT A TREE. "(A or B) and not C" is every question the reanimator deck that
 *  asked for this needed, and a sentence can say it without brackets; nesting is where a sentence
 *  stops being one. XOR was offered and left out: "exactly one of" has no deckbuilding meaning for
 *  what a card does. */
export type TermOp = "and" | "or" | "not";
export type TermSide = "makes" | "pays";
export interface EventTerm { key: string; side: TermSide; op: TermOp }

const FIELDS: Record<TermOp, Record<TermSide, keyof EventQuery>> = {
  and: { makes: "produce", pays: "consume" },
  or: { makes: "orProduce", pays: "orConsume" },
  not: { makes: "notProduce", pays: "notConsume" },
};
const OPS: TermOp[] = ["and", "or", "not"];

/** The query's terms, in the order the sentence reads them: and, then the or group, then not. */
export function termsOf(q: EventQuery): EventTerm[] {
  const out: EventTerm[] = [];
  for (const op of OPS) for (const side of ["makes", "pays"] as const) {
    for (const key of (q[FIELDS[op][side]] as string[] | undefined) ?? []) out.push({ key, side, op });
  }
  return out;
}

/** The query with these terms and nothing else in its six event fields. */
export function withTerms(q: EventQuery, terms: readonly EventTerm[]): EventQuery {
  const next: EventQuery = { ...q, produce: [], consume: [] };
  delete next.orProduce; delete next.orConsume; delete next.notProduce; delete next.notConsume;
  for (const t of terms) {
    const field = FIELDS[t.op][t.side];
    const list = ((next[field] as string[] | undefined) ?? []);
    if (!list.includes(t.key)) (next as unknown as Record<string, string[]>)[field] = [...list, t.key];
  }
  return next;
}

/** TAPPING A JOINING WORD MOVES THE TERM ON: and → or → not → and. */
export const nextOp = (op: TermOp): TermOp => OPS[(OPS.indexOf(op) + 1) % OPS.length]!;

export const sameTerm = (a: EventTerm, b: EventTerm): boolean => a.key === b.key && a.side === b.side;

/** THE SET THE TERMS DESCRIBE, over index positions. `keep` null means no positive term was asked
 *  (the whole index is the base); `drop` is what the `not` terms take away. A `not`-only question
 *  ("cards that never make a player lose life") is a real one and answers from the whole index. */
export function answerTerms(
  terms: readonly EventTerm[],
  listOf: (t: EventTerm) => number[],
): { keep: Set<number> | null; drop: Set<number> } {
  const and = terms.filter((t) => t.op === "and").map(listOf);
  const or = terms.filter((t) => t.op === "or").map(listOf);
  const drop = new Set(terms.filter((t) => t.op === "not").flatMap(listOf));
  let keep: Set<number> | null = null;
  if (and.length > 0) {
    const sorted = [...and].sort((a, b) => a.length - b.length);
    const rest = sorted.slice(1).map((l) => new Set(l));
    keep = new Set(sorted[0]!.filter((id) => rest.every((s) => s.has(id))));
  }
  if (or.length > 0) {
    const any = new Set(or.flat());
    keep = keep === null ? any : new Set([...keep].filter((id) => any.has(id)));
  }
  return { keep, drop };
}

/** WHERE AN EVENT SITS IN THE ADD LIST: grouped by what happens, so fifty flat rows read as a few
 *  short groups (UX review, 2026-09-27). Keyed on the verb, the part of a key before the first
 *  `|` and any `:`. */
export interface EventGroup { id: string; label: string; glyph?: string }
const GROUPS: { group: EventGroup; verbs: string[] }[] = [
  { group: { id: "into-yard", label: "Into the graveyard", glyph: "graveyard" }, verbs: ["fills", "enters-graveyard", "dies", "mill", "discard", "surveil"] },
  { group: { id: "out-of-yard", label: "Out of the graveyard · return, reanimate, exile", glyph: "graveyard" }, verbs: ["leaves-graveyard", "foretell", "collect-evidence"] },
  { group: { id: "life", label: "Life", glyph: "ability-lifelink" }, verbs: ["gain-life", "lose-life", "loses-game"] },
  { group: { id: "tokens", label: "Tokens and counters", glyph: "token" }, verbs: ["create-token", "counter-added", "counter-removed", "proliferate"] },
  { group: { id: "cast", label: "Casting spells", glyph: "instant" }, verbs: ["cast", "copy", "copies", "counter-spell"] },
  { group: { id: "combat", label: "Combat and damage", glyph: "power" }, verbs: ["attacks", "combat-damage", "non-combat-damage", "damaged", "begin-combat", "exert", "prevented"] },
  { group: { id: "board", label: "Enters, leaves, sacrificed", glyph: "creature" }, verbs: ["enters", "leaves", "exiled", "sacrifice", "fodder", "taps", "untaps", "attached", "transform", "turned-face-up", "phases-out", "meld"] },
  { group: { id: "cards", label: "Cards and lands", glyph: "library" }, verbs: ["draw", "search", "reveal", "scry", "explore", "shuffle", "land-play"] },
  { group: { id: "static", label: "What it boosts or counts", glyph: "ability-static" }, verbs: ["applies", "counts"] },
];
const OTHER: EventGroup = { id: "other", label: "Turns and everything else" };
const verbOf = (key: string): string => (key.split("|")[0] ?? "").split(":")[0] ?? "";

export function eventGroup(key: string): EventGroup {
  const verb = verbOf(key);
  return GROUPS.find((g) => g.verbs.includes(verb))?.group ?? OTHER;
}

/** THE MANA-FONT GLYPHS A TERM WEARS (owner, 2026-09-27: "leverage the magic font we have"): its
 *  card type, or a token, and the zone or mechanic the verb names. Two at most, and none where the
 *  font has no honest match -- life LOSS has no symbol, and a borrowed one would say something
 *  else. Decorative: every term also says itself in words. */
const TYPE_GLYPH = new Set(["artifact", "creature", "enchantment", "land", "planeswalker", "instant", "sorcery", "battle"]);
const VERB_GLYPH: Record<string, string> = {
  fills: "graveyard", "enters-graveyard": "graveyard", dies: "graveyard", "leaves-graveyard": "graveyard",
  mill: "graveyard", discard: "graveyard", exiled: "exile", draw: "library", search: "library",
  "gain-life": "ability-lifelink", "counter-added": "counter-plus", proliferate: "ability-proliferate",
  "create-token": "token",
};
export function eventGlyphs(key: string): string[] {
  const [, types = "-", subtype = "-", flag = "-"] = key.split("|");
  const out: string[] = [];
  const type = types.split(",").find((t) => TYPE_GLYPH.has(t));
  if (type) out.push(type);
  else if (flag === "t" || subtype === "token") out.push("token");
  const zone = VERB_GLYPH[verbOf(key)];
  if (zone && !out.includes(zone)) out.push(zone);
  return out.slice(0, 2);
}
