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
  /** The physical card this row's face belongs to ("Fell the Profane // Fell Mire"), present only
   *  when `name` is one face of a multi-face card. See `mergeFaces` -- a reader cuts the CARD, not
   *  a face, so two rows sharing a `cardName` collapse to one before anything is proposed. */
  cardName?: string;
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
  /** THE ENGINE READ THIS CARD'S ORACLE TEXT. False when the card resolved but carries no derived
   *  tags, which is a DIFFERENT fact from "nothing connects to it" and the one this list must not
   *  confuse with it. An underived card forms no edge BY CONSTRUCTION — the same reason
   *  `fillsDeckRole` protects a Jet Medallion, arriving from the corpus rather than from the rules.
   *
   *  MEASURED 2026-08-27 on `precon-party-time`: **12 of 12 cut candidates were cards the engine
   *  had never read**, so every row of the shipped list was the corpus's own gap wearing the
   *  clothes of a dead card. Reading a deliberate silence as evidence of uselessness is the worst
   *  mistake this list can make, and this was the largest source of it. */
  derived: boolean;
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

/** A PARENT row, the shape `computeBuild` reports as `BuildResult.buildParents` -- the same
 *  interface repeated here (not imported) because `cut-list.ts`, like `build.ts` itself, must not
 *  create a circular dependency; the two are kept structurally identical on purpose. */
export interface SlackParent { name: string; count: number; target: number; leaves: readonly string[] }

/** Groups the deck carries MORE of than their (archetype-adjusted) PARENT target, biggest surplus
 *  first. This is where a deck has room, stated at the level the engine can actually defend: it
 *  names the PARENT and never a member, because nothing here ranks two ramp cards against each
 *  other. Cutting from a surplus group by `over` cards still leaves the deck at target.
 *
 *  FIX F2 (controller review, 2026-08-21): this used to read LEAF `buildCategories`, but Task 7
 *  moved every leaf's target to 0 -- a leaf's own `target > 0` filter can now never pass, so a real
 *  surplus (Interaction running 18 against a floor of 10) went silently unreported. `deckSlack`
 *  exists BECAUSE of a recorded defect (Sol Ring, Arcane Signet and Dark Ritual all named as cut
 *  candidates in a deck running ramp 16/10) whose fix was exactly this sentence at deck level, so
 *  losing it silently would be the same defect returning. Reads `buildParents` now; `lands` needs
 *  no exclusion any more because it was never a `BUILD_PARENTS` member to begin with. */
export function deckSlack(
  parents: readonly SlackParent[],
): { category: string; count: number; target: number; over: number }[] {
  return parents
    .filter((p) => p.target > 0 && p.count > p.target)
    // `category` is the field name every reader of `report.slack` already expects
    // (`CutList.tsx`'s `BUILD_CATEGORY_LABEL[s.category] ?? s.category`); a parent's NAME
    // ("Interaction", "Board wipes") is already plain English, so the same fallback renders it
    // correctly with no client change.
    .map((p) => ({ category: p.name, count: p.count, target: p.target, over: p.count - p.target }))
    .sort((a, b) => b.over - a.over || a.category.localeCompare(b.category));
}

/** THE DECK'S OWN MIDDLE, because a partner count means nothing absolute: 38 partners is isolation
 *  in a deck whose median is 60 and the opposite in a deck whose median is 7. Taken over the
 *  cuttable universe — lands and commanders are not candidates, so counting them would drag the
 *  middle down and make everything look well connected. */
function medianPartnerCount(cards: readonly CutInput[]): number | null {
  const counts = cards
    .filter((c) => !c.isLand && !c.isCommander)
    .map((c) => c.partnerCount)
    .sort((a, b) => a - b);
  // NULL BELOW A HANDFUL OF CARDS, because "better connected than half the deck" is not a sentence
  // about a three-card list — with one cuttable card the median IS that card, so it would be called
  // well connected on the strength of its own single edge. No comparison available means the row
  // falls back to the plain wording rather than inventing a middle.
  return counts.length >= 4 ? counts[Math.floor(counts.length / 2)]! : null;
}

/** How a row states its connectedness.
 *
 *  "ONLY" IS A CLAIM AND IT USED TO FIRE UNCONDITIONALLY. Measured across the 71 calibration decks,
 *  **2,955 trim rows said "only N cards connect to it" about a card better connected than half its
 *  own deck** — Herald's Horn at 38 partners in a deck whose median is 7, i.e. the deck's tribal
 *  cost-reducer described as isolated. A well-connected card can still be the right cut; what was
 *  false is the REASON given, and the honest one is that nothing it touches is worth much here. */
