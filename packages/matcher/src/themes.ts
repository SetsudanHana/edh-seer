import type { Reason } from "@mtg/engine";
import type { CardTags } from "@mtg/tagger";
import { themeSubjectKey } from "./edges.js";
import { normalizeZoneEvent, zoneEventKey } from "./zones.js";
import type { DeckCard } from "./types.js";

/** A static effect is never a theme of its own. A continuous modifier is a PAYOFF of whatever
 *  theme supplies its subject — an anthem belongs beside the token makers feeding it, not at the
 *  head of a `static:pump` zone holding all 90 creatures. A replacement effect is a SURPLUS
 *  PRODUCER of the event it replaces. Either way the theme is named by the event, not the static. */
export function themeCandidates(tags: string[]): string[] {
  return tags.filter((t) => !t.startsWith("static:"));
}

/** A card's own authored emits, keyed identically to reason tags (normalizeZoneEvent +
 *  zoneEventKey), so string equality against `tag` actually matches. Emits only -- never
 *  triggers -- because a trigger is the cares side of an ability: it names what the card wants
 *  fed to it, not what it supplies. `cardThemeTags` (edges.ts) mixes both for deck-frequency
 *  ranking, which is exactly wrong here. */
function authoredSurplusTags(tags: CardTags): Set<string> {
  const out = new Set<string>();
  for (const a of tags.abilities) {
    for (const emit of a.emits ?? []) {
      const e = normalizeZoneEvent(emit);
      out.add(zoneEventKey(e.verb, e.subject.zone, themeSubjectKey(e.subject)));
    }
  }
  return out;
}

/** Which EVENT a static effect is a payoff of, by its effect KIND (owner's ruling, 2026-08-19).
 *  A static carries no event tag of its own -- an anthem's reasons read `static:pump` -- so a LORD,
 *  the archetypal tribal payoff, was a payoff of NO `enters:`/`attacks:` tag and the census
 *  under-counted exactly the specific themes a loop ranking has to see.
 *
 *  The kind decides the verb, because the kinds do not pay off on the same event. A lord, an anthem
 *  and a keyword granter improve permanents that are ON the battlefield, so they pay off when the
 *  subject ENTERS. A cost reducer pays off when the subject is CAST -- it does nothing for a
 *  creature already in play. Keying every static to every verb sharing its subject was measured and
 *  refused: 317 of 1,075 credits across the 71 decks (29.5%) landed on a REMOVAL verb
 *  (`dies` 139 · `sacrifice` 110 · `leaves` 37 · `discard` 13 · `mill` 11 · `enters-graveyard` 7),
 *  where the claim inverts -- an anthem does nothing when a creature dies.
 *
 *  AN UNMAPPED KIND CREDITS NOTHING. `tax` is opponent-facing and stays out by the same ruling that
 *  keeps it in `ROLE_NOT_SYNERGY`; `graveyard-recursion`, `untap`, `damage-multiplier` and
 *  `token-generation` reach 2 or fewer instances each as statics and are left unanswered rather
 *  than guessed. The five mapped kinds are 305 of the 313 statics carrying a usable subject (97.4%).
 */
const STATIC_PAYOFF_VERB: Record<string, string> = {
  pump: "enters",
  "keyword-grant": "enters",
  "type-grant": "enters",
  "speed-increase": "enters", // Maelstrom Wanderer, "creatures you control have haste" -- a keyword grant by another name
  animate: "enters", // Bello, "each non-Equipment artifact you control ... is a 4/4 Elemental"
  "cost-reduction": "cast",
};

/** The event tags a card's STATIC abilities make it a payoff of. Subject-typed and OURS only: a
 *  subject that keys `any` names no class and crediting it would be a guess, and an opponent-facing
 *  static (Ghostly Prison) is not a payoff of anything we chose to run. */
function staticPayoffTags(tags: CardTags): Set<string> {
  const out = new Set<string>();
  for (const a of tags.abilities) {
    if (a.kind !== "static") continue;
    const kind = a.effect?.kind;
    const subject = a.effect?.subject;
    if (!kind || !subject) continue;
    const verb = STATIC_PAYOFF_VERB[kind];
    if (!verb || subject.control === "opp") continue;
    // A SUPERTYPE OUTRANKS THE CARD TYPE, AND ONLY HERE. Jodah, the Unifier's anthem is gated on
    // `legendary: true` and keyed `enters:creature`, so the census credited a legends payoff as a
    // payoff of every creature entering -- a wider claim than the card makes. `themeSubjectKey`
    // itself cannot learn this: it keys REASON tags, and the frozen panel's verdicts are keyed on
    // `producer|consumer|tag`, so composing another fact into it costs judging debt while changing
    // no theme (measured, 22 rows, 2026-08-14). `historic` rides along -- CR 700.6 makes it the
    // same shape, and it is one derived card.
    const key = subject.legendary === true
      ? "legendary"
      : subject.historic === true ? "historic" : themeSubjectKey(subject);
    if (key === "any") continue;
    out.add(`${verb}:${key}`);
  }
  return out;
}

