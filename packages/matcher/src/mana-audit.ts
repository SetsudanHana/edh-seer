import { minCopies } from "@edh-seer/engine";
import { castableManaCost } from "./split-cost.js";
import { minSources } from "./mulligan.js";
import { classifyLand, entersTapped } from "./land-conditions.js";
import { fetchableLands, fetchedLandEntersTapped, isLandFetch } from "./fetch-land.js";
import { fixedColours } from "./mana-lines.js";
import { fixerCredit, libraryFixers } from "./static-fixers.js";
import type { DeckCard } from "./types.js";
import { BASIC_LAND_TYPES } from "./typeline.js";

/** The five colours, in WUBRG order. Colourless is deliberately absent HERE, and the reason the old
 *  one gave was false as a statement of the rules: "every deck can pay generic and colourless costs
 *  from any source" is true of GENERIC and false of COLOURLESS — `{C}` is payable only with
 *  colourless mana (CR 107.4c), which `goldfish.ts` now models as a sixth mask bit (roadmap N11).
 *
 *  What is true is narrower: THIS table counts COLOURED SOURCES against Karsten's published
 *  thresholds, and those thresholds are about coloured pips. A sixth entry would change what the
 *  table counts rather than correct it, so the feasibility question is asked one module over, where
 *  a board is available to ask it of. */
export const COLORS = ["W", "U", "B", "R", "G"] as const;
export type Color = (typeof COLORS)[number];

/** The confidence a coloured source count is held to. 90% is the external spec's own figure and the
 *  one its reference table is computed at, so a different value here would quietly invalidate every
 *  number that table anchors. */
export const SOURCE_CONFIDENCE = 0.9;

/** The five basic land types, lowercased, as `classifyLand` reports them in `subtypes`. */
const EMPTY_TYPES: ReadonlySet<string> = new Set<string>();

/** THE BASIC LAND TYPES THE DECK'S OWN LANDS CARRY, lowercased to match `classifyLand`'s subtypes. A
 *  check land ("unless you control a Mountain") is satisfiable only if the deck runs something with
 *  that type at all, so this is the ceiling on the optimistic board below. */
export function deckBasicTypes(library: readonly DeckCard[]): Set<string> {
  const out = new Set<string>();
  for (const dc of library) {
    if (!/\bland\b/i.test(dc.card.typeLine)) continue;
    for (const t of BASIC_LAND_TYPES) if (dc.card.typeLine.toLowerCase().includes(t)) out.add(t);
  }
  return out;
}

/** WOULD THE AUDIT COUNT THIS LAND AS TAPPING FOR MANA ON TURN `turn`? The one test `manaAudit`'s
 *  availability uses, on its optimistic board (every earlier land drop was the one a condition
 *  wanted; empty on turn 1), exported so naming a land to trade and counting it as a source can never
 *  disagree. A fetch's own land arrives on the same clock. */
export function landOnlineBy(dc: DeckCard, turn: number, basicTypes: ReadonlySet<string>): boolean {
  const board = {
    lands: turn - 1,
    basics: turn - 1,
    types: turn > 1 ? basicTypes : EMPTY_TYPES,
    opponents: 3,
  };
  if (entersTapped(classifyLand(dc.card), board)) return false;
  // WHAT IS STANDING THERE IS THE FETCHED LAND, and `classifyLand` cannot see it: Evolving Wilds
  // enters untapped and the basic it finds does not. Same board the simulator reads.
  const text = dc.card.oracleText ?? "";
  return !isLandFetch(text) || !fetchedLandEntersTapped(text, board.lands);
}

const produces = (card: { producedMana?: readonly string[] }, color: Color | "C"): boolean =>
  (card.producedMana ?? []).includes(color);

/** Coloured pips per colour in a mana cost, e.g. `{2}{B}{B}` -> `{ B: 2 }`.
 *
 *  Generic (`{2}`), `{X}` and `{C}` are not pips: they say nothing about which colours the deck has
 *  to produce, which is the only question here.
 *
 *  HYBRID AND PHYREXIAN COUNT FOR EACH COLOUR THEY NAME. `{B/R}` is a demand on black and on red,
 *  which OVERSTATES both -- either half satisfies the card, so a deck that can produce only one of
 *  them is fine. Deliberate: the alternative is to silently drop the demand, and a card that needs
 *  one of two colours still needs the deck to produce at least one. Read a hybrid row as an upper
 *  bound. */
