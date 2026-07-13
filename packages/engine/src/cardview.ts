import type { Card } from "./card.js";

export interface CardView {
  name: string;
  oracle: string;
  types: Set<string>;
  subtypes: Set<string>;
  keywords: Set<string>;
}

const NEGATION_CUES = [
  "can't",
  "cannot",
  "don't",
  "doesn't",
  "unless",
  "rather than",
  "instead of",
];

function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/[\s/]+/)
      .map((t) => t.trim())
      .filter(Boolean),
  );
}

function splitTypeLine(typeLine: string): [string, string] {
  const idx = typeLine.indexOf("—"); // MTG uses an em dash between types and subtypes
  if (idx === -1) return [typeLine, ""];
  return [typeLine.slice(0, idx), typeLine.slice(idx + 1)];
}

export function toCardView(card: Card): CardView {
  const [left, right] = splitTypeLine(card.typeLine);
  return {
    name: card.name,
    oracle: card.oracleText.toLowerCase(),
    types: tokenize(left),
    subtypes: tokenize(right),
    keywords: new Set(card.keywords.map((k) => k.toLowerCase())),
  };
}

export function hasKeyword(view: CardView, kw: string): boolean {
  return view.keywords.has(kw.toLowerCase());
}

export function has(view: CardView, ...needles: string[]): boolean {
  return needles.some((n) => view.oracle.includes(n));
}

/** Substring test that ignores matches occurring inside a negated clause. */
export function hasClause(view: CardView, ...needles: string[]): boolean {
  const clauses = view.oracle.split(/[.;\n]/);
  return clauses.some((clause) => {
    if (NEGATION_CUES.some((cue) => clause.includes(cue))) return false;
    return needles.some((n) => clause.includes(n));
  });
}

export function matchWord(view: CardView, re: RegExp): boolean {
  return re.test(view.oracle);
}
