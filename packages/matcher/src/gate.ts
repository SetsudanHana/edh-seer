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
 *  by the corpus median clock is at least the repo's own confidence bar (`pAtLeast`, `CORPUS_MEDIAN_CLOCK`, `REQUIRED_CONFIDENCE`: the same turn and bar `deck-math.ts` asks "does the deck have enough of X"
 *  with). A single Dragon in a hundred cards does not make Mox Jasper a rock; a dozen do. The chance itself (`gateProbability`) is what a quality weight reads.
 *  CEILING: it counts the deck's own cards of the type, not tokens they make (a Dragon token) and not changelings. THE COMMANDER IS A CARD OF THE DECK (owner 2026-10-13): every consumer is handed the
 *  whole decklist, commanders included, and the commander counts toward a gate as one of the hundred (drawn like the rest: the model does not know it is castable from the command zone
 *  every game, so a Dragon commander under-claims Mox Jasper's gate). The goldfish places it exactly (`simulate`'s `alsoPrice`: it is on the board once cast).
 *  CEILING: "you have the initiative" is met by any deck with a card that takes it, with probability 1. An opponent can take it from you by dealing combat damage to you, and the model has no opponent, so
 *  it over-claims a Sarevok's Tome in a game where the initiative is stolen.
 *  TWO READERS OF THE SAME GATE, ONE ANSWER (owner 2026-10-13: board-count gates are timed turn by turn, and the colour audit follows the gate check). The goldfish counts the permanents each
 *  simulated game puts onto the battlefield against the parsed `BoardGate` (`boardGateOf`, `permCounts`); the colour audit and the Karsten inputs ask the closed form of that timing,
 *  `gateMetBy(gate, deck, turn)`: the chance the deck has `need` of the permanents on the battlefield by that turn (a land a turn, a spell the turn after its mana value) at the same bar. The
 *  deck-level `gateVerdict` is the REPORT's filter (the audit, the Karsten inputs, the ramp role: owner 2026-10-13, a gated source counts from P >= 0.5); the goldfish does not apply it to a board-count gate, only
 *  asks that the deck can ever meet it (`boardGateReachable`) and prices the rest per game (#1191).
 *  THREE ESTIMATED KINDS (#1267, owner 2026-10-17: "estimate all three kinds from the decklist"; everything else stays `unknown`, which is unmet). Each has ONE closed form below, from facts the deck derives
 *  (`CardTags.abilities`: what a card emits, and the type line), never from oracle text. Each UNDER-CLAIMS when unsure, and the goldfish does not play them per game (`isEstimatedGate`: the deck-level
 *  verdict and the colour audit read them; a simulated game does not, the safe direction).
 *   - `threshold` (N cards in YOUR graveyard): Poisson on the expected count `graveyardMean`. Why Poisson: the count is a sum of many rare, near-independent events ("this card was seen, cast and is in
 *     the yard"), which Poisson models by its mean alone, and the mean is the one thing the derived facts give. CEILING: Poisson is wider than the true sum (its variance equals its mean, a sum of
 *     Bernoullis has less), so a need above the mean is slightly over-claimed and one below slightly under-claimed.
 *   - `counter` (counters on the card): its own ability puts them there (`put.by self`, derive): met from `put.readyTurn`; only the opening hand does (Gemstone Caverns): 3/4 x 7/N; otherwise 0 (the deck's supply of
 *     counters is NOT counted: it over-claimed).
 *   - `turn-event` (something this turn): see `turnEventProbability`.
 *  CEILING: a gate that names two kinds of thing at once ("an urza's mine and an urza's tower", the tron lands) is `unknown` here: the goldfish prices that pair against the board turn by turn. */
import { pAtLeast, seen } from "@edh-seer/engine";
import type { Ability, ManaGate, ManaLine, TurnEvent } from "@edh-seer/tagger";
import type { DeckCard } from "./types.js";
import { CORPUS_MEDIAN_CLOCK, REQUIRED_CONFIDENCE } from "./corpus-clock.js";
import { countsAsLand, parseTypeLine } from "./typeline.js";

export type GateVerdict = "met" | "unmet" | "unknown";

/** A MAX-SPEED GATE ("speed 4": `ManaLine.gate` of Muraganda Raceway's "Max speed" line, Howlsquad Heavy, Endrider Catalyzer) IS MET FROM TURN 4, IN ANY DECK (owner 2026-10-13). CR 702.179a: a player
 *  with a permanent with start your engines! and no speed has speed 1, and CR 702.179d ("Start Your Engines!"): the speed trigger fires "only once each turn" and raises speed by 1 while it is under 4,
 *  so speed 4 is met from turn 4 BY OWNER RULING 2026-10-13; the rule gives entry turn + 2 at the earliest (702.179a, 702.179d), which the model does not price: it over-claims a source cast after turn 2 and under-claims a turn-1 Raceway by one turn. The gate needs no deck, so a consumer with none (the partner index's `rampGrade`) counts it too.
 *  CEILING: speed rises only on a turn an opponent loses life (CR 702.179d), and this assumes it does on every turn from the first: turn 4 is the EARLIEST, so an over-claim by however many
 *  turns the player's opponents keep their life. The card carrying the gate is itself a start your engines! permanent in the corpus (all three), so speed exists once it is out; the model does not price the turn it is cast. */
export const MAX_SPEED_TURN = 4;
export const isSpeedGate = (gate: ManaGate): boolean => gate.kind === "speed";

const PERMANENT_TYPES: ReadonlySet<string> = new Set(["artifact", "creature", "enchantment", "land", "planeswalker", "battle"]);

/** A PERMANENT THE DECK CAN PUT ONTO THE BATTLEFIELD, as a board-count gate sees it: its card types and subtypes (a land carries "land") and the mana value it is cast for. */
export interface Perm { name: string; types: ReadonlySet<string>; subtypes: ReadonlySet<string>; land: boolean; manaValue: number; basic: boolean; power: number | null }
/** A card the deck can cast, as the estimated gates count it: the mana value it is cast for, and whether it stays (a permanent is on the battlefield from the turn after it is cast, as the board-count
 *  gates count it; an instant or sorcery is cast the turn its mana value is paid). */
interface Src { mv: number; permanent: boolean }
/** An instant or sorcery, whose cast puts it into the graveyard (the types and subtypes a typed graveyard gate matches). */
interface SpellFact extends Src { types: ReadonlySet<string>; subtypes: ReadonlySet<string>; supertypes: ReadonlySet<string> }
/** A card that puts cards of YOUR deck into YOUR graveyard (discard, mill, surveil, all `control: you`): `n` cards, the printed amount when it is a number, else 1. */
interface FillerFact extends Src { n: number }
interface DeckFacts {
  size: number; permanents: Perm[]; initiative: boolean; spells: SpellFact[]; fillers: FillerFact[]; lifeLoss: Src[]; outlets: Src[];
  /** Every card's types and subtypes, to find the share of a deck a typed graveyard gate matches. */
  kinds: { types: ReadonlySet<string>; subtypes: ReadonlySet<string>; supertypes: ReadonlySet<string> }[];
}

/** THE CARD AS A PERMANENT, or null for an instant, a sorcery or anything else that never stays (the front face, as the type line of a card in hand reads: CR 712.8a). */
export function permOf(dc: DeckCard): Perm | null {
  const front = (dc.card.typeLine ?? "").split("//")[0]!;
  const p = parseTypeLine(front);
  const land = countsAsLand(dc.card);
  if (!land && !p.types.some((t) => PERMANENT_TYPES.has(t))) return null;
  // CEILING: the printed power; a double-faced card has none on the card and reads its FIRST face's (`faces[0].power`), the face it is cast as (CR 712.8a, as the type line above). A '*' or any other
  // non-number never counts toward a power gate: a Tarmogoyf's power is a number only in a game, which this does not play.
  const printed = dc.card.power ?? dc.card.faces?.[0]?.power;
  const power = /^\d+$/.test(printed ?? "") ? Number(printed) : null;
  return { name: dc.card.name, types: new Set(land ? [...p.types, "land"] : p.types), subtypes: new Set(p.subtypes), land, manaValue: dc.card.manaValue ?? 0, basic: p.supertypes.includes("basic"), power };
}

const FACTS = new WeakMap<readonly DeckCard[], DeckFacts>();
const FILL_VERBS: ReadonlySet<string> = new Set(["discard", "mill", "surveil"]);
/** Abilities that fire (a static ability's emits are not an act). */
const acts = (a: Ability): boolean => a.kind !== "static";
/** The printed number of a fill ("mill 3", "surveil 2"); anything else ("X", "for each ...") is 1, the under-claim. */
const countOf = (a: Ability): number => (/^\d+$/.test(a.amount ?? "") ? Number(a.amount) : 1);
function factsOf(deck: readonly DeckCard[]): DeckFacts {
  let f = FACTS.get(deck);
  if (!f) {
    const permanents: Perm[] = [];
    let initiative = false;
    const spells: SpellFact[] = [], fillers: FillerFact[] = [], lifeLoss: Src[] = [], outlets: Src[] = [], kinds: DeckFacts["kinds"] = [];
    for (const dc of deck) {
      if (/\btake the initiative\b/i.test(dc.card.oracleText ?? "")) initiative = true;
      const p = permOf(dc);
      if (p) permanents.push(p);
      const parsed = parseTypeLine((dc.card.typeLine ?? "").split("//")[0]!);
      const types = new Set(p ? p.types : parsed.types), subtypes = new Set(parsed.subtypes), supertypes = new Set(parsed.supertypes);
      kinds.push({ types, subtypes, supertypes });
      const src: Src = { mv: dc.card.manaValue ?? 0, permanent: p !== null };
      if (!p && (types.has("instant") || types.has("sorcery"))) spells.push({ ...src, types, subtypes, supertypes });
      let fill = 0, loses = false, outlet = false;
      for (const a of (dc.tags?.abilities ?? []).filter(acts)) for (const e of a.emits ?? []) {
        const you = e.subject.control === "you";
        if (FILL_VERBS.has(e.verb) && you) fill = Math.max(fill, countOf(a));
        if ((e.verb === "lose-life" || e.verb === "non-combat-damage") && (e.subject.control === "opp" || e.subject.control === "any")) loses = true;
        if (e.verb === "sacrifice" && you && e.subject.self !== true && a.kind === "activated") outlet = true;
      }
      if (fill > 0) fillers.push({ ...src, n: fill });
      if (loses) lifeLoss.push(src);
      if (outlet) outlets.push(src);
    }
    FACTS.set(deck, (f = { size: deck.length, permanents, initiative, spells, fillers, lifeLoss, outlets, kinds }));
  }
  return f;
}
/** HOW MANY OF THESE ARE CAST BY THE TURN: a permanent from the turn after its mana value is paid (never on turn 1: `boardGateProbability`'s rule), a spell the turn its mana value is paid. */
const castBy = (srcs: readonly Src[], turn: number): number => srcs.filter((x) => (x.permanent ? x.mv < turn && turn >= 2 : x.mv <= turn)).length;
/** The chance at least `need` of these are among the cards seen by the turn. */
const seenAtLeast = (need: number, srcs: readonly Src[], turn: number, size: number): number => pAtLeast(need, castBy(srcs, turn), seen(turn), size);

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

/** CAN THE DECK EVER MEET THIS BOARD GATE: it holds `need` permanents the gate counts. Reachability, not a probability -- the goldfish prices a board gate per game against the permanents
 *  the game puts onto the battlefield, and this only says that some game can (a deck with no Dragon has no Jasper to play in any of them). */
export const boardGateReachable = (g: BoardGate, deck: readonly DeckCard[]): boolean => boardCount(g, factsOf(deck).permanents) >= g.need;

/** THE CHANCE THE DECK MEETS THE GATE, or null when the gate is not a property of a decklist (`unknown`). By default by the median clock (`CORPUS_MEDIAN_CLOCK`), over every card of the
 *  deck. With `by`, BY THAT TURN (the goldfish's timing, in closed form): the cards seen by then (`seen(by)`), and only the permanents that can be on the battlefield on it --
 *  a land (a land drop a turn) or a spell whose mana value is BELOW the turn: cast on curve the turn before, the colour audit's rock clock (`manaValue < turn`) and the goldfish's
 *  own, which counts a permanent it 'casts' from the next turn. CEILING: on curve is the mana available on that turn, and a spell cast earlier than it costs the turn's other plays,
 *  which this does not price. A count of lands cannot exceed the land drops: `need` over `by` is 0, and `holderIsLand` -- the source whose gate it is takes a land drop of its own
 *  (a Tainted land beside its Swamp) -- needs one more. */
export function gateProbability(gate: ManaGate, deck: readonly DeckCard[], by?: number, holderIsLand = false): number | null {
  if (gate.kind === "speed") return by === undefined || by >= gate.n ? 1 : 0;
  const f = factsOf(deck);
  if (gate.kind === "initiative") return f.initiative ? 1 : 0;
  const n = seen(by ?? CORPUS_MEDIAN_CLOCK);
  if (gate.kind === "same-name") {
    const byName = new Map<string, number>();
    for (const p of f.permanents) if (p.land) byName.set(p.name, (byName.get(p.name) ?? 0) + 1);
    if (by !== undefined && gate.need + (holderIsLand ? 1 : 0) > by) return 0;
    return pAtLeast(gate.need, Math.max(0, ...byName.values()), n, f.size);
  }
  if (gate.kind === "threshold") return poissonAtLeast(gate.need, graveyardMean(gate, f, by ?? CORPUS_MEDIAN_CLOCK));
  if (gate.kind === "counter") return counterProbability(gate, f, by ?? CORPUS_MEDIAN_CLOCK);
  if (gate.kind === "turn-event") return turnEventProbability(gate.event, deck, f, by);
  const b = boardGateOf(gate);
  return b ? boardGateProbability(b, deck, by, holderIsLand) : null;
}

/** THE KINDS THIS MODULE ESTIMATES FROM THE DECKLIST (#1267) AND THE GOLDFISH DOES NOT PLAY PER GAME: its simulation has no graveyard, no counters on a card and no turn's events, so it
 *  treats them as unmet (the conservative default, owner brief 2026-10-17); the report's verdict and the colour audit read the estimate. */
export const isEstimatedGate = (gate: ManaGate): boolean => gate.kind === "threshold" || gate.kind === "counter" || gate.kind === "turn-event";

/** P(X >= need) for X ~ Poisson(mean). Summed from the complement of the (few) terms below `need`, which are small numbers for the needs a gate prints. */
function poissonAtLeast(need: number, mean: number): number {
  if (need <= 0) return 1;
  if (mean <= 0) return 0;
  let term = Math.exp(-mean), below = term;
  for (let k = 1; k < need; k++) { term *= mean / k; below += term; }
  return Math.max(0, 1 - below);
}

/** THE EXPECTED CARDS IN YOUR GRAVEYARD BY THE TURN, of the kind the gate names. The sum of
 *   - the instants and sorceries the deck casts: each one seen (7 + turn cards of the deck) and castable by the turn (mana value at most the turn), but never more than turn - 1 of them in all (one spell
 *     a turn, none on the first: under-claims a turn-1 cast and a double-spell turn);
 *   - the cards the deck's own fillers put there: each filler seen and cast by the turn adds its printed amount (1 when it prints none), once; a filled card matches a typed gate at the share of the deck that matches.
 *  An untyped gate matches every card; a typed one counts a spell only when its own types or subtypes match, and a filled card only at the deck's share of matching cards.
 *  CEILING: creatures dying, a land sacrificed, a flashback or a recursion spell are not counted; a filler fires once, however repeatable; a spell is assumed cast when it can be, not held; the
 *  holder itself (Cabal Ritual, on the stack when its gate is read) is counted among the spells; the discards are assumed to be as typed as the whole deck. All of these under-claim except the last two. */
function graveyardMean(g: Extract<ManaGate, { kind: "threshold" }>, f: DeckFacts, turn: number): number {
  const matches = (types: ReadonlySet<string>, subtypes: ReadonlySet<string>, supertypes: ReadonlySet<string>): boolean =>
    (g.supertypes?.every((t) => supertypes.has(t)) ?? true)
    && ((g.types === undefined && g.subtypes === undefined) || (g.types?.some((t) => types.has(t)) ?? false) || (g.subtypes?.some((t) => subtypes.has(t)) ?? false));
  const share = f.size === 0 ? 0 : f.kinds.filter((k) => matches(k.types, k.subtypes, k.supertypes)).length / f.size;
  const seenShare = Math.min(1, seen(turn) / Math.max(1, f.size));
  const castSpells = Math.min(Math.max(0, turn - 1), f.spells.filter((s) => s.mv <= turn && matches(s.types, s.subtypes, s.supertypes)).length * seenShare);
  const filled = f.fillers.reduce((sum, x) => sum + (castBy([x], turn) > 0 ? x.n : 0), 0) * seenShare * share;
  return castSpells + filled;
}

/** A COUNTER GATE'S CHANCE (see the header): met when the card's own words put the counters on it (`put.by self`, from `put.readyTurn`; derive reads Adapt, Monstrosity, Outlast, Evolve and "put ... counter on
 *  this ..."), or in the opening hand (Gemstone Caverns: 3/4 x 7/N). Anything else is 0.
 *  CEILING: THE DECK'S SUPPLY IS DROPPED (owner review 2026-10-17). "The deck has a card that puts that counter on a creature you control" over-claimed: the counter rarely lands on the holder, so a gate whose card puts
 *  no counter on itself is unmet in every deck. CEILING: the opening-hand case ignores a mulligan, the card exiled from the hand to pay for it, and a table that is not four players. */
function counterProbability(g: Extract<ManaGate, { kind: "counter" }>, f: DeckFacts, turn: number): number {
  if (g.put?.by === "self") return turn >= g.put.readyTurn ? 1 : 0;
  if (g.put?.by === "opening-hand") return 0.75 * Math.min(1, 7 / Math.max(1, f.size));
  return 0;
}

/** THE CHANCE OF SOMETHING HAVING HAPPENED EARLIER THIS TURN, by the median clock or by `by`. Each is a deck-level estimate and under-claims when unsure; the holder's own cast is priced by the consumer.
 *   - `land-played`: the chance of a land among the cards seen (a land drop each turn).
 *   - `attacked`: a creature on the battlefield, the board-count machinery (`boardGateProbability`: cast the turn before at the earliest, so no attack on turn 1). CEILING: a creature cast late attacks late and a
 *     creature that cannot attack is counted.
 *   - `opponent-lost-life`: the larger of an attacker (as above) and a card that makes an opponent lose life or takes damage to a player, seen and cast. CEILING: over-claims a blocked attack and a damage
 *     source that needs a trigger; "any target" damage counts as one that can hit an opponent.
 *   - `creature-died`: a repeatable sacrifice outlet you control (an activated sacrifice of something that is not itself), seen and cast, AND a creature on the board (the two taken as independent: their product).
 *     CEILING: a creature dying in combat or to removal is not counted; sacrifice outlets are the only deaths on demand.
 *   - `permanent-left`: the outlet alone (it can feed itself a token or a Treasure). CEILING: bounce and blink, which also leave the battlefield, are not counted.
 *   - `entered-this-turn` (Mirrex): true only on the turn the land enters, and the evaluator has no entry turn: 0 (unmet) always. CEILING: an under-claim of the entry turn, as Gleaming Bastion's. */
function turnEventProbability(event: TurnEvent, deck: readonly DeckCard[], f: DeckFacts, by?: number): number {
  const turn = by ?? CORPUS_MEDIAN_CLOCK;
  const attackers = (): number => boardGateProbability({ need: 1, nouns: ["creature"] }, deck, by);
  switch (event) {
    case "land-played": return pAtLeast(1, f.permanents.filter((p) => p.land).length, seen(turn), f.size);
    case "attacked": return attackers();
    case "opponent-lost-life": return Math.max(attackers(), seenAtLeast(1, f.lifeLoss, turn, f.size));
    case "creature-died": return seenAtLeast(1, f.outlets, turn, f.size) * attackers();
    case "permanent-left": return seenAtLeast(1, f.outlets, turn, f.size);
    case "entered-this-turn": return 0;
  }
}

/** THE CHANCE OF A PARSED BOARD-COUNT GATE (`gateProbability`'s board branch): by the median clock over every card, or with `by` by that turn. */
export function boardGateProbability(b: BoardGate, deck: readonly DeckCard[], by?: number, holderIsLand = false): number {
  const f = factsOf(deck);
  const counted = f.permanents.filter((p) => permCounts(b, p));
  if (by !== undefined && counted.every((p) => p.land) && b.need + (holderIsLand ? 1 : 0) > by) return 0;
  // A SPELL COUNTS FROM THE TURN AFTER IT CAN BE CAST, and never on turn 1: the goldfish casts a permanent it has no use for as a proxy at the END of the first turn whose leftover mana pays
  // its mana value and counts it from the NEXT turn, so a 0-mana artifact is out on turn 2, not 1 (`manaValue < by` alone said turn 1).
  // CEILING: this applies to a free ACCELERANT too (a Mox is cast and counted on turn 1 in the goldfish, turn 2 here): an under-claim, the safe direction.
  return pAtLeast(b.need, counted.filter((p) => by === undefined || p.land || (p.manaValue < by && by >= 2)).length, seen(by ?? CORPUS_MEDIAN_CLOCK), f.size);
}

/** MET BY THIS TURN, in closed form: the same gate, the same bar (`REQUIRED_CONFIDENCE`), the deck's chance of having the permanents on the battlefield by `turn` (`gateProbability`'s `by`).
 *  The colour audit and the Karsten inputs ask it; the goldfish counts the permanents of each simulated game against the same `BoardGate`. A gate no decklist settles is not met. */
export function gateMetBy(gate: ManaGate, deck: readonly DeckCard[], turn: number, holderIsLand = false): boolean {
  const p = gateProbability(gate, deck, turn, holderIsLand);
  return p !== null && p >= REQUIRED_CONFIDENCE;
}

/** THE LINE'S GATE HOLDS BY THIS TURN (an ungated line always does; a gated one with no deck to judge it against never does). */
export const lineGateMetBy = (line: ManaLine, deck: readonly DeckCard[] | undefined, turn: number): boolean =>
  line.gate === null || ((deck !== undefined || isSpeedGate(line.gate)) && gateMetBy(line.gate, deck ?? [], turn));

/** MET, UNMET OR UNKNOWN: whether the deck meets a gate string (`ManaLine.gate`). */
export function gateVerdict(gate: ManaGate, deck: readonly DeckCard[]): GateVerdict {
  const p = gateProbability(gate, deck);
  return p === null ? "unknown" : p >= REQUIRED_CONFIDENCE ? "met" : "unmet";
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