/** Share of the deck that may supply a tag by baseline alone before the tag stops being a theme
 *  and becomes deck arithmetic. Re-derived on the 71-deck corpus (bin/theme-cal.ts) and NO PLATEAU
 *  WAS FOUND — every step 0.35→0.70 changes at least one deck's answer, so 0.55 is retained as the
 *  incumbent, not as a measured value. Treat it as unvalidated until a per-card ground truth exists
 *  to score it against. */
export const BASELINE_CAP = 0.55;

export interface ThemeMembership {
  tag: string;
  surplus: string[];
  payoffs: string[];
  baseline: string[];
  selective: boolean;
  members: string[];
}

/** Split every card's relation to each candidate tag into the three that are not equivalent:
 *  SURPLUS (an authored effect supplies more of the event than the card's existence implies — a
 *  fetchland's second land-ETB), PAYOFF (triggers on it, or is statically improved by it), and
 *  BASELINE (the card's existence supplies exactly one occurrence — a Forest, a bear, a bolt).
 *
 *  Baseline is admitted only when the tag is selective in this deck. A payoff reading "whenever a
 *  creature enters" is fed by every creature and its baseline carries no information; Inalla's
 *  "nontoken Wizard" filter makes the same kind of supply scarce and therefore meaningful. */
export function themeMembership(
  deckCards: DeckCard[],
  reasons: Reason[],
  tags: string[],
  baselineCap: number = BASELINE_CAP,
): ThemeMembership[] {
  const total = deckCards.length || 1;
  // Computed once per card, not once per (card, tag) pair -- authoredSurplusTags walks every
  // ability on the card, and re-running that inside the tags.map loop below would redo it once
  // per candidate tag.
  const surplusTagsByCard = new Map<string, Set<string>>();
  const staticPayoffsByCard = new Map<string, Set<string>>();
  for (const dc of deckCards) {
    if (!dc.tags) continue;
    surplusTagsByCard.set(dc.card.name, authoredSurplusTags(dc.tags));
    staticPayoffsByCard.set(dc.card.name, staticPayoffTags(dc.tags));
  }
  return tags.map((tag) => {
    const surplus = new Set<string>();
    const baseline = new Set<string>();
    const payoffs = new Set<string>();

    for (const r of reasons) {
      if (r.tag !== tag) continue;
      if (r.consumer) payoffs.add(r.consumer);
      if (!r.producer) continue;
      if (r.impliedProducer) baseline.add(r.producer);
      else surplus.add(r.producer);
    }
    // A card whose own authored emit produces this tag is a surplus supplier even when the deck
    // holds no matching payoff to draw a Reason edge for it (a token maker with no token payoffs
    // in the deck). Only emits count: a trigger is the cares side and belongs in payoffs, not
    // surplus -- see authoredSurplusTags.
    for (const dc of deckCards) {
      if (surplusTagsByCard.get(dc.card.name)?.has(tag)) surplus.add(dc.card.name);
      // A STATIC is a payoff of the event its kind maps to -- see STATIC_PAYOFF_VERB. Read off the
      // card, not off a Reason, because a static's Reason carries `static:<kind>` and never the
      // event tag; and off the card the credit stands even when the deck holds no producer to draw
      // an edge with, exactly as an authored surplus emit does above.
      if (staticPayoffsByCard.get(dc.card.name)?.has(tag)) payoffs.add(dc.card.name);
    }
    // A card that both produces surplus and supplies baseline is a surplus producer.
    for (const n of surplus) baseline.delete(n);

    const selective = baseline.size <= baselineCap * total;
    const members = new Set([...surplus, ...payoffs]);
    if (selective) for (const n of baseline) members.add(n);

    return {
      tag,
      surplus: [...surplus].sort(),
      payoffs: [...payoffs].sort(),
      baseline: [...baseline].sort(),
      selective,
      members: [...members].sort(),
    };
  });
}