export function pipsByColor(manaCost: string | undefined): Partial<Record<Color, number>> {
  const out: Partial<Record<Color, number>> = {};
  if (!manaCost) return out;
  for (const symbol of manaCost.match(/\{[^{}]+\}/g) ?? []) {
    const inner = symbol.slice(1, -1).toUpperCase();
    // `{2/B}` (monocolour hybrid) and `{B/P}` (Phyrexian) both reach the colour they name; a plain
    // `{X}`, `{C}` or a number reaches none.
    for (const color of COLORS) {
      if (inner.split("/").includes(color)) out[color] = (out[color] ?? 0) + 1;
    }
  }
  return out;
}

/** A card whose mana you can still be holding: everything except a one-shot spell.
 *
 *  A ritual adds mana ONCE, on resolution, and is then gone. Counting it as a source claims you can
 *  hold it to a 90% confidence, which is the one thing it can never do -- and it made the two
 *  castability axes count different universes, the mana axis lands-only and the colour axis every
 *  `producedMana` card including Dark Ritual. Definitional, not probabilistic: a one-shot is not a
 *  source at any confidence.
 *
 *  A permanent type anywhere on the type line wins, so an "Instant // Land" modal DFC still counts
 *  -- `typeLine` is the union of the faces (`splitTypeLine`), and the land half is a real source. */
export const isManaSource = (dc: DeckCard): boolean =>
  !/\b(instant|sorcery)\b/i.test(dc.card.typeLine)
  || /\b(artifact|creature|enchantment|land)\b/i.test(dc.card.typeLine);

/** One "N cards want this many pips by this turn" demand, and whether the deck supplies it. */
export interface ColorDemand {
  pips: number;
  /** The deadline: the card's own mana value. You want to cast a 3-drop on turn 3, which is a
   *  defensible assumption rather than a fitted parameter -- and it is the one place the spec's
   *  per-card idea kills a Tier C guess outright. */
  turn: number;
  /** Sources needed for `SOURCE_CONFIDENCE` of having `pips` of them by `turn`, WITH the free
   *  mulligan priced in (`mulligan.ts`). An UPPER BOUND on the mulligan's help: the keep band reads
   *  a hand's LAND count and this applies it to one colour, which a real player does not do. */
  required: number;
  /** The same figure with NO mulligan at all -- what this field held until 2026-08-25, and the other
   *  end of the interval. It UNDER-states by the same keep-rule mismatch `required` over-states by,
   *  so the truth sits between them and neither is deleted (roadmap L5, spec §11).
   *
   *  Absent only when no source count in the deck reaches the confidence raw, which cannot happen
   *  for a demand a real card presents. */
  requiredRaw: number;
  /** How many cards in the deck carry exactly this demand. */
  cards: number;
  /** WHICH cards, so a reader can check the claim against a card they can hold. A count alone made
   *  the finding a statement about the mana base ("Blue is short"), which is the wrong subject and
   *  read as absurd on a mono-colour deck; the true subject is one early multi-pip spell. */
  names: string[];
  /** THE SOURCES THAT COULD ACTUALLY BE PRODUCING BY `turn`, which is the number `met` is read
   *  against. `supplied` on the row is every source in the deck and is a true DECK fact; holding a
   *  turn-1 demand to it counted mana rocks that cost two and lands that enter tapped exactly then.
   *  Never greater than `supplied`. */
  available: number;
  /** `available >= required`. Read against `required` rather than `requiredRaw`, so the report
   *  UNDER-claims a shortfall rather than over-claiming one: anchoring on `requiredRaw` instead told
   *  62 of the 71 calibration decks they were short by a median of ten sources, off a model measured
   *  to over-state by up to fourteen. */
  met: boolean;
  /** THE STATIC FIXERS THAT RAISED `available` (#1115): Chromatic Lantern, Prismatic Omen, Urborg, Chromatic
   *  Orrery... Absent when none was out by `turn` or none changed the count. */
  fixedBy?: string[];
}

