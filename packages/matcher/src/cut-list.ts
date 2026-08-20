/** THE CUT LIST — "I'm at 104 cards, which 4 go?"
 *
 *  The most-asked deckbuilding question, and every input already existed on the report: a
 *  deck-relative `synergyRating`, an `axisWeight` saying whether the card's best edge sits on the
 *  deck's own strategy axis, the functional BUILD roles it fills, and the per-category count vs
 *  target. This module is a JOIN over those, not new analysis.
 *
 *  IT NAMES CANDIDATES AND NEVER DECIDES. Three of the four inputs have a known failure direction:
 *
 *  - **A missing edge looks like a useless card.** Derivation covers the corpus unevenly (a deck
 *    outside the 71 calibration decks is only partly covered), and whole relations are still
 *    inexpressible -- "my tutor can find you" is the largest one. `isolated-cards.ts` has always
 *    reported its own figure as an UPPER BOUND for this reason.
 *  - **A FUNCTIONAL ROLE PROTECTS A CARD OUTRIGHT, and measuring is what forced that.** The first
 *    cut let a card through when every role it fills sat in a category ALREADY OVER TARGET -- and
 *    the 71-deck run promptly flagged **Sol Ring, Arcane Signet, Dark Ritual and Cabal Ritual**,
 *    because `burakos-crashing-the-party` runs ramp 14/10 and the build layer counts a category's
 *    members without ranking them. Nothing in this repo models card quality, so "your ramp is over
 *    target" cannot become "cut this rock" -- the surplus is real, the attribution is invented.
 *    Any card with a build role is now protected, and the surplus is reported at DECK level
 *    (`slack`) where it is true: "ramp 14/10" names the category, never a member.
 *  - **A rating is deck-relative** (`score / deckMax`), so "low" means low FOR THIS DECK. In a deck
 *    with one enormous engine piece, ordinary good cards rate low.
 *
 *  Hence every row carries its own reasons in plain words, so the player checks the argument rather
 *  than the verdict. A cut list that printed "cut these" would be exactly the confident wrong
 *  answer this engine refuses everywhere else.
 *
 *  Excluded outright, never candidates: cards carrying a `ROLE_NOT_SYNERGY` effect kind (they are
 *  edge-free by design, not by weakness), lands (the mana base is not a synergy question -- that is
 *  `land-count.ts`), commanders (not cuttable), and combo pieces (a two-card combo is the plan, and
 *  the halves rate low precisely because a combo is not a mesh of edges). */

/** How strongly a card's best edge must sit on the deck's axis to count as on-theme. The same
 *  0.25 the double-duty gate uses in `analyze.ts`, and the same reason: below it the edge exists
 *  but points somewhere the deck is not going. */
export const CUT_AXIS_MAX = 0.25;

/** Deck-relative rating at or below which a card reads as "doing little here". 1.0 of 5 is a fifth
 *  of the deck's best engine piece. MEASURED across the 71 calibration decks before it was chosen:
 *  at 0.5 the median deck yields 4 candidates, at 1.0 it yields 11, at 1.5 it yields 19 -- and 19
 *  is a fifth of the deck, which is a different (and unanswerable) question than "which 4 go". */
export const CUT_RATING_MAX = 1.0;

export interface CutInput {
  name: string;
  /** 0-5, deck-relative. */
  rating: number;
  /** 0-1: how far the card's best synergy edge sits on the deck's axis. */
  axisWeight: number;
  /** How many distinct cards it relates to at all. */
  partnerCount: number;
  /** The card's printed mana value. Read as a TIEBREAK only, never as a gate — nothing in this
   *  repo models card quality, so "expensive" is not "bad". Two cards the engine cannot connect are
   *  different cut candidates when one costs 9 and the other 1, and that is the whole claim. */
  manaValue: number;
  /** Functional BUILD roles it fills ("ramp", "draw", ...); empty when it fills none. */
  roles: readonly string[];
  /** The card carries an effect kind the matcher classes as a DECK ROLE rather than a pairwise
   *  claim (`ROLE_NOT_SYNERGY`: cost-reduction, tax, win-game, extra-turn, extra-phase). Such a
   *  card forms no edge BY DESIGN, so its zero partner count says nothing about it. */
  fillsDeckRole: boolean;
  isLand: boolean;
  isCommander: boolean;
  isComboPiece: boolean;
  /** DEMANDS THE DECK CANNOT MEET, already humanised ("planeswalkers entering"). An intervening-if
   *  condition names something the deck must provide — "if a creature died this turn", "if a
   *  planeswalker entered under your control" — and a deck that provides none makes the card dead
   *  text. Measured across the 71 decks: 33 card-slots carry a checkable condition and ONE is
   *  unsatisfiable, `braids-mono-black-enchantress` running Oath of Liliana with zero planeswalkers.
   *
   *  A REASON, NEVER A GATE. It is evidence the card is doing nothing, and it joins the other three
   *  clauses rather than admitting a row on its own — the same discipline the rest of this module
   *  keeps, because the engine reads conditions from a CLOSED MAP of four shapes and a card whose
   *  condition it cannot read reports nothing at all. */
  unmetConditions?: readonly string[];
}

