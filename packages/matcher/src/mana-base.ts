import { pAtLeast, seen } from "@edh-seer/engine";
import { castableManaCost } from "./split-cost.js";
import { classifyLand } from "./land-conditions.js";
import { fetchableLands, fetchedLandEntersTapped, isLandFetch } from "./fetch-land.js";
import { COLORS, isManaSource, type Color } from "./mana-audit.js";
import type { DeckCard } from "./types.js";

/** ONE MANA-BASE MODEL, IN ONE UNIT (owner, 2026-09-29: "you have to account for finding golden
 *  center between: do not skip land a turn, mana requirements and mana flood where you just draw
 *  lands and have nothing to play", then "we have account for color requirements, cause then we can
 *  build one manabase quality evaluator formula").
 *
 *  THE UNIT IS A LOST TURN, counted over a game's first ten turns by a spending goldfish that
 *  plays the deck the way `mulligan.ts` keeps it: land first, ramp next, then the dearest set of
 *  spells the mana and its colours can pay. A turn is lost three ways:
 *  - SCREW: no land to play, and a spell costing no more than the turn number is stuck for mana.
 *  - COLOUR SCREW: the mana is there by count and not by colour, and some of it goes unspent.
 *  - FLOOD: the card drawn is a land the deck will never need, because the mana on the table and
 *    the lands already in hand pay for the dearest card in hand and in the command zone.
 *
 *  FITTED, NOT PUBLISHED. 268 decks (197 precons and the 71 calibration decks), 2,000 games each,
 *  every land count from 28 to 48, plus three rebuilt mana bases per deck (every land every colour,
 *  every land untapped, both). The script is research-only and lives outside the repo; its numbers
 *  are recorded where they are used below.
 *
 *  WHAT IT REPLACES: Karsten's regression, the [28, 39] gate that fell back to a flat 36, and the
 *  flat 36 itself. Measured against each deck's own balance point, extra lost turns per ten turns:
 *  the gate 0.104, flat 37 0.093, Karsten raw 0.089, what the decks actually run 0.089, this 0.065.
 *  PRECONS ARE NOT THE BENCHMARK (owner, 2026-09-29, of the Miku precon's 34 lands): their real land
 *  counts track what their own curves need at a correlation of 0.36. They sit in 36-40 whatever the
 *  curve, so they supplied deck lists here and never a target. */

/** THE LAND COUNT FOR A MANA PACKAGE, NOT FOR A DECK IN THE ABSTRACT (owner, 2026-09-29: "if we
 *  are replacing lands with cheap draw it is bumping the consistency of the deck ... sure 34 is the
 *  target, but in this case your consistency should be this, or your ramp should be that").
 *
 *  Lands, ramp and draw are three knobs on the same job, so a land target means something only for
 *  a given ramp and draw package. The two rates below are MEASURED INSIDE EACH DECK, not across
 *  decks: the goldfish (now with a draw model read off each card's tags -- cantrips, engines that
 *  fire on your own casts and land drops, upkeep draw, opponent-driven draw at a stated rate,
 *  scry and looting, land tutors) swept every land count with 2 rocks added, 2 of the deck's own
 *  ramp pieces removed, 2 draw spells added and 2 of its own draw pieces removed, trading lands only
 *  with spells that neither ramp nor draw. Over 268 decks, at 1,500 games per count:
 *  - 0.57 of a land per ACCELERANT (a rock, a dork, a land-fetch spell), 0.55 adding and 0.60
 *    removing, the same at 4 accelerants as at 12. Karsten's cheap-ramp figure is 0.28.
 *  - 0.25 of a land per card in the DRAW role: the deck's own draw pieces measured 0.22 removed, a
 *    Night's Whisper 0.46 added, and 0.25 is what the fit below settles on between them.
 *  - 3.95 a point of average mana value and 0.54 a point of commander mana value, fitted across the
 *    decks with those two rates held.
 *  Held to each deck's own best count, it misses by 1.4 lands on average; the formula it replaces
 *  (24.1 + 3.25 avg + 0.54 commander - 0.10 cheap ramp and draw) missed by 2.0 and read 1.6 high. A
 *  free fit of all five terms misses by 1.2, but its ramp and draw weights come from comparing
 *  different decks (ramp-heavy decks need more lands for other reasons) and would disagree with the
 *  trade the report quotes, so the measured rates are the ones used.
 *
 *  THE GOLDFISH IS OPTIMISTIC ABOUT RAMP AND DRAW -- nothing is ever destroyed, so every accelerant
 *  and every draw piece keeps paying -- and left to itself it always wants more of both. So how much
 *  of each a deck SHOULD run comes from the role targets (real decks), and `recommendedLands` counts
 *  ramp and draw only up to them. */
export const LAND_FORMULA = {
  base: 27.0, perManaValue: 3.95, perCommanderManaValue: 0.54, perAccelerant: 0.57, perDrawPiece: 0.25,
} as const;

/** The land counts the goldfish was run at. Outside them the formula is an extrapolation, so the
 *  target is CLAMPED to the nearest measured count rather than swapped for a convention: the old
 *  gate answered a 50-land curve with 36, which is the one answer the measurement rules out. */