export interface ManaAuditRow {
  color: Color;
  /** Cards in the LIBRARY that can produce this colour, on ANY turn. Excludes commanders:
   *  `required` is computed against a library that does not contain them either.
   *
   *  A DECK FACT, AND THE WRONG NUMBER TO HOLD AN EARLY DEMAND TO -- see `ColorDemand.available`,
   *  which is what `met` reads. */
  supplied: number;
  demands: ColorDemand[];
  /** The demand that misses by the most sources, absent when every demand is met -- or when the
   *  deck's EVERY mana source, of any colour, could not meet it either (#680): that shortfall is the
   *  land count's, not this colour's. This is the row worth showing: "your double-black is a turn 5
   *  spell in practice". */
  worst?: ColorDemand;
  /** An unmet demand is left that recolouring could not meet (#680): the land count's question.
   *  Without it a missing `worst` read as "every cost covered", which such a row is not. */
  countBound: boolean;
}

/** Per-card colour feasibility: what each card's own pips demand by its own deadline, against what
 *  the deck can produce. Exact, per deck, Tier A.
 *
 *  This is the thing a land-count regression fundamentally cannot do -- Karsten has no colour term
 *  at all, which is correct for COUNT and silent about COMPOSITION.
 *
 *  TWO OF THE THREE THINGS IT DID NOT MODEL ARE MODELLED NOW, per demand, in `available` (T18b).
 *  They were found because the panel printed *"R, 25 sources, enough"* beside the simulator's *"Curse
 *  of Opulence, turn 1, 40%"* -- one card, one turn, one screen, two models that never met:
 *  - **Tapped lands.** A land that enters tapped is not a source for a demand due the turn it would
 *    arrive. Asked of `land-conditions.ts`, the same classifier the simulator uses, so a slow land
 *    is tapped for a turn-1 demand and untapped for a turn-3 one rather than flatly one or the other.
 *  - **Rocks are sources but not ramp.** A Signet is a source on the turn AFTER it is cast, never on
 *    turn one, and a nonland source now counts only for a demand due later than its own mana value.
 *
 *  ONE REMAINS, and it is the one no turn number fixes:
 *  - **Conditional production.** `producedMana` is what a card CAN add: "any color" lists all five,
 *    and a source gated behind a condition counts the same as a basic.
 *
 *  ONE THING IT NO LONGER GETS WRONG: the requirement is priced WITH the free mulligan. `required`
 *  was `minCopies` alone until 2026-08-25 -- raw hypergeometric, the same model that read 37 lands
 *  as an 80% three-land-drop deck before `mulligan.ts` corrected it to 90.3%. Raw, {C}{C} by turn 2
 *  "needs" 36 sources of 99 and {C}{C}{C} by turn 3 "needs" 44, and 139 of the 71 decks' 153 colour
 *  rows carried an unmet demand off those numbers. Both ends now ship (`required`, `requiredRaw`):
 *  the keep band reads LANDS, so applying it to one colour over-states the mulligan's help exactly
 *  as ignoring it under-states, and the truth is between. Roadmap L5, spec §11.
 *
 *  One thing it does NOT do any more: a one-shot ritual is not a source (`isManaSource`). Measured
 *  over the 71 calibration decks, 139 of 3,197 `producedMana` library cards were one-shots, moving
 *  `supplied` on 103 of 153 colour rows and flipping 59 of 1,250 demands from met to unmet, with 9
 *  colours acquiring a `worst` row they did not report before.
 *
 *  It also says nothing about how many lands to run -- pip density drives composition only. */