export interface CutCandidate {
  name: string;
  rating: number;
  /** How many distinct cards relate to it at all. 0 is the strongest signal on this list. */
  partners: number;
  /** Printed mana value, carried so the reader can see what a row costs. See `CutInput`. */
  manaValue: number;
  /** Plain-language why, one clause per condition that fired. Always three. */
  reasons: string[];
}

/** Categories the deck carries MORE of than its (archetype-adjusted) target, biggest surplus
 *  first. This is where a deck has room, stated at the level the engine can actually defend: it
 *  names the category and never a member, because nothing here ranks two ramp cards against each
 *  other. Cutting from a surplus category by `over` cards still leaves the deck at target. */
export function deckSlack(
  categories: readonly { category: string; count: number; target: number }[],
): { category: string; count: number; target: number; over: number }[] {
  return categories
    // LANDS ARE NOT A SURPLUS CATEGORY, and printing them here put two land verdicts on one screen
    // saying opposite things: this chip read "lands 37/36 (+1)" — one land OVER a flat convention —
    // while `land-count.ts`'s own block 400px below read "34 in deck … wants 35", one land SHORT of
    // a target derived from the deck's own curve and acceleration. Both are right about different
    // questions and neither cross-references the other, which reads as a broken report (the E4
    // defect, one layer up: two readouts sharing a number). The Karsten block is the land verdict,
    // so this one goes rather than being annotated.
    .filter((c) => c.category !== "lands")
    .filter((c) => c.target > 0 && c.count > c.target)
    .map((c) => ({ ...c, over: c.count - c.target }))
    .sort((a, b) => b.over - a.over || a.category.localeCompare(b.category));
}

/** Cards the deck is not using, weakest first. Never more than `limit` rows -- the question is
 *  "which few go", and a 30-row list is the same as no list. */
export function cutCandidates(cards: readonly CutInput[], limit = 12): CutCandidate[] {
  const out: CutCandidate[] = [];
  for (const c of cards) {
    if (c.isLand || c.isCommander || c.isComboPiece) continue;
    // A functional role protects the card outright -- see the header. This is the gate that keeps
    // Sol Ring off the list.
    if (c.roles.length > 0) continue;
    // AND SO DOES A DECK ROLE, for a reason the engine states itself. `ROLE_NOT_SYNERGY` (cost
    // reduction, tax, win-game, extra turn/phase) forms no edge ON PURPOSE -- "Sapphire Medallion
    // in mono-red does nothing" is a deck-construction fact a pairwise claim cannot carry. So a
    // Jet Medallion reads 0 partners BY CONSTRUCTION, and the first 71-deck run duly flagged it.
    // Reading a deliberate silence as evidence of uselessness is the worst mistake this list can
    // make, because the silence is the engine's own.
    if (c.fillsDeckRole) continue;
    if (c.rating > CUT_RATING_MAX) continue;
    if (c.axisWeight >= CUT_AXIS_MAX) continue;

    const reasons: string[] = [];
    reasons.push(
      c.partnerCount === 0
        ? "nothing in the deck connects to it"
        : `only ${c.partnerCount} card${c.partnerCount === 1 ? " connects" : "s connect"} to it`,
    );
    reasons.push(
      c.axisWeight === 0
        ? "no edge on your main theme"
        : "its edges point away from your main theme",
    );
    reasons.push("fills none of the functional roles the deck is measured on");
    for (const want of c.unmetConditions ?? []) {
      reasons.push(`its condition needs ${want}, and nothing in the deck provides that`);
    }
    out.push({ name: c.name, rating: c.rating, partners: c.partnerCount, manaValue: c.manaValue, reasons });
  }
  // Weakest first; ties by fewest partners, then by the MOST EXPENSIVE — a 9-drop the deck cannot
  // connect costs a turn to play as well as a slot to hold, which a 1-drop does not, and that is
  // the only sense in which cost belongs on this list. It breaks ties and never admits a row:
  // membership is decided entirely above, and mana value is not one of the gates (measured: 0
  // candidates changed across the 71 decks). Name last, so the order is stable across runs.
  out.sort((a, b) =>
    a.rating - b.rating || a.partners - b.partners
    || b.manaValue - a.manaValue || a.name.localeCompare(b.name));
  return out.slice(0, limit);
}


/** ONE ROW OF TRIM MODE. Same weakness clauses the cut list prints, plus what argues the card
 *  STAYS — so the reader is handed a trade rather than a verdict. */
export interface TrimRow {
  name: string;
  rating: number;
  partners: number;
  manaValue: number;
  /** Why it is weak, in plain words. Same clauses `cutCandidates` writes, plus the surplus note. */
  reasons: string[];
  /** What argues AGAINST cutting it. EMPTY on a card the passive cut list would already name. */
  protections: string[];
}

