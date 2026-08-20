import type { DeckReport } from "../types.js";

type Card = DeckReport["cards"][number];

/** THE SENTENCE WITHOUT ITS NOUNS. Two rows saying "Kindred Discovery triggers on a wizard entering;
 *  Inalla supplies it" and "Harmonic Prodigy triggers on a wizard entering; Inalla supplies it" are
 *  one mechanism printed twice, and a reader scanning a 94-row table meets it as a stuck record.
 *  Card names are what differ, so they are what goes. */
export function reasonTemplate(text: string, names: ReadonlySet<string>): string {
  let out = text;
  // Longest first: "Kefka, Court Mage // Kefka, Ruler of Ruin" contains "Kefka, Court Mage", and
  // replacing the short one first would leave half a name behind.
  for (const n of [...names].sort((a, b) => b.length - a.length)) out = out.split(n).join("·");
  return out;
}

const everyReason = (c: Card): { tag?: string; text: string }[] =>
  (c.topPartners ?? []).flatMap((p) => p.reasons ?? []);

export interface SharedShape {
  /** The template itself, for matching. */
  template: string;
  /** An example of it, verbatim — the one place it is worth printing in full. */
  sample: string;
  /** How many rows lead with it. */
  count: number;
}

export interface ReasonShapes {
  /** Templates enough rows share to be worth saying once, biggest first. Empty when nothing
   *  dominates, and every row then keeps its own sentence. */
  shared: SharedShape[];
  /** Distinct templates across the rows, i.e. how many different things this table is saying. */
  distinct: number;
}

/** How many rows have to share a template before it is worth saying once instead of N times, and
 *  what share of the table. MEASURED on the review deck: 94 rows carry 12 distinct templates, the
 *  top one covering 25 and the next three 16, 8 and 7 — so a table can be a stuck record in more
 *  than one voice, which is why this returns a LIST. Below the floor nothing folds: a small deck
 *  saying the same thing three times is not a stuck record. */
const MIN_ROWS = 5;
const MIN_SHARE = 0.2;

/** At most this many shared mechanisms are named. Past two the note becomes the thing it replaced —
 *  a paragraph of repeated sentences at the top of the table instead of down the side of it. */
const MAX_SHARED = 2;

export function reasonShapes(cards: readonly Card[]): ReasonShapes {
  const names = new Set(cards.map((c) => c.name));
  const counts = new Map<string, { n: number; sample: string }>();
  for (const c of cards) {
    const first = everyReason(c)[0];
    if (!first) continue;
    const key = reasonTemplate(first.text, names);
    const seen = counts.get(key);
    counts.set(key, { n: (seen?.n ?? 0) + 1, sample: seen?.sample ?? first.text });
  }
  const shared = [...counts.entries()]
    .filter(([, v]) => v.n >= MIN_ROWS && v.n >= cards.length * MIN_SHARE)
    .sort((a, b) => b[1].n - a[1].n)
    .slice(0, MAX_SHARED)
    .map(([template, v]) => ({ template, sample: v.sample, count: v.n }));
  return { shared, distinct: counts.size };
}

/** The sentence worth printing on THIS row: the first reason that is not one of the table's shared
 *  templates, or nothing at all when the card has only those. A row whose only story is the story
 *  already told at the top of the table has nothing of its own to say, and printing it again is what
 *  buries the rows that do. */
export function distinctiveReason(
  card: Card,
  shared: readonly SharedShape[],
  names: ReadonlySet<string>,
): string | undefined {
  const reasons = everyReason(card);
  if (shared.length === 0) return reasons[0]?.text;
  const templates = new Set(shared.map((s) => s.template));
  return reasons.find((r) => !templates.has(reasonTemplate(r.text, names)))?.text;
}