export function manaAudit(
  deck: readonly DeckCard[],
  opts: { commanderNames?: readonly string[] } = {},
): ManaAuditRow[] {
  const commanders = new Set(opts.commanderNames ?? []);
  const library = deck.filter((dc) => !commanders.has(dc.card.name));
  const libraryCards = library.map((dc) => dc.card);

  const basicTypes = deckBasicTypes(library);

  const coloredSources = (color: Color): DeckCard[] => {
    // A FETCHLAND PRODUCES THE COLOUR IT FINDS. `producedMana` is empty on a real fetch and that is
    // correct -- Polluted Delta taps for nothing -- so the printed field alone told a MONO-BLUE deck
    // with six fetchlands that blue was short at the top of its curve. The simulator has counted
    // them since N2 (`fetchMask`), which made the colour panel and the goldfish disagree about the
    // same six cards on the same screen: the T18b defect again, one model over.
    //
    // A LAND-FETCH SPELL COUNTS TOO, and is the one place `isManaSource` is deliberately bypassed.
    // That gate refuses instants and sorceries because a RITUAL is a one-shot; Cultivate is not one.
    // It leaves a Forest on the battlefield permanently, which is the whole definition of a source,
    // and `availableBy` already prices the delay the same way it prices a rock.
    // BY WHAT IT FIXES, NOT WHAT IT CAN ADD (owner, 2026-10-08, #1114): a colour only a line that costs more than it
    // makes can produce (Cascading Cataracts, Prismatic Lens) is not a source of it.
    const direct = library.filter((dc) => isManaSource(dc) && fixedColours(dc).includes(color));
    // Asked of the LIBRARY: a commander is not in it (CR 903.6) and cannot be fetched.
    const fetches = library.filter((dc) => !direct.includes(dc)
      && isLandFetch(dc.card.oracleText ?? "")
      && fetchableLands(dc.card.oracleText ?? "", libraryCards).some((c) => produces(c, color)));

    // CAPPED AT WHAT THERE IS TO FIND. Every fetch is a wildcard for its own fetchable set, but the
    // sets overlap and the library is finite: `codie` runs 15 fetches over 5 white-producing lands,
    // so calling all 15 white sources claims ten cards that can never produce white. Measured over
    // the 71 calibration decks the cap binds on 31 of 153 colour rows across 8 decks -- not a
    // degenerate corner, so it is a cap and not a comment. The CHEAPEST fetches survive it: a fetch
    // that is a land beats one that costs {2}, which is the same order `availableBy` prices.
    const reachable = new Set(fetches.flatMap((f) => fetchableLands(f.card.oracleText ?? "", libraryCards)));
    const targets = [...reachable].filter((c) => produces(c, color)).length;
    return [
      ...direct,
      ...[...fetches].sort((a, b) => a.card.manaValue - b.card.manaValue).slice(0, targets),
    ];
  };

  // WHAT COULD BE PRODUCING BY TURN N, for one set of sources, asked once per deadline and cached,
  // because a deck's demands share very few distinct turns.
  //
  // THE BOARD IS THE OPTIMISTIC ONE, deliberately: on turn N you have made N-1 earlier land drops,
  // and this assumes every one of them was the land a conditional wanted. That is the same
  // under-claiming direction `met` already takes with `required` over `requiredRaw` -- the report
  // would rather miss a shortfall than invent one.
  //
  // CEILING: a nonland source counts from the turn after its own mana value, which assumes it was
  // cast on curve. Pricing how often that actually happens needs the simulator, and the simulator
  // is the other half of this pair; a turn number is the cheap half that closes the contradiction.
  const availability = (sources: readonly DeckCard[]) => {
    const availableAt = new Map<number, number>();
    return (turn: number): number => {
      const hit = availableAt.get(turn);
      if (hit !== undefined) return hit;
      const n = sources.filter((dc) => {
        // A rock cast on turn M taps for mana from turn M+1: you spent the turn's mana casting it.
        // A land-fetch SPELL is on that clock too -- Cultivate on turn 3 pays from turn 4. A land is
        // asked `landOnlineBy`; a SPELL's fetch is already on the rock clock, and charging it for the
        // tapped arrival as well made it a source on no turn at all.
        return /\bland\b/i.test(dc.card.typeLine) ? landOnlineBy(dc, turn, basicTypes) : dc.card.manaValue < turn;
      }).length;
      availableAt.set(turn, n);
      return n;
    };
  };

  const sourcesByColor = new Map(COLORS.map((color) => [color, coloredSources(color)]));
  // EVERY SOURCE OF ANY MANA, coloured or not: what the deck could hold of one colour if it
  // recoloured its whole mana base without adding a single card to it.
  const anyAvailableBy = availability([...new Set([
    ...[...sourcesByColor.values()].flat(),
    ...library.filter((dc) => isManaSource(dc) && produces(dc.card, "C")),
  ])]);

  // STATIC COLOUR FIXERS (owner, 2026-10-08, #1115): "after you play cards like Chromatic Lantern your color
  // issues disappear, you are only bounded by the landcount". From the turn a fixer is out, every source it
  // covers makes the colours it grants. It is one or two cards and not every game draws one, so the credit is
  // weighted by P(at least one is seen by the deadline) -- the same `seen` and library `minCopies` prices a turn
  // with -- and FLOORED, the direction this audit under-claims in. The fixer comes out on its own clock: a land
  // when `landOnlineBy` says it taps, a nonland the turn after its mana value (the rock clock above).
  const fixers = libraryFixers(library);
  const fixerOut = (dc: DeckCard, turn: number): boolean =>
    /\bland\b/i.test(dc.card.typeLine) ? landOnlineBy(dc, turn, basicTypes) : dc.card.manaValue < turn;
  const lands = library.filter((dc) => /\bland\b/i.test(dc.card.typeLine));
  const credit = (color: Color, sources: readonly DeckCard[], turn: number, available: number): { extra: number; by: string[] } => {
    if (fixers.length === 0) return { extra: 0, by: [] };
    const have = new Set(sources);
    // WHAT EACH KIND OF FIXER NEWLY REACHES: a land-fixer, the online lands that were not already this colour's
    // source; an all-mana fixer, also every other online source (a rock, a dork).
    const newLands = lands.filter((dc) => !have.has(dc) && landOnlineBy(dc, turn, basicTypes)).length;
    return fixerCredit(fixers, color, turn, fixerOut, newLands, Math.max(0, anyAvailableBy(turn) - available), library.length);
  };

  const rows: ManaAuditRow[] = [];
  for (const color of COLORS) {
    const sources = sourcesByColor.get(color)!;
    const supplied = sources.length;
    const availableBy = availability(sources);
    // Group by (pips, deadline): "12 cards want {B}{B} by T3" is one row, not twelve.
    const groups = new Map<string, ColorDemand>();
    for (const dc of library) {
      // THE SAME SPLIT-CARD FICTION, AND IT SURFACED HERE FIRST. `Dusk // Dawn`'s joined
      // "{2}{W}{W} // {3}{W}{W}" read as a FOUR-white-pip demand on turn nine, which was the entire
      // content of the precon's only colour warning — a requirement for 31 white sources generated
      // by a cost no player pays. Two readers of one string produced the same fiction independently,
      // which is why the correction lives in `split-cost.ts` rather than in either of them.
      const pips = pipsByColor(castableManaCost(dc.card))[color];
      if (!pips) continue;
      // A 0-drop still has to be castable on turn 1 -- there is no turn 0 to draw into.
      const turn = Math.max(1, Math.round(dc.card.manaValue));
      const key = `${pips}:${turn}`;
      const existing = groups.get(key);
      if (existing) {
        existing.cards++;
        existing.names.push(dc.card.name);
        continue;
      }
      const requiredRaw = minCopies(pips, turn, SOURCE_CONFIDENCE, library.length);
      // `minSources` searches a 99-card deck while `minCopies` is told the real library size, so the
      // pair is not perfectly commensurable on a deck that lost cards to resolution -- and the raw
      // figure is the conservative end, so the corrected one is clamped never to exceed it rather
      // than allowed to read HIGHER than the model it corrects (criterion S2).
      const required = Math.min(requiredRaw, minSources(pips, turn, SOURCE_CONFIDENCE) ?? requiredRaw);
      const own = availableBy(turn);
      const { extra, by } = credit(color, sources, turn, own);
      // Never more than the deck's every source (the cap `unmet` below uses), so a credit cannot outrun the land count.
      const available = Math.min(own + extra, Math.max(own, anyAvailableBy(turn)));
      groups.set(key, {
        pips, turn, required, requiredRaw, cards: 1, names: [dc.card.name], available,
        met: available >= required,
        ...(available > own ? { fixedBy: [...new Set(by)] } : {}),
      });
    }
    if (groups.size === 0) continue;

    const demands = [...groups.values()].sort(
      (a, b) => b.pips - a.pips || a.turn - b.turn || b.cards - a.cards,
    );
    // A DEMAND NO RECOLOURING COULD MEET IS THE LAND COUNT'S QUESTION, NOT THE COLOUR'S (#680).
    // Their Number Is Legion wants four black on turn 4, which "takes 49" sources -- in a MONO-BLACK
    // deck where every one of its 42 sources already makes black. No composition answers that; it
    // is how much mana the deck runs, which the land block judges. The same line as the single-pip
    // gate in `findings.ts`: a row is shown only when trading which colours the sources make could
    // close it. `met` still says false, because it is.
    const unmet = demands.filter((d) => !d.met && anyAvailableBy(d.turn) >= d.required);
    rows.push({
      color,
      supplied,
      demands,
      // Ranked by the SHORTFALL, not by pip count: a 2-pip demand met with room to spare matters
      // less than a 1-pip demand the deck misses by ten sources. Each demand's shortfall is read
      // against its OWN `available`, since two demands on one colour no longer share a supply.
      countBound: demands.some((d) => !d.met && !unmet.includes(d)),
      worst: unmet.sort((a, b) => (b.required - b.available) - (a.required - a.available))[0],
    });
  }
  return rows;
}