function connectionReason(partnerCount: number, median: number | null): string {
  if (partnerCount === 0) return "nothing in the deck connects to it";
  // AT the median counts as well connected: "only 7 cards connect to it" is a false emphasis in a
  // deck whose typical card has exactly 7, which is where 1,061 of the misdescribed rows sat when
  // this was first written as a strict comparison.
  if (median !== null && partnerCount >= median) {
    return `${partnerCount} cards connect to it, but none of those links is strong`;
  }
  return `only ${partnerCount} card${partnerCount === 1 ? " connects" : "s connect"} to it`;
}

/** A CARD IS THE UNIT OF A CUT. A face node is rated on its own -- that is the whole point of faces
 *  as nodes -- but a reader removes a CARD from a sleeve, so the two faces are merged back before
 *  anything is proposed. The merged row takes the STRONGEST face's protections (a role, a combo
 *  slot or a commander designation on either face protects the card, because cutting takes both
 *  away) and the strongest face's numbers, so a card is never proposed on the strength of its
 *  weaker half alone. */
function mergeFaces(rows: readonly CutInput[]): CutInput[] {
  const out = new Map<string, CutInput>();
  for (const r of rows) {
    const key = r.cardName ?? r.name;
    const prev = out.get(key);
    if (!prev) { out.set(key, { ...r, name: key }); continue; }
    out.set(key, {
      ...prev,
      rating: Math.max(prev.rating, r.rating),
      axisWeight: Math.max(prev.axisWeight, r.axisWeight),
      partnerCount: Math.max(prev.partnerCount, r.partnerCount),
      roles: [...new Set([...prev.roles, ...r.roles])],
      isLand: prev.isLand && r.isLand,
      isCommander: prev.isCommander || r.isCommander,
      isComboPiece: prev.isComboPiece || r.isComboPiece,
      fillsDeckRole: prev.fillsDeckRole || r.fillsDeckRole,
      derived: prev.derived || r.derived,
      unmetConditions: [...new Set([...(prev.unmetConditions ?? []), ...(r.unmetConditions ?? [])])],
    });
  }
  return [...out.values()];
}

/** Cards the deck is not using, weakest first. Never more than `limit` rows -- the question is
 *  "which few go", and a 30-row list is the same as no list.
 *
 *  A CARD THE ENGINE NEVER READ IS NOT A CANDIDATE. It is reported separately by `unjudged` below,
 *  because the two sentences differ and only one of them is a reason to cut. */