/** TRIM MODE — "I'm 5 over, what goes?"
 *
 *  `cutCandidates` answers a different question: it FILTERS, so it returns 0-12 rows and is empty on
 *  a tight deck, which is the right answer to "is anything here doing nothing" and no answer at all
 *  to "I must cut five". This ranks EVERY cuttable card weakest-first and always has an Nth row.
 *
 *  **THE SURPLUS IS USED HERE AND REFUSED THERE, deliberately.** The passive list will not let a
 *  category surplus make a member a candidate — the Sol Ring lesson: nothing in this repo ranks two
 *  ramp cards against each other, so "your ramp is over target" cannot become "cut this rock". But a
 *  caller who has ASKED for five rows is getting five, and refusing the surplus would rank a
 *  surplus-category ramp rock exactly level with an under-target draw spell, which is worse advice
 *  than saying so. A role in an over-target category therefore does not PROTECT — it is reported as
 *  a reason, naming the category and its counts — while the order among cards sharing that category
 *  is still decided by rating, partners and cost, never by any judgement of card quality. So this
 *  never says "cut Sol Ring rather than Arcane Signet"; it says "these are your least-connected
 *  cards and here is what each one is doing".
 *
 *  Lands and commanders are out of the universe entirely: a land is `land-count.ts`'s question and a
 *  commander is not cuttable. Everything else appears, protections attached. */
export function trimOrder(
  cards: readonly CutInput[],
  categories: readonly { category: string; count: number; target: number }[] = [],
): TrimRow[] {
  const surplus = new Map(deckSlack(categories).map((s) => [s.category, s]));
  const rows: TrimRow[] = [];
  for (const c of cards) {
    if (c.isLand || c.isCommander) continue;
    const reasons: string[] = [];
    const protections: string[] = [];

    reasons.push(
      c.partnerCount === 0
        ? "nothing in the deck connects to it"
        : `only ${c.partnerCount} card${c.partnerCount === 1 ? " connects" : "s connect"} to it`,
    );
    if (c.axisWeight < CUT_AXIS_MAX) {
      reasons.push(c.axisWeight === 0 ? "no edge on your main theme" : "its edges point away from your main theme");
    } else {
      protections.push("its best edge is on your main theme");
    }
    if (c.rating > CUT_RATING_MAX) protections.push(`rates ${c.rating.toFixed(1)} of 5 in this deck`);

    // A ROLE ALWAYS PROTECTS, and the FIRST CUT OF THIS FUNCTION PROVED WHY — measured, not argued.
    // Letting an over-target category strip the protection made `burakos-crashing-the-party`'s top
    // five rows its ENTIRE RAMP PACKAGE — Honor-Worn Shaku, Arcane Signet, Dark Ritual, Sol Ring,
    // Springleaf Drum — all rated 0.0, all tied, their order decided by mana value. That is the Sol
    // Ring failure this module's header already records, rebuilt one layer up: the deck really is
    // ramp 16/10, and "cut five ramp cards" is arithmetic the engine can defend, but "cut THESE
    // five" is an attribution it cannot, because nothing here ranks two ramp cards against each
    // other.
    //
    // So the surplus rides on the protection TEXT instead of removing the protection. A role-filler
    // still sorts behind every card with no role at all, and the reader is told where the deck has
    // room — which is the same sentence `slack` prints at deck level, attached to a row rather than
    // substituted for one.
    const over = c.roles.filter((r) => surplus.has(r));
    if (c.roles.length > 0) {
      const room = over
        .map((r) => { const s = surplus.get(r)!; return `${r} is at ${s.count} against a target of ${s.target}`; })
        .join(", ");
      protections.push(room ? `fills ${c.roles.join(", ")} — ${room}, so there is room here` : `fills ${c.roles.join(", ")}`);
    }
    if (c.roles.length === 0) reasons.push("fills none of the functional roles the deck is measured on");
    // The sharpest row this list can print: not "nothing connects to it" but "the card's own text
    // asks for something you do not run".
    for (const want of c.unmetConditions ?? []) {
      reasons.push(`its condition needs ${want}, and nothing in the deck provides that`);
    }

    if (c.isComboPiece) protections.push("half of a combo the deck assembles");
    // A deck role forms no edge BY DESIGN, so its low partner count is the engine's own silence and
    // not evidence about the card. Same protection the passive list gives it.
    if (c.fillsDeckRole) protections.push("does its work without forming edges (cost reduction, tax and friends)");

    rows.push({ name: c.name, rating: c.rating, partners: c.partnerCount, manaValue: c.manaValue, reasons, protections });
  }
  // Least protected first, then the same weakest-first key the cut list uses. Name last, so the
  // order is stable across runs.
  rows.sort((a, b) =>
    a.protections.length - b.protections.length
    || a.rating - b.rating || a.partners - b.partners
    || b.manaValue - a.manaValue || a.name.localeCompare(b.name));
  return rows;
}
