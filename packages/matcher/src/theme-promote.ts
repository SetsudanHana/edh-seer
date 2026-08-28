import { SUBTYPE_TYPES } from "@edh-seer/tagger";
import { ALL_CARD_TYPES } from "./hierarchy.js";
import { PHASE_VERBS } from "./availability.js";
import type { ThemeMembership } from "./themes.js";

/** How much of the headline's in-deck support a more-specific sibling must hold to replace it.
 *
 *  Seeded at 0.30 from the DOMINATED-HEADLINE curve measured before this existed (9 of 71 decks at
 *  30%, 5 at 50%, 3 at 70%, 1 at 100%) and swept over {0.3, 0.5, 0.7} against the criteria in
 *  `specs/2026-08-19-theme-family-ranking-design.md` §10.4. */
export const PROMOTE_SHARE = 0.3;

/** A subject that names no particular class: a bare card type, or `any`. Only a headline with one of
 *  these can be generalising over something more specific the deck also carries. */
const GENERAL: ReadonlySet<string> = new Set(["any", ...ALL_CARD_TYPES]);

const split = (tag: string): [string, string] | undefined => {
  const i = tag.indexOf(":");
  return i === -1 ? undefined : [tag.slice(0, i), tag.slice(i + 1)];
};

/**
 * THE PROMOTION RULE — a headline should not be a strict generalization of a sibling the deck
 * plainly cares about (spec §10, owner's call 2026-08-19).
 *
 * A POST-RANK GUARD, never a ranking function: `rankThemes` is untouched and only the head of the
 * list can move. That is deliberate. Rewriting the ranking to prefer specific tags has now been
 * refused three times — family-grouped `S_max + α·Σ(rest)`, loop `min(supply, payoffs)` off authored
 * surplus, and the same off surplus+baseline — each time because a rule strong enough to demote
 * `enters:creature` demotes it everywhere, and "creatures entering" is a TRUE statement about most
 * EDH decks.
 *
 * THE PAYOFF GUARD IS THE WHOLE RULE, and it was measured before it was written. The highest-support
 * specific sibling is `enters:human` in three of the nine dominated decks, because Human rides along
 * with almost every tribe — promoting on frequency alone names a WIZARD deck "humans entering".
 * `enters:human` has ZERO census presence in every one of them (0 surplus, 0 payoffs, 0 baseline):
 * nothing in Magic cares that a Human entered. `enters:wizard` has 2 payoffs and `enters:merfolk` 6.
 * So the guard is not "is it specific" but "does something in this deck watch for it".
 *
 * Specificity is the CR assignment (`SUBTYPE_TYPES`), never `hierarchy.json`, which records which
 * card types a subtype has been printed BESIDE and would make `treasure` a kind of creature.
 */
export function promoteSpecificHeadline(
  ranked: readonly string[],
  deckFreq: ReadonlyMap<string, number>,
  membership: readonly ThemeMembership[],
  share: number = PROMOTE_SHARE,
): string[] {
  const head = ranked[0];
  if (head === undefined) return [...ranked];
  const parts = split(head);
  if (!parts) return [...ranked];
  const [verb, value] = parts;
  if (!GENERAL.has(value)) return [...ranked]; // already specific — nothing to promote over
  const headFreq = deckFreq.get(head) ?? 0;
  if (headFreq === 0) return [...ranked];
  const payoffs = new Map(membership.map((m) => [m.tag, m.payoffs.length] as const));

  let best: { tag: string; freq: number } | undefined;
  for (const tag of ranked) {
    if (tag === head) continue;
    const p = split(tag);
    if (!p || p[0] !== verb) continue;
    const sub = p[1];
    if (GENERAL.has(sub) || sub.startsWith("-")) continue;
    const types = SUBTYPE_TYPES[sub];
    // A subtype of the headline's card type — or of anything at all, when the headline says `any`.
    if (!types || (value !== "any" && !types.includes(value))) continue;
    const freq = deckFreq.get(tag) ?? 0;
    if (freq < share * headFreq) continue;
    // THE GUARD: something in this deck has to watch for it. Refuses `enters:human`.
    if ((payoffs.get(tag) ?? 0) === 0) continue;
    if (!best || freq > best.freq || (freq === best.freq && tag < best.tag)) best = { tag, freq };
  }
  if (!best) return [...ranked];
  return [best.tag, ...ranked.filter((t) => t !== best!.tag)];
}