/** THE DECK-WIDE COLOUR SHORTFALL (owner, 2026-10-08, #966): per colour, how many more sources the
 *  worst unmet demand needs than all the deck's sources (lands, rocks, dorks, fetchables) supply by
 *  its deadline. Only colours with a shortfall appear. A mana-source swap is good when it closes one;
 *  a source's own colour count is not the measure. */
export function colourDeficit(deck: readonly DeckCard[], commanderNames: readonly string[] = []): Partial<Record<Color, number>> {
  const out: Partial<Record<Color, number>> = {};
  for (const row of manaAudit(deck, { commanderNames })) {
    const gap = row.worst ? row.worst.required - row.worst.available : 0;
    if (gap > 0) out[row.color] = gap;
  }
  return out;
}

/** THE DEMAND AN "ENCHANT FOREST" AURA MAKES (owner, 2026-10-08): one source of that land type by the
 *  Aura's turn, priced like a colour pip -- the same mulligan-corrected requirement `manaAudit` asks of
 *  `{G}` on that turn -- against the lands the deck has of the type, counted as the audit counts a colour's
 *  sources: lands carrying the type that are online by the turn, plus the fetches that can find one,
 *  capped at what there is to find. Returns both figures; the caller compares. */
export function landTypeDemand(deck: readonly DeckCard[], commanderNames: readonly string[], landType: string, turn: number): { required: number; available: number } {
  const commanders = new Set(commanderNames);
  const library = deck.filter((dc) => !commanders.has(dc.card.name));
  const libraryCards = library.map((dc) => dc.card);
  const has = (c: { typeLine: string }) => /\bland\b/i.test(c.typeLine) && c.typeLine.toLowerCase().includes(landType);
  const types = deckBasicTypes(library);
  const direct = library.filter((dc) => has(dc.card));
  const fetches = library.filter((dc) => !direct.includes(dc) && isLandFetch(dc.card.oracleText ?? "")
    && fetchableLands(dc.card.oracleText ?? "", libraryCards).some(has));
  const reachable = new Set(fetches.flatMap((f) => fetchableLands(f.card.oracleText ?? "", libraryCards)));
  const targets = [...reachable].filter(has).length;
  const sources = [...direct, ...[...fetches].sort((a, b) => a.card.manaValue - b.card.manaValue).slice(0, targets)];
  const available = sources.filter((dc) => (/\bland\b/i.test(dc.card.typeLine) ? landOnlineBy(dc, turn, types) : dc.card.manaValue < turn)).length;
  const requiredRaw = minCopies(1, turn, SOURCE_CONFIDENCE, library.length);
  return { required: Math.min(requiredRaw, minSources(1, turn, SOURCE_CONFIDENCE) ?? requiredRaw), available };
}
