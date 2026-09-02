import type { AnalyzeResponse } from "../types.js";
import { findings } from "./findings.js";

/** WHAT MOVED SINCE YOUR LAST RUN.
 *
 *  `PRODUCT.md` principle 3 is the iterative-tuning loop — "easy to spot what changed between
 *  iterations" — and until now the app served every other part of it and not that one: you swapped
 *  two cards, hit Re-analyze, and got a fresh 3,000px report with no statement of what your change
 *  did. The numbers were all there and the reader had to remember the old ones.
 *
 *  Client-side and session-scoped on purpose. This needs no account, no server and no history: the
 *  question is "what did THIS edit do", which is one step back, and a persisted history would be a
 *  different product (and a storage policy) for a question nobody asked yet.
 *  → `specs/2026-08-20-report-usability-review.md` §5
 */

export interface RunSnapshot {
  /** Deck contents, for the overlap test below. Names, not ids — this is what the user edited. */
  cards: string[];
  synergy?: number;
  build?: number;
  theme?: string;
  categories: Record<string, number>;
  /** The RANKED DIAGNOSIS, keyed by finding id -> its printed figure ("6/14").
   *
   *  The strip already carried scores, theme and leaf category counts, but not the thing the report
   *  now LEADS with — so a tuner who cut for card draw and re-pasted got a re-ranked list and no
   *  statement that the number they were chasing had moved. Worse, the ranking makes a fixed finding
   *  DISAPPEAR and promotes everything below it, so the surface most changed by a good edit was the
   *  one with no memory of it (IA review, 2026-08-27). */
  findings?: Record<string, string>;
}

export interface RunDiff {
  added: string[];
  removed: string[];
  synergy?: { from: number; to: number };
  build?: { from: number; to: number };
  theme?: { from: string; to: string };
  categories: { category: string; from: number; to: number }[];
  /** Findings whose figure moved, plus the ones that appeared or went away entirely. A finding that
   *  is GONE is the strongest thing this strip can say about an edit. */
  findings: { id: string; label: string; from?: string; to?: string }[];
}

export function snapshotRun(data: AnalyzeResponse): RunSnapshot {
  const r = data.report;
  return {
    cards: r.cards.map((c) => c.name),
    synergy: r.synergyOverall,
    build: r.buildScore,
    theme: r.cohesion?.theme,
    categories: Object.fromEntries((r.buildCategories ?? []).map((c) => [c.category, c.count])),
    findings: Object.fromEntries(findings(r).map((f) => [f.id, `${f.figureLabel} ${f.figure}`])),
  };
}

/** How much of the previous deck has to survive for this to be the SAME deck being tuned. Below it,
 *  the user pasted something else and "+63 cards, −61 cards" is noise wearing the costume of a
 *  finding. Half is deliberately loose: a real tuning pass swaps a handful of cards, and the cost of
 *  refusing a genuine edit is a missing strip while the cost of accepting a different deck is a
 *  wrong one. */
const SAME_DECK_OVERLAP = 0.5;

/** `null` means "nothing worth saying" — a different deck, or the same deck with nothing changed.
 *  Both render no strip at all, because a strip that says "no change" after a no-op re-analyse is
 *  the same noise it exists to remove. */
export function diffRuns(prev: RunSnapshot, next: RunSnapshot): RunDiff | null {
  const before = new Set(prev.cards);
  const after = new Set(next.cards);
  const kept = [...after].filter((n) => before.has(n)).length;
  const overlap = before.size === 0 ? 0 : kept / before.size;
  if (overlap < SAME_DECK_OVERLAP) return null;

  const added = [...after].filter((n) => !before.has(n)).sort();
  const removed = [...before].filter((n) => !after.has(n)).sort();
  const categories = Object.keys(next.categories)
    .filter((c) => (prev.categories[c] ?? 0) !== next.categories[c])
    .map((c) => ({ category: c, from: prev.categories[c] ?? 0, to: next.categories[c]! }))
    .sort((a, b) => Math.abs(b.to - b.from) - Math.abs(a.to - a.from) || a.category.localeCompare(b.category));

  // Rounded to what the panel PRINTS before being compared. A headline score renders at one decimal,
  // so a 0.04 move is invisible on screen, and a strip claiming "4.1 → 4.1" reads as a bug.
  const moved = (a?: number, b?: number): { from: number; to: number } | undefined =>
    a !== undefined && b !== undefined && a.toFixed(1) !== b.toFixed(1) ? { from: a, to: b } : undefined;

  const prevF = prev.findings ?? {};
  const nextF = next.findings ?? {};
  const findingMoves = [...new Set([...Object.keys(prevF), ...Object.keys(nextF)])]
    .filter((id) => prevF[id] !== nextF[id])
    .map((id) => ({
      id,
      // The label is the figure's own name ("Consistency 6/14"), so the strip needs no second copy
      // of the finding vocabulary.
      label: (nextF[id] ?? prevF[id] ?? id).replace(/ [^ ]*$/, ""),
      ...(prevF[id] !== undefined ? { from: prevF[id] } : {}),
      ...(nextF[id] !== undefined ? { to: nextF[id] } : {}),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const diff: RunDiff = {
    added,
    removed,
    findings: findingMoves,
    synergy: moved(prev.synergy, next.synergy),
    build: moved(prev.build, next.build),
    theme: prev.theme && next.theme && prev.theme !== next.theme ? { from: prev.theme, to: next.theme } : undefined,
    categories,
  };
  const empty =
    diff.added.length === 0 && diff.removed.length === 0 && !diff.synergy && !diff.build
    && !diff.theme && diff.categories.length === 0 && diff.findings.length === 0;
  return empty ? null : diff;
}

const KEY = "mtg-synergy:last-run";

/** sessionStorage, and it is allowed to be absent: Safari private mode throws on access, and the
 *  test environment may not provide it. A missing store means no strip, never a crash. */
export function loadLastRun(): RunSnapshot | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as RunSnapshot) : null;
  } catch {
    return null;
  }
}

export function saveLastRun(snapshot: RunSnapshot): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(snapshot));
  } catch {
    /* no store, no strip — see above */
  }
}

const DECK_KEY = "mtg-synergy:last-deck";

export interface LastDeck {
  commanders: string;
  decklist: string;
}

/** THE TEXT THE READER PASTED, so run two starts with it still in the box (roadmap S9).
 *
 *  Same store and same lifetime as the run snapshot above, deliberately: the box and the diff it
 *  will be measured against have to die together, or the reader gets their deck back with no
 *  statement of what their edit did. Same try/catch too -- a missing store means an empty box. */
export function saveLastDeck(deck: LastDeck): void {
  try {
    window.sessionStorage.setItem(DECK_KEY, JSON.stringify(deck));
  } catch {
    /* no store, no memory -- see `saveLastRun` */
  }
}

export function loadLastDeck(): LastDeck | null {
  try {
    const raw = window.sessionStorage.getItem(DECK_KEY);
    return raw ? (JSON.parse(raw) as LastDeck) : null;
  } catch {
    return null;
  }
}
