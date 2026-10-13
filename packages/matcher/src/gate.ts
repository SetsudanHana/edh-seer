/** A GATED MANA LINE, JUDGED AGAINST THE DECK (#1169 task 2b-2; owner 2026-10-13): "gated is conditional same as lands, so it should impact the card quality, but overall it is a
 *  mana rock, but with condition so it matches only specific themes, like in this case dragons." Mox Jasper ("Activate only if you control a Dragon") is a rock in a deck that
 *  plays Dragons and a blank in one that does not. Derive stores the condition as a lowercase string (`ManaLine.gate`, verbatim from the card); this module is the ONE place
 *  that reads it against a decklist, so the goldfish, the rock swaps and the ramp weight cannot disagree about whether a deck meets a card's gate.
 *
 *  THREE VERDICTS. `met`: the deck has enough of what the gate asks for. `unmet`: it does not. `unknown`: the gate is not a property of a decklist (a game state: "speed 4",
 *  "an opponent has three or more poison counters"; the card's own state: counters on it, "it was bargained"; a trigger: Princess Yue's "when princess yue dies"), or this reader does not
 *  parse it. UNKNOWN IS TREATED AS UNMET by every consumer, never as met: a silent wrong answer is worse than a missing one.
 *
 *  "ENOUGH" (CEILING): a gate that asks for N permanents of a kind ("you control a dragon", "three or more artifacts", "a swamp") is met when the chance of having N of them among the cards seen
 *  by the corpus median clock is at least the repo's own confidence bar (`pAtLeast`, `GATE_TURN`, `GATE_CONFIDENCE`: the same turn and bar `deck-math.ts` asks "does the deck have enough of X"
 *  with). A single Dragon in a hundred cards does not make Mox Jasper a rock; a dozen do. The chance itself (`gateProbability`) is what a quality weight reads.
 *  CEILING: it counts the deck's own cards of the type, not tokens they make (a Dragon token), not changelings, and the commander counts as an ordinary card of the hundred.
 *  CEILING: a gate that names two kinds of thing at once ("an urza's mine and an urza's tower", the tron lands) is `unknown` here: the goldfish prices that pair against the board turn by turn. */
import { pAtLeast, seen } from "@edh-seer/engine";
import type { ManaLine } from "@edh-seer/tagger";
import type { DeckCard } from "./types.js";
import { countsAsLand, parseTypeLine } from "./typeline.js";

export type GateVerdict = "met" | "unmet" | "unknown";

/** The turn the deck is asked at: `CORPUS_MEDIAN_CLOCK` in `deck-math.ts`, and the confidence bar is its `REQUIRED_CONFIDENCE`. Not imported: deck-math reaches this module through
 *  land-score and same-job. `gate.test.ts` pins both. */
export const GATE_TURN = 9;
export const GATE_CONFIDENCE = 0.5;

const COUNT: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const PERMANENT_TYPES: ReadonlySet<string> = new Set(["artifact", "creature", "enchantment", "land", "planeswalker", "battle"]);
/** "you control a dragon", "you control three or more artifacts", "you control a plains or a swamp". */
const CONTROL = /^you control (?:(an?)|(\w+) or more) (.+)$/;

interface Perm { name: string; types: ReadonlySet<string>; subtypes: ReadonlySet<string>; land: boolean }
interface DeckFacts { size: number; permanents: Perm[]; initiative: boolean }

const FACTS = new WeakMap<readonly DeckCard[], DeckFacts>();
function factsOf(deck: readonly DeckCard[]): DeckFacts {
  let f = FACTS.get(deck);
  if (!f) {
    const permanents: Perm[] = [];
    let initiative = false;
    for (const dc of deck) {
      if (/\btake the initiative\b/i.test(dc.card.oracleText ?? "")) initiative = true;
      const front = (dc.card.typeLine ?? "").split("//")[0]!;
      const p = parseTypeLine(front);
      const land = countsAsLand(dc.card);
      if (!land && !p.types.some((t) => PERMANENT_TYPES.has(t))) continue;
      permanents.push({ name: dc.card.name, types: new Set(land ? [...p.types, "land"] : p.types), subtypes: new Set(p.subtypes), land });
    }
    FACTS.set(deck, (f = { size: deck.length, permanents, initiative }));
  }
  return f;
}

/** One noun of the gate against one permanent: a card type or a subtype ("dragon", "swamp"). */
const matches = (noun: string, p: Perm): boolean => (PERMANENT_TYPES.has(noun) ? p.types.has(noun) : p.subtypes.has(noun));
const singular = (w: string): string => (w.endsWith("s") && !w.endsWith("ss") && w !== "plains" ? w.slice(0, -1) : w);

/** THE CHANCE THE DECK MEETS THE GATE by the median clock, or null when the gate is not a property of a decklist (`unknown`). */
export function gateProbability(gate: string, deck: readonly DeckCard[]): number | null {
  const g = gate.trim().toLowerCase();
  const f = factsOf(deck);
  if (g === "you have the initiative") return f.initiative ? 1 : 0;
  const m = CONTROL.exec(g);
  if (!m) return null;
  const need = m[1] ? 1 : COUNT[m[2]!];
  if (need === undefined) return null;
  const phrase = m[3]!;
  const n = seen(GATE_TURN);
  if (phrase === "lands with the same name") {
    const byName = new Map<string, number>();
    for (const p of f.permanents) if (p.land) byName.set(p.name, (byName.get(p.name) ?? 0) + 1);
    return pAtLeast(need, Math.max(0, ...byName.values()), n, f.size);
  }
  if (/ and /.test(phrase)) return null;
  const nouns = phrase.split(/ or (?:an? )?/).map((w) => w.replace(/^(?:an?) /, "").trim()).map((w) => (m[1] ? w : singular(w)));
  if (nouns.some((w) => w === "" || /\s/.test(w))) return null;
  return pAtLeast(need, f.permanents.filter((p) => nouns.some((w) => matches(w, p))).length, n, f.size);
}

/** MET, UNMET OR UNKNOWN: whether the deck meets a gate string (`ManaLine.gate`). */
export function gateVerdict(gate: string, deck: readonly DeckCard[]): GateVerdict {
  const p = gateProbability(gate, deck);
  return p === null ? "unknown" : p >= GATE_CONFIDENCE ? "met" : "unmet";
}

/** A LINE'S GATE AGAINST THE DECK: an ungated line is met, and a gated one is unknown when there is no deck to judge it against (a consumer that was not given one credits
 *  only what is unconditional, as before the gate was read at all). */
export function lineGateVerdict(line: ManaLine, deck: readonly DeckCard[] | undefined): GateVerdict {
  if (line.gate === null) return "met";
  return deck ? gateVerdict(line.gate, deck) : "unknown";
}
/** The line's gate holds in this deck (an ungated line always does). */
export const gateMet = (line: ManaLine, deck: readonly DeckCard[] | undefined): boolean => lineGateVerdict(line, deck) === "met";
