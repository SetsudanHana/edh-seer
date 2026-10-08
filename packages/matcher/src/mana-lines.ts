/** THE MANA LINES A CARD PRINTS, read once (extracted from same-job.ts for the colour audit, #1114).
 *  Leaf module: imports nothing but a type, so `mana-audit` and `same-job` can both use it.
 *
 *  COST AGAINST PRODUCTION (owner, 2026-10-08, #1114): a mana ability counts as COLOUR FIXING only when it
 *  produces at least its mana cost plus the source's own tap. Cascade Bluffs ("{U/R}, {T}: Add {U}{U}, {U}{R},
 *  or {R}{R}") pays 1 and taps for 2: a full U and R source. Cascading Cataracts ("{5}, {T}: Add five mana in
 *  any combination of colors") and Prismatic Lens ("{1}, {T}: Add one mana of any color") produce less than
 *  they cost to use: colourless only. A hybrid or coloured symbol in the cost counts as 1, like a generic one. */
import type { DeckCard } from "./types.js";

const REMINDER = /\([^()]*\)/g;
export const printedText = (d: DeckCard): string => (d.card.oracleText ?? "").replace(REMINDER, "").toLowerCase();

export const ADD_LINE = /^([^:\n]*):\s*add ([^\n]*)/gm;
const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };
const WORDS = "one|two|three|four|five|six|seven";
export const ADDITIONAL = new RegExp(`\\badds? an additional ((?:\\{[^}]+\\})+|(${WORDS}) mana of (?:any|the chosen) (?:color|type))`, "g");
const ANY_COLOUR = new RegExp(`^(${WORDS}) mana (?:of (?:any|the chosen) (?:color|type)|in any combination of colou?rs)`);
const WUBRG = ["W", "U", "B", "R", "G"];

export interface ManaLine {
  /** Mana produced less the mana its cost asks (a source's own tap aside). */
  net: number;
  /** Makes a WUBRG colour AND passes the cost rule: the only lines that fix. */
  coloured: boolean;
  /** The WUBRG colours the line can make (all five for "any color"), whether or not it passes the cost rule. */
  colours: string[];
  /** Produces at least its cost plus its own tap. */
  qualifies: boolean;
  /** Mana its cost asks (tap aside): 0 for a plain tap. */
  paid: number;
}

const coloursOf = (symbols: string): string[] => [...new Set([...symbols.matchAll(/\{([^}]+)\}/g)].flatMap((m) => m[1]!.toUpperCase().split("/")).filter((c) => WUBRG.includes(c)))];

/** The repeatable mana lines of a card. A line that sacrifices the card is a one-shot (Lotus Petal, Dire
 *  Mimic), and a line whose mana is restricted ("Spend this mana only to cast ...") is not mana for the
 *  deck's spells (#966 T2 review): neither is read. */
export function manaLines(d: DeckCard): ManaLine[] {
  const out: ManaLine[] = [];
  const text = printedText(d);
  for (const m of text.matchAll(ADD_LINE)) {
    const cost = m[1]!;
    const rest = m[2]!;
    if (/\bsacrifice\b/.test(cost) || /\bspend this mana only\b/.test(rest)) continue;
    const any = ANY_COLOUR.exec(rest);
    const run = /^(?:\{[^}]+\})+/.exec(rest)?.[0];
    if (!any && !run) continue;
    const made = any ? NUMBER_WORDS[any[1]!]! : (run!.match(/\{/g) ?? []).length;
    // WHAT THE COST ASKS: a number is that many, any other symbol (coloured, hybrid) is one; {T} is the tap.
    const symbols = [...cost.matchAll(/\{([^}]+)\}/g)].map((x) => x[1]!);
    const paid = symbols.filter((s) => !/^[tqe]$/.test(s)).reduce((n, s) => n + (/^\d+$/.test(s) ? Number(s) : s === "x" ? 0 : 1), 0);
    const tap = symbols.includes("t") ? 1 : 0;
    const colours = any ? WUBRG : coloursOf(rest.split(/\.\s/)[0]!);
    // AN AMOUNT THAT SCALES ("{B} for each Swamp", Cabal Coffers) CANNOT BE JUDGED FROM THE LINE: it is not struck.
    const qualifies = made >= paid + tap || /\bfor each\b|\bwhere x\b|\bequal to\b|\{x\}/.test(rest);
    out.push({ net: made - paid, coloured: colours.length > 0 && qualifies, colours, qualifies, paid });
  }
  // AN AURA'S MANA IS A TRIGGER, not a "{T}: Add" line (Wild Growth, Utopia Sprawl): "adds an additional
  // {G}" / "one mana of the chosen color" is that many, free, every time the land taps.
  for (const m of text.matchAll(ADDITIONAL)) {
    const any = m[2];
    const colours = any ? WUBRG : coloursOf(m[1]!);
    out.push({ net: any ? NUMBER_WORDS[any]! : (m[1]!.match(/\{/g) ?? []).length, coloured: colours.length > 0, colours, qualifies: true, paid: 0 });
  }
  return out;
}

/** THE COLOURS A SOURCE REALLY FIXES, from the card's `producedMana`: a colour only a failing line can make
 *  (Cascading Cataracts' five, Prismatic Lens' any colour) is struck; one a passing line also makes stays.
 *  A card with no line this reads (a basic's reminder text, a fetch, a trigger) keeps `producedMana`. */
export function fixedColours(d: DeckCard): readonly string[] {
  const produced = d.card.producedMana ?? [];
  const lines = manaLines(d);
  if (lines.every((l) => l.qualifies)) return produced;
  const failing = new Set(lines.filter((l) => !l.qualifies).flatMap((l) => l.colours));
  const passing = new Set(lines.filter((l) => l.qualifies).flatMap((l) => l.colours));
  return produced.filter((c) => !failing.has(c) || passing.has(c));
}
