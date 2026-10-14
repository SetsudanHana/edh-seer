/** A GATED MANA LINE, JUDGED AGAINST THE DECK (#1169 task 2b-2; owner 2026-10-13): "gated is conditional same as lands, so it should impact the card quality, but overall it is a
 *  mana rock, but with condition so it matches only specific themes, like in this case dragons." Mox Jasper ("Activate only if you control a Dragon") is a rock in a deck that
 *  plays Dragons and a blank in one that does not. Derive stores the condition as a typed `ManaGate` (`ManaLine.gate`, parsed ONCE by `parseGate` in the tagger; #1191); this module is the ONE place
 *  that EVALUATES it against a decklist and parses no words, so the goldfish, the rock swaps and the ramp weight cannot disagree about whether a deck meets a card's gate.
 *
 *  THREE VERDICTS. `met`: the deck has enough of what the gate asks for. `unmet`: it does not. `unknown`: the gate is not a property of a decklist (a game state:
 *  "an opponent has three or more poison counters"; the card's own state: counters on it, "it was bargained"; a trigger: Princess Yue's "when princess yue dies"), or this reader does not
 *  parse it. A MAX-SPEED GATE IS NONE OF THESE: it is met from turn 4 in any deck (`isSpeedGate`). UNKNOWN IS TREATED AS UNMET by every consumer, never as met: a silent wrong answer is worse than a missing one.
 *
 *  "ENOUGH" (CEILING): a gate that asks for N permanents of a kind ("you control a dragon", "three or more artifacts", "a swamp") is met when the chance of having N of them among the cards seen
 *  by the corpus median clock is at least the repo's own confidence bar (`pAtLeast`, `GATE_TURN`, `GATE_CONFIDENCE`: the same turn and bar `deck-math.ts` asks "does the deck have enough of X"
 *  with). A single Dragon in a hundred cards does not make Mox Jasper a rock; a dozen do. The chance itself (`gateProbability`) is what a quality weight reads.
 *  CEILING: it counts the deck's own cards of the type, not tokens they make (a Dragon token) and not changelings. THE COMMANDER IS A CARD OF THE DECK (owner 2026-10-13): every consumer is handed the
 *  whole decklist, commanders included, and the commander counts toward a gate as one of the hundred (drawn like the rest: the model does not know it is castable from the command zone
 *  every game, so a Dragon commander under-claims Mox Jasper's gate). The goldfish places it exactly (`simulate`'s `alsoPrice`: it is on the board once cast).
 *  CEILING: "you have the initiative" is met by any deck with a card that takes it, with probability 1. An opponent can take it from you by dealing combat damage to you, and the model has no opponent, so
 *  it over-claims a Sarevok's Tome in a game where the initiative is stolen.
 *  TWO READERS OF THE SAME GATE, ONE ANSWER (owner 2026-10-13: board-count gates are timed turn by turn, and the colour audit follows the gate check). The goldfish counts the permanents each
 *  simulated game puts onto the battlefield against the parsed `BoardGate` (`boardGateOf`, `permCounts`); the colour audit and the Karsten inputs ask the closed form of that timing,
 *  `gateMetBy(gate, deck, turn)`: the chance the deck has `need` of the permanents on the battlefield by that turn (a land a turn, a spell the turn after its mana value) at the same bar. The
 *  deck-level `gateVerdict` stays the first filter on both: a deck that cannot meet a gate by the median clock has no such source.
 *  CEILING: a gate that names two kinds of thing at once ("an urza's mine and an urza's tower", the tron lands) is `unknown` here: the goldfish prices that pair against the board turn by turn. */
import { pAtLeast, seen } from "@edh-seer/engine";
import type { ManaGate, ManaLine } from "@edh-seer/tagger";
import type { DeckCard } from "./types.js";
import { countsAsLand, parseTypeLine } from "./typeline.js";

export type GateVerdict = "met" | "unmet" | "unknown";

/** A MAX-SPEED GATE ("speed 4": `ManaLine.gate` of Muraganda Raceway's "Max speed" line, Howlsquad Heavy, Endrider Catalyzer) IS MET FROM TURN 4, IN ANY DECK (owner 2026-10-13). CR 702.179a: a player
 *  with a permanent with start your engines! and no speed has speed 1, and CR 702.179d ("Start Your Engines!"): the speed trigger fires "only once each turn" and raises speed by 1 while it is under 4,
 *  so speed 4 is met from turn 4 BY OWNER RULING 2026-10-13; the rule gives entry turn + 2 at the earliest (702.179a, 702.179d), which the model does not price: it over-claims a source cast after turn 2 and under-claims a turn-1 Raceway by one turn. The gate needs no deck, so a consumer with none (the partner index's `rampGrade`) counts it too.
 *  CEILING: speed rises only on a turn an opponent loses life (CR 702.179d), and this assumes it does on every turn from the first: turn 4 is the EARLIEST, so an over-claim by however many
 *  turns the player's opponents keep their life. The card carrying the gate is itself a start your engines! permanent in the corpus (all three), so speed exists once it is out; the model does not price the turn it is cast. */