export const SIMULATED_MIN_LANDS = 28;
export const SIMULATED_MAX_LANDS = 48;

export interface LandFormulaInputs {
  /** Mean mana value of the library's nonlands (`landInputs`). */
  avgManaValue: number;
  /** The dearest commander's mana value, 0 for a deck without one. */
  commanderManaValue: number;
  /** Rocks, dorks and land-fetch spells (`classifyAccelerant`), up to the Ramp role's target. */
  accelerants: number;
  /** Cards in the Draw role, up to the Consistency role's target. */
  drawPieces: number;
}

/** The land target, rounded and clamped to the simulated range. */
export function landTarget(inputs: LandFormulaInputs): number {
  const raw = LAND_FORMULA.base
    + LAND_FORMULA.perManaValue * inputs.avgManaValue
    + LAND_FORMULA.perCommanderManaValue * inputs.commanderManaValue
    - LAND_FORMULA.perAccelerant * inputs.accelerants
    - LAND_FORMULA.perDrawPiece * inputs.drawPieces;
  return Math.min(SIMULATED_MAX_LANDS, Math.max(SIMULATED_MIN_LANDS, Math.round(raw)));
}

/** WHAT EACH PART COSTS, in lost turns per ten turns.
 *
 *  - COUNT: `short * short * 0.005` below the target, `over * over * 0.004` above it. Read off
 *    every deck's own curve against the formula's target: 1-3 lands off costs about 0.03, 3-6 about
 *    0.1, 6-10 about 0.3. Flat near the target and steep past it, which is why a two-land miss is
 *    not a finding (`LAND_BAND`) and a seven-land one is.
 *  - COLOUR: 0.133 per `colourMiss` card, against what the same deck saves with every land making
 *    every colour (R^2 0.70 over the 268 decks; fitted on the precons alone it still explains 37%
 *    of the calibration decks' own).
 *  - TAPPED: 0.025 per land that always enters tapped, against the same deck with every land
 *    untapped (R^2 0.48: a tapped land costs most when it arrives early, which a count cannot see).
 *
 *  WHERE THE LOST TURNS WERE, as built: colours 0.62 on average (0.08 in a mono-colour deck, 0.87
 *  in a three-colour one), tapped lands 0.19, the land count 0.08. The count is the smallest lever
 *  on most real decks, and the report should say so rather than lead with it. */
export const MANA_BASE_COST = { short: 0.005, over: 0.004, colourMiss: 0.133, tapped: 0.025 } as const;

const PIP_COLOURS = new Set<string>(COLORS);

/** A card's coloured pips, each as the colours that pay it: `{W/U}` is either, `{2/W}` white, and
 *  a Phyrexian pip is paid with life, so it asks nothing of the mana base. */
function pipOptions(manaCost: string | undefined): Color[][] {
  const out: Color[][] = [];
  for (const symbol of manaCost?.match(/\{[^{}]+\}/g) ?? []) {
    const parts = symbol.slice(1, -1).toUpperCase().split("/");
    if (parts.includes("P")) continue;
    const colours = parts.filter((p): p is Color => PIP_COLOURS.has(p));
    if (colours.length > 0) out.push(colours);
  }
  return out;
}

const isLand = (dc: DeckCard): boolean => /\bland\b/i.test(dc.card.typeLine);

/** A `{T}: Add` ability whose cost does not sacrifice the card, read line by line with string
 *  searches: a regex over the cost ran in polynomial time on hostile text (CodeQL). */
function tapsForMana(oracleText: string): boolean {
  return oracleText.split("\n").some((line) => {
    const colon = line.indexOf(":");
    if (colon < 0) return false;
    const cost = line.slice(0, colon).toLowerCase();
    return cost.includes("{t}") && !cost.includes("sacrifice") && /^\s*add\b/i.test(line.slice(colon + 1));
  });
}

/** THE SOURCES OF EACH COLOUR, COUNTED THE WAY THE GOLDFISH COULD USE THEM: a land by what it taps
 *  for, a fetch by what it can find, and a nonland permanent only when it has a `{T}: Add` ability
 *  that does not sacrifice it. The library only: a commander is never drawn.
 *
 *  NOT `manaAudit`'s `supplied`, deliberately. That counts every permanent whose `producedMana` names
 *  the colour, and its own documentation names the cost: conditional production counts the same as a
 *  basic. Measured on the 268 decks, it read Amarant's red at 38 sources against 26 here (Birgi,
 *  Urabrask and The Great Work add red only on a trigger), and as the input to `colourMiss` it
 *  explained 54% of what the goldfish measured against 71% for this count, falling apart when fitted
 *  on the precons and tested on the calibration decks. The coefficient is only valid against the
 *  count it was fitted on. */