/** A tag that is TRUE of the deck and says nothing a deckbuilder can act on.
 *
 *  Two kinds, both measured on the 71 calibration decks rather than guessed:
 *
 *  - A PHASE key (`upkeep:any`, `begin-combat:any`, `end-step:any`). "Upkeep" is a TIME, not a
 *    theme -- every deck's triggers fire in some step, and a reader told "your deck is about upkeep"
 *    learns nothing. Two decks headline `upkeep:any` today, and the count rises whenever demand
 *    shrinks anywhere else, because a timing key is never competing on merit. `PHASE_VERBS` is the
 *    existing list (`availability.ts`), which already treats these as self-supplied for the same
 *    reason: nothing in the deck can supply a step.
 *  - A CHOSEN-TYPE key that resolved to nothing (`__none__`, `chosen-type.ts`'s `NO_MATCH`). It is a
 *    PLACEHOLDER competing as a theme -- recorded in the A1 blast radius as reaching some deck's
 *    top 5 in 4 of the 71 decks, and never chased.
 *
 *  A DEMOTION, NOT A DELETION: the tag keeps its place in the ranked list and only loses the HEAD,
 *  the same shape as the promotion rule above. The deck still reports the tag among its themes; it
 *  just cannot be what the report NAMES the deck. */
export function isUnrankableHeadline(tag: string, suppliedPhases: ReadonlySet<string> = new Set()): boolean {
  const parts = split(tag);
  if (!parts) return false;
  const [verb, value] = parts;
  if (value === "__none__") return true;
  if (!PHASE_VERBS.has(verb)) return false;
  // UNLESS THE DECK SUPPLIES THE STEP, which is the whole reason a timing key is normally empty --
  // and one deck of the 71 does. `obeka-upkeep-shenanigans` runs Obeka, Splitter of Seconds
  // ("you get that many additional upkeep steps"), so "upkeep" is that deck's actual plan, and the
  // first cut of this guard renamed it "auras entering" at cohesion 0.10 -- a worse sentence about
  // a deck named after its own theme. `it-is-time` and `lynde-cursing-mistress` run Paradox Haze
  // for the same fact.
  return !PHASE_SUPPLY[verb]?.some((p) => suppliedPhases.has(p));
}

/** Which `Effect.subject.phase` values supply a phase verb's step. A BEGINNING phase contains the
 *  untap, upkeep and draw steps (CR 501), so Sphinx of the Second Sun really does give another
 *  upkeep. An extra TURN is deliberately NOT counted: it supplies every step trivially, and a deck
 *  running Time Warp is not thereby an upkeep deck. */
const PHASE_SUPPLY: Record<string, string[]> = {
  upkeep: ["upkeep", "beginning"],
  "end-step": ["end"],
  "begin-combat": ["combat"],
};

/** Moves an unrankable head behind the first rankable tag. Runs BEFORE `promoteSpecificHeadline`,
 *  so the promotion rule sees a real headline to promote over rather than a timing key. */
export function demoteUnrankableHeadline(
  ranked: readonly string[],
  suppliedPhases: ReadonlySet<string> = new Set(),
): string[] {
  const head = ranked[0];
  if (head === undefined || !isUnrankableHeadline(head, suppliedPhases)) return [...ranked];
  const first = ranked.findIndex((t) => !isUnrankableHeadline(t, suppliedPhases));
  if (first === -1) return [...ranked]; // every tag is unrankable -- say the true thing, not nothing
  return [ranked[first], ...ranked.filter((_, i) => i !== first)];
}