export const MAX_SPEED_TURN = 4;
export const isSpeedGate = (gate: ManaGate): boolean => gate.kind === "speed";

/** The turn the deck is asked at: `CORPUS_MEDIAN_CLOCK` in `deck-math.ts`, and the confidence bar is its `REQUIRED_CONFIDENCE`. Not imported: deck-math reaches this module through
 *  land-score and same-job. `gate.test.ts` pins both. */
export const GATE_TURN = 9;
export const GATE_CONFIDENCE = 0.5;

const PERMANENT_TYPES: ReadonlySet<string> = new Set(["artifact", "creature", "enchantment", "land", "planeswalker", "battle"]);

/** A PERMANENT THE DECK CAN PUT ONTO THE BATTLEFIELD, as a board-count gate sees it: its card types and subtypes (a land carries "land") and the mana value it is cast for. */
export interface Perm { name: string; types: ReadonlySet<string>; subtypes: ReadonlySet<string>; land: boolean; manaValue: number; basic: boolean; power: number | null }
interface DeckFacts { size: number; permanents: Perm[]; initiative: boolean }

/** THE CARD AS A PERMANENT, or null for an instant, a sorcery or anything else that never stays (the front face, as the type line of a card in hand reads: CR 712.8a). */
export function permOf(dc: DeckCard): Perm | null {
  const front = (dc.card.typeLine ?? "").split("//")[0]!;
  const p = parseTypeLine(front);
  const land = countsAsLand(dc.card);
  if (!land && !p.types.some((t) => PERMANENT_TYPES.has(t))) return null;
  // CEILING: the printed power (`card.power`); a '*' or any other non-number never counts toward a power gate, and a double-faced card reads its first face's.
  const power = /^\d+$/.test(dc.card.power ?? "") ? Number(dc.card.power) : null;
  return { name: dc.card.name, types: new Set(land ? [...p.types, "land"] : p.types), subtypes: new Set(p.subtypes), land, manaValue: dc.card.manaValue ?? 0, basic: p.supertypes.includes("basic"), power };
}

const FACTS = new WeakMap<readonly DeckCard[], DeckFacts>();
function factsOf(deck: readonly DeckCard[]): DeckFacts {
  let f = FACTS.get(deck);
  if (!f) {
    const permanents: Perm[] = [];
    let initiative = false;
    for (const dc of deck) {
      if (/\btake the initiative\b/i.test(dc.card.oracleText ?? "")) initiative = true;
      const p = permOf(dc);
      if (p) permanents.push(p);
    }
    FACTS.set(deck, (f = { size: deck.length, permanents, initiative }));
  }
  return f;
}

/** One noun of the gate against one permanent: a card type or a subtype ("dragon", "swamp"). */
const matches = (noun: string, p: Perm): boolean => (PERMANENT_TYPES.has(noun) ? p.types.has(noun) : p.subtypes.has(noun));

/** A BOARD-COUNT GATE: "you control a dragon", "you control three or more artifacts", "you control a plains or a swamp", "a basic land", "a creature with power 4 or greater" -- `need` permanents
 *  among `nouns` (card types and subtypes), BASIC lands only when `basic`, with power at least `minPower` when set. Parsed once, in derive (`parseGate`); this reads the typed gate, read by the
 *  closed form below (the colour audit and the Karsten inputs) and by the goldfish, which counts the permanents it puts onto the battlefield turn by turn. Null for every other gate. */
export interface BoardGate { need: number; nouns: readonly string[]; basic?: true; minPower?: number }
export function boardGateOf(gate: ManaGate): BoardGate | null {
  if (gate.kind !== "control") return null;
  return { need: gate.need, nouns: gate.nouns, ...(gate.basic ? { basic: true as const } : {}), ...(gate.minPower !== undefined ? { minPower: gate.minPower } : {}) };
}
/** The permanent is one the gate counts. */
export const permCounts = (g: BoardGate, p: Perm): boolean =>
  g.nouns.some((w) => matches(w, p)) && (!g.basic || p.basic) && (g.minPower === undefined || (p.power !== null && p.power >= g.minPower));
/** HOW MANY OF THESE PERMANENTS THE GATE COUNTS. */
export const boardCount = (g: BoardGate, perms: readonly Perm[]): number => perms.filter((p) => permCounts(g, p)).length;