export function colourSources(deck: readonly DeckCard[], commanderNames: readonly string[] = []): Map<Color, number> {
  const commanders = new Set(commanderNames);
  const library = deck.filter((dc) => !commanders.has(dc.card.name));
  const libraryCards = library.map((dc) => dc.card);
  const out = new Map<Color, number>(COLORS.map((c) => [c, 0]));
  for (const dc of library) {
    const text = dc.card.oracleText ?? "";
    const produced = dc.card.producedMana ?? [];
    let colours: readonly string[] = [];
    if (isLand(dc)) {
      colours = produced.length > 0 || !isLandFetch(text)
        ? produced
        : [...new Set(fetchableLands(text, libraryCards).flatMap((c) => c.producedMana ?? []))];
    } else if (isManaSource(dc) && tapsForMana(text)) {
      colours = produced;
    }
    for (const c of new Set(colours)) if (out.has(c as Color)) out.set(c as Color, out.get(c as Color)! + 1);
  }
  return out;
}

/** THE CARDS WHOSE COLOURS ARE MISSING ON THEIR OWN TURN, expected: for every nonland in the deck
 *  and every commander, the chance that the sources of some colour it asks for are not there by the
 *  turn its mana value names, summed over the deck.
 *
 *  The same draw model the colour audit uses (`seen(turn)` cards from a 99-card library), over
 *  `colourSources`. Colours are multiplied as if independent, which they are not
 *  quite; the coefficient in `MANA_BASE_COST` was fitted on this exact figure. A hybrid pip is
 *  charged to its better-supplied colour, since that is the one a player pays it with. */
export function colourMiss(deck: readonly DeckCard[], supplied: ReadonlyMap<Color, number>): number {
  let total = 0;
  for (const dc of deck) {
    if (isLand(dc)) continue;
    const pips = pipOptions(castableManaCost(dc.card));
    if (pips.length === 0) continue;
    const need = new Map<Color, number>();
    for (const options of pips) {
      const best = options.reduce((a, b) => ((supplied.get(b) ?? 0) > (supplied.get(a) ?? 0) ? b : a));
      need.set(best, (need.get(best) ?? 0) + 1);
    }
    const turn = Math.max(1, Math.round(dc.card.manaValue));
    let ok = 1;
    for (const [colour, pipsOf] of need) ok *= pAtLeast(pipsOf, Math.min(99, supplied.get(colour) ?? 0), seen(turn));
    total += 1 - ok;
  }
  return total;
}

/** Lands that enter tapped whatever the board: the plain tapped clause, a clause the classifier
 *  could not read (counted tapped there too), and a fetch whose land arrives tapped. A check land or
 *  a shock is untapped when it matters, and the goldfish played it that way.
 *
 *  A FETCH THAT TAPS FOR MANA ITSELF IS NOT ONE: the Landscape cycle adds {C} untapped and only
 *  sacrifices for a tapped basic when the colour is worth the turn, so the goldfish played it as an
 *  untapped land (measured: ten of them made a five-colour deck read 11 tapped lands, not 1). */
export function tappedLandCount(deck: readonly DeckCard[], commanderNames: readonly string[] = []): number {
  const commanders = new Set(commanderNames);
  return deck.filter((dc) => {
    if (commanders.has(dc.card.name) || !isLand(dc)) return false;
    const template = classifyLand(dc.card).template;
    if (template === "unconditional" || template === "unclassified") return true;
    const text = dc.card.oracleText ?? "";
    return (dc.card.producedMana ?? []).length === 0 && isLandFetch(text) && fetchedLandEntersTapped(text, 3);
  }).length;
}

export interface ManaBaseScore {
  /** The land count this deck's curve, commander and acceleration ask for (`landTarget`). */
  target: number;
  /** Lands the deck runs, MDFCs included. */
  actual: number;
  /** Lost turns per ten turns each part of the mana base costs, against a perfect one of the same deck. */
  costs: { count: number; colour: number; tapped: number };
  /** Their sum: the mana base's one quality number. 0 is a perfect mana base; the 268 decks run
   *  0.1-2.9, a median of 0.76 and 1.37 at the 90th percentile. */
  total: number;
  /** The expected number of cards whose colours are missing on their own turn (`colourMiss`). */
  colourMiss: number;
  /** Lands that always enter tapped (`tappedLandCount`). */
  tappedLands: number;
}

const round2 = (x: number): number => Math.round(x * 100) / 100;

/** The whole mana base, scored in lost turns: the land count against its target, the colours
 *  against `colourSources`, and the tapped lands. */
export function manaBaseScore(
  deck: readonly DeckCard[],
  land: { target: number; actual: number },
  commanderNames: readonly string[] = [],
): ManaBaseScore {
  const delta = land.actual - land.target;
  const count = delta < 0 ? MANA_BASE_COST.short * delta * delta : MANA_BASE_COST.over * delta * delta;
  const miss = colourMiss(deck, colourSources(deck, commanderNames));
  const tappedLands = tappedLandCount(deck, commanderNames);
  const costs = {
    count: round2(count),
    colour: round2(MANA_BASE_COST.colourMiss * miss),
    tapped: round2(MANA_BASE_COST.tapped * tappedLands),
  };
  return {
    target: land.target,
    actual: land.actual,
    costs,
    total: round2(costs.count + costs.colour + costs.tapped),
    colourMiss: round2(miss),
    tappedLands,
  };
}