export function cutCandidates(cards: readonly CutInput[], limit = 12): CutCandidate[] {
  const merged = mergeFaces(cards);
  const median = medianPartnerCount(merged);
  const out: CutCandidate[] = [];
  for (const c of merged) {
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
    // See `CutInput.derived`. Every other gate here refuses a card the engine UNDERSTANDS and has
    // decided against naming; this one refuses a card it never opened.
    if (!c.derived) continue;
    if (c.rating > CUT_RATING_MAX) continue;
    if (c.axisWeight >= CUT_AXIS_MAX) continue;

    const reasons: string[] = [];
    reasons.push(connectionReason(c.partnerCount, median));
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


/** THE CARDS THAT WOULD HAVE BEEN CANDIDATES IF THE ENGINE HAD READ THEM — names only, in the
 *  order the cut list would have ranked them.
 *
 *  It exists so the removal of those rows is VISIBLE rather than silent. A cut list that quietly
 *  shrank from twelve rows to zero tells the reader nothing; one that says "twelve cards look
 *  unconnected and are not judged, here they are" hands them the same twelve with the correct
 *  sentence attached. Capped at the same `limit`, for the same reason.
 *
 *  ONLY THE CARDS THAT WOULD HAVE QUALIFIED, never every underived card: a Sol Ring the engine
 *  cannot read is still protected by its role, and listing it here would re-introduce the defect
 *  `fillsDeckRole` exists to prevent one column over.
 *
 *  MERGED LIKE `cutCandidates`, for the same reason -- a reader cuts a CARD, and a two-faced card
 *  rates two rows (Task 7, faces-as-nodes). Review fix, 2026-08-27: this ran over the raw face rows
 *  and printed BOTH of an unread two-faced card's names, which is also why `CutList.tsx`'s "N of
 *  the M unread cards" line could read "2 of the 1 unread" -- `coverage` counts SLOTS (one) and this
 *  counted face rows (two). `mergeFaces`'s `derived: prev.derived || r.derived` looked like it could
 *  launder a half-read card into "read" here, but it cannot: `derived` is set from
 *  `derivedByName.get(physical)` in analyze.ts, IDENTICAL on both of a card's face rows, so the OR
 *  is a no-op -- both sides already agree. */
export function unjudgedCandidates(cards: readonly CutInput[], limit = 12): string[] {
  const merged = mergeFaces(cards);
  const out = merged.filter(
    (c) => !c.derived && !c.isLand && !c.isCommander && !c.isComboPiece
      && c.roles.length === 0 && !c.fillsDeckRole,
  );
  out.sort((a, b) => b.manaValue - a.manaValue || a.name.localeCompare(b.name));
  return out.slice(0, limit).map((c) => c.name);
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
  parents: readonly SlackParent[] = [],
): TrimRow[] {
  // FIX F2 (controller review, 2026-08-21): reads `buildParents` now, not leaf `buildCategories` --
  // see `deckSlack`'s own doc comment for why the leaf version went permanently silent under Task 7.
  // A card's `roles` are still LEAF names (`rolesByCard` is built off `detectBuildCategories`
  // membership, never off a parent), so the lookup below is keyed by leaf; every leaf of an
  // over-target parent points at that SAME parent-level slack row, which is what the protection
  // text below actually names.
  const overParents = deckSlack(parents);
  const surplusByLeaf = new Map<string, { name: string; count: number; target: number }>();
  for (const p of parents) {
    const slack = overParents.find((s) => s.category === p.name);
    if (!slack) continue;
    for (const leaf of p.leaves) surplusByLeaf.set(leaf, { name: p.name, count: slack.count, target: slack.target });
  }
  // A two-faced card is one seat at the table, same as in `cutCandidates` -- see `mergeFaces`.
  const merged = mergeFaces(cards);
  const median = medianPartnerCount(merged);
  const rows: TrimRow[] = [];
  for (const c of merged) {
    if (c.isLand || c.isCommander) continue;
    const reasons: string[] = [];
    const protections: string[] = [];

    const wellConnected = median !== null && c.partnerCount > 0 && c.partnerCount >= median;
    // AN UNREAD CARD IS RANKED, NOT REFUSED, AND THE DIFFERENCE FROM `cutCandidates` IS THE
    // QUESTION. The passive list asks "is anything doing nothing" and must not answer with a card
    // it never opened; trim asks "I must cut five" and always owes an Nth row. So the card stays in
    // the order and its clauses tell the truth: the zero connections are the corpus's silence, and
    // that is an argument for caution, hence a PROTECTION rather than a weakness.
    if (!c.derived) {
      reasons.push("the engine has not read this card, so its connections are unknown");
      protections.push("not read yet — nothing here has judged it");
    } else {
      reasons.push(connectionReason(c.partnerCount, median));
      if (c.axisWeight < CUT_AXIS_MAX) {
        reasons.push(c.axisWeight === 0 ? "no edge on your main theme" : "its edges point away from your main theme");
      } else {
        protections.push("its best edge is on your main theme");
      }
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
    // FIX F2: name the PARENT, never the leaf role. "targetedRemoval is at 18 against a target of
    // 10" became a false sentence the moment Task 7 moved every leaf's own target to 0 -- the true
    // one is "Interaction is at 18 against a target of 10". Deduped by parent so a card carrying
    // two roles from the SAME over-target parent (targetedRemoval AND protection, both Interaction)
    // states the room once, not twice.
    const overGroups = new Map<string, { name: string; count: number; target: number }>();
    for (const r of c.roles) {
      const s = surplusByLeaf.get(r);
      if (s) overGroups.set(s.name, s);
    }
    if (c.roles.length > 0) {
      const room = [...overGroups.values()]
        .map((s) => `${s.name} is at ${s.count} against a target of ${s.target}`)
        .join(", ");
      protections.push(room ? `fills ${c.roles.join(", ")} — ${room}, so there is room here` : `fills ${c.roles.join(", ")}`);
    }
    if (c.roles.length === 0) reasons.push("fills none of the functional roles the deck is measured on");
    // The sharpest row this list can print: not "nothing connects to it" but "the card's own text
    // asks for something you do not run".
    for (const want of c.unmetConditions ?? []) {
      reasons.push(`its condition needs ${want}, and nothing in the deck provides that`);
    }

    // AND IT IS A PROTECTION, not merely a wording fix. `rows.sort` leads on protection COUNT, so
    // without this a card wired into half the deck sorted ahead of a card nothing touches: measured,
    // **43 of the 355 top-five slots across the 71 decks were held by a card better connected than
    // its deck's median**. Cutting it may still be right; it should not be the first thing offered.
    if (wellConnected) {
      protections.push(`connects to ${c.partnerCount} cards, more than half this deck`);
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