/** THE CHANCE THE DECK MEETS THE GATE, or null when the gate is not a property of a decklist (`unknown`). By default by the median clock (`GATE_TURN`), over every card of the
 *  deck. With `by`, BY THAT TURN (the goldfish's timing, in closed form): the cards seen by then (`seen(by)`), and only the permanents that can be on the battlefield on it --
 *  a land (a land drop a turn) or a spell whose mana value is BELOW the turn: cast on curve the turn before, the colour audit's rock clock (`manaValue < turn`) and the goldfish's
 *  own, which counts a permanent it 'casts' from the next turn. CEILING: on curve is the mana available on that turn, and a spell cast earlier than it costs the turn's other plays,
 *  which this does not price. A count of lands cannot exceed the land drops: `need` over `by` is 0, and `holderIsLand` -- the source whose gate it is takes a land drop of its own
 *  (a Tainted land beside its Swamp) -- needs one more. */
export function gateProbability(gate: ManaGate, deck: readonly DeckCard[], by?: number, holderIsLand = false): number | null {
  if (gate.kind === "speed") return by === undefined || by >= gate.n ? 1 : 0;
  const f = factsOf(deck);
  if (gate.kind === "initiative") return f.initiative ? 1 : 0;
  const n = seen(by ?? GATE_TURN);
  if (gate.kind === "same-name") {
    const byName = new Map<string, number>();
    for (const p of f.permanents) if (p.land) byName.set(p.name, (byName.get(p.name) ?? 0) + 1);
    if (by !== undefined && gate.need + (holderIsLand ? 1 : 0) > by) return 0;
    return pAtLeast(gate.need, Math.max(0, ...byName.values()), n, f.size);
  }
  const b = boardGateOf(gate);
  return b ? boardGateProbability(b, deck, by, holderIsLand) : null;
}

/** THE CHANCE OF A PARSED BOARD-COUNT GATE (`gateProbability`'s board branch): by the median clock over every card, or with `by` by that turn. */
export function boardGateProbability(b: BoardGate, deck: readonly DeckCard[], by?: number, holderIsLand = false): number {
  const f = factsOf(deck);
  const counted = f.permanents.filter((p) => permCounts(b, p));
  if (by !== undefined && counted.every((p) => p.land) && b.need + (holderIsLand ? 1 : 0) > by) return 0;
  // A SPELL COUNTS FROM THE TURN AFTER IT CAN BE CAST, and never on turn 1: the goldfish casts a permanent it has no use for as a proxy at the END of the first turn whose leftover mana pays
  // its mana value and counts it from the NEXT turn, so a 0-mana artifact is out on turn 2, not 1 (`manaValue < by` alone said turn 1).
  // CEILING: this applies to a free ACCELERANT too (a Mox is cast and counted on turn 1 in the goldfish, turn 2 here): an under-claim, the safe direction.
  return pAtLeast(b.need, counted.filter((p) => by === undefined || p.land || (p.manaValue < by && by >= 2)).length, seen(by ?? GATE_TURN), f.size);
}

/** MET BY THIS TURN, in closed form: the same gate, the same bar (`GATE_CONFIDENCE`), the deck's chance of having the permanents on the battlefield by `turn` (`gateProbability`'s `by`).
 *  The colour audit and the Karsten inputs ask it; the goldfish counts the permanents of each simulated game against the same `BoardGate`. A gate no decklist settles is not met. */
export function gateMetBy(gate: ManaGate, deck: readonly DeckCard[], turn: number, holderIsLand = false): boolean {
  const p = gateProbability(gate, deck, turn, holderIsLand);
  return p !== null && p >= GATE_CONFIDENCE;
}

/** THE LINE'S GATE HOLDS BY THIS TURN (an ungated line always does; a gated one with no deck to judge it against never does). */
export const lineGateMetBy = (line: ManaLine, deck: readonly DeckCard[] | undefined, turn: number): boolean =>
  line.gate === null || ((deck !== undefined || isSpeedGate(line.gate)) && gateMetBy(line.gate, deck ?? [], turn));

/** MET, UNMET OR UNKNOWN: whether the deck meets a gate string (`ManaLine.gate`). */
export function gateVerdict(gate: ManaGate, deck: readonly DeckCard[]): GateVerdict {
  const p = gateProbability(gate, deck);
  return p === null ? "unknown" : p >= GATE_CONFIDENCE ? "met" : "unmet";
}

/** A LINE'S GATE AGAINST THE DECK: an ungated line is met, and a gated one is unknown when there is no deck to judge it against (a consumer that was not given one credits
 *  only what is unconditional, as before the gate was read at all). */
export function lineGateVerdict(line: ManaLine, deck: readonly DeckCard[] | undefined): GateVerdict {
  if (line.gate === null) return "met";
  // A max-speed gate needs no deck (`isSpeedGate`).
  if (isSpeedGate(line.gate)) return "met";
  return deck ? gateVerdict(line.gate, deck) : "unknown";
}
/** The line's gate holds in this deck (an ungated line always does). */
export const gateMet = (line: ManaLine, deck: readonly DeckCard[] | undefined): boolean => lineGateVerdict(line, deck) === "met";
