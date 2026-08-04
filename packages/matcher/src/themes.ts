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

/** Share of the deck that may supply a tag by baseline alone before the tag stops being a theme
 *  and becomes deck arithmetic. Calibrated on packages/cli/decks/calibration (71 decks) — see
 *  bin/theme-cal.ts, which re-derives it and prints the plateau. */
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
      if (dc.tags && authoredSurplusTags(dc.tags).has(tag)) surplus.add(dc.card.name);
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
