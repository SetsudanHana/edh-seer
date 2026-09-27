import type { DeckReport } from "../types.js";
import { manaTurn } from "./speed.js";

/** WHAT THE DECK DOES ON ITS FIRST FIVE TURNS (owner, 2026-09-26: "we should be able to determine
 *  how the deck can win"; the plan seat's "solved" is being able to describe the first five turns).
 *  r/EDH's "my deck does nothing" threads are answered by walking the curve turn by turn, so this
 *  does the same with the report's own numbers: the mana the deck typically has each turn (the
 *  goldfish's median) and the cards that first become castable at that mana, grouped by the job they
 *  do. Nothing new is modelled: it is a JOIN of `manaAvailability.rows`, each card's mana value and
 *  roles, and the win plans' card lists.
 *
 *  "First castable" is by cost alone. Colours are ignored, and so is whether the card is in hand,
 *  which the page says. */

export const FIRST_TURNS = 5;

/** The job a card is shown under, one per card, in this order: an early turn is read first for its
 *  mana, then its cards, then whether it advances the plan. */
export type Job = "ramp" | "draw" | "plan" | "answer" | "other";

export const JOB_LABEL: Record<Job, string> = {
  ramp: "ramp",
  draw: "card draw",
  plan: "win plan",
  answer: "interaction",
  other: "other",
};

const DRAW = new Set(["draw", "cardSelection", "impulseDraw", "tutor"]);
const ANSWER = new Set(["targetedRemoval", "stackInteraction", "boardWipe", "protection", "stax", "graveyardHate"]);

export interface TurnStep {
  turn: number;
  /** Typical mana (half of games), and the spread: slow games and fast games. */
  mana: number;
  low: number;
  high: number;
  /** Cards whose cost first fits this turn's typical mana, by job. Empty groups are left out. */
  jobs: { job: Job; cards: { name: string; manaValue: number }[] }[];
  /** How many nonland cards are castable by cost at this turn's typical mana, in all. */
  castable: number;
}

export interface FirstTurns {
  steps: TurnStep[];
  nonland: number;
  commander?: { name: string; manaValue: number; turn?: number; early?: number; late?: number };
}

/** `isLand` comes from the card graph's type lines: a basic land has no role on the report, so the
 *  roles alone put Island among the one-drops. */
export function firstTurns(report: DeckReport, isLand: (name: string) => boolean = () => false): FirstTurns | null {
  const rows = report.manaAvailability?.rows;
  if (!rows?.length) return null;
  const planCards = new Set((report.deckMath?.wincons.classes ?? []).flatMap((c) => c.cards ?? []));
  // One entry per physical card, by its front face: a two-faced card's back is another row with the
  // same roles, and a land back (an MDFC) would read as a free spell.
  const seen = new Set<string>();
  const cards: { name: string; manaValue: number; job: Job; commander: boolean }[] = [];
  for (const c of report.cards) {
    const name = c.cardName ?? c.name;
    if (seen.has(name) || c.isCompanion || (c.face ?? 0) > 0) continue;
    seen.add(name);
    const roles = c.roles ?? [];
    if (roles.includes("lands") || isLand(name) || c.manaValue === undefined) continue;
    const job: Job = roles.includes("ramp") ? "ramp"
      : roles.some((r) => DRAW.has(r)) ? "draw"
      : planCards.has(name) ? "plan"
      : roles.some((r) => ANSWER.has(r)) ? "answer"
      : "other";
    cards.push({ name, manaValue: c.manaValue, job, commander: c.isCommander });
  }
  const library = cards.filter((c) => !c.commander);
  const steps: TurnStep[] = [];
  let before = -1;
  for (const row of rows.slice(0, FIRST_TURNS)) {
    // Whole mana: a median of 2.5 casts a two-drop, not a three.
    const mana = Math.floor(row.mana.median);
    const fresh = library.filter((c) => c.manaValue > before && c.manaValue <= mana);
    const jobs = (Object.keys(JOB_LABEL) as Job[])
      .map((job) => ({ job, cards: fresh.filter((c) => c.job === job).sort((a, b) => a.manaValue - b.manaValue || a.name.localeCompare(b.name)).map(({ name, manaValue }) => ({ name, manaValue })) }))
      .filter((g) => g.cards.length);
    steps.push({ turn: row.turn, mana, low: Math.floor(row.mana.p25), high: Math.floor(row.mana.p75), jobs, castable: library.filter((c) => c.manaValue <= mana).length });
    before = Math.max(before, mana);
  }
  const cmd = cards.filter((c) => c.commander).sort((a, b) => a.manaValue - b.manaValue)[0];
  return {
    steps,
    nonland: library.length,
    ...(cmd ? { commander: { name: cmd.name, manaValue: cmd.manaValue, ...manaTurn(rows, cmd.manaValue) } } : {}),
  };
}
