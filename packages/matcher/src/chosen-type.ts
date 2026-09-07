import type { CardTags, SubjectFilter } from "@edh-seer/tagger";
import type { DeckCard, Hierarchy } from "./types.js";
import { impliesType } from "./hierarchy.js";

/** A subtype guaranteed absent from every card, so an unresolved chooser matches nothing. */
const NO_MATCH = "__none__";

/** Count how many deck cards carry each characteristic subtype.
 *
 *  ONE VOTE PER DISTINCT CARD, NOT PER SLOT -- the same ruling `analyzeDeckStructured` already
 *  applies to relations ("one node per card, with its count", 2026-08-15), and here it is not a
 *  tidiness preference but the difference between a right and a wrong answer. `inputs` is one entry
 *  per COPY, so a deck's basic lands vote as many times as it runs them, and BASIC LAND TYPES ARE
 *  SUBTYPES: measured across the 71 calibration decks, `island` was the top subtype in six of them
 *  and beat the tribe the deck is actually built on --
 *
 *    draguns              island 24 > dragon 22
 *    vnwxt-blue-aggro     island 27 > rogue 10
 *    mono-blue-tribal     island 12 > wizard 12 (lexical tie-break, and a tie is already wrong)
 *
 *  -- so every "choose a creature type" card in those decks chose a LAND type, matched nothing, and
 *  formed no edges. Banner of Kinship, Urza's Incubator, Herald's Horn, Patchwork Banner and
 *  Kindred Discovery between them lost 137 reasons on `draguns` alone. Deduping is enough because
 *  the thing that overwhelmed the count was multiplicity; a singleton tribe is unaffected.
 *
 *  NOT FIXED BY CONSTRAINING TO CREATURE TYPES, which would be the other half of this and is a
 *  separate question: `topSubtype` already filters to the subject's `type` when it has one, and the
 *  choosers that went wrong here carry no type constraint at all. That is a normalization gap, and
 *  it costs money to close; this does not. */
export function deckSubtypeCounts(inputs: DeckCard[]): Map<string, number> {
  const counts = new Map<string, number>();
  const seen = new Set<string>();
  for (const { card, tags } of inputs) {
    if (!tags || seen.has(card.name)) continue;
    seen.add(card.name);
    for (const sub of new Set(tags.characteristics.subtypes.map((s) => s.toLowerCase()))) {
      counts.set(sub, (counts.get(sub) ?? 0) + 1);
    }
  }
  return counts;
}

const arr = (v: string | string[] | undefined): string[] =>
  v === undefined ? [] : Array.isArray(v) ? v : [v];

/** Pick the deck's most-represented subtype (lexical tie-break); NO_MATCH if the deck has none.
 *  When `types` is non-empty, only subtypes that imply at least one of them (per `hierarchy`)
 *  are eligible candidates. */
function topSubtype(counts: Map<string, number>, hierarchy: Hierarchy, types: string[]): string {
  let best = NO_MATCH;
  let bestN = 0;
  for (const [sub, n] of counts) {
    if (types.length > 0 && !types.some((t) => impliesType(hierarchy, sub, t))) continue;
    if (n > bestN || (n === bestN && sub < best)) {
      best = sub;
      bestN = n;
    }
  }
  return best;
}

function resolveSubject(subject: SubjectFilter, counts: Map<string, number>, hierarchy: Hierarchy): SubjectFilter {
  if (subject.chosenType !== true) return subject;
  const { chosenType, ...rest } = subject;
  const top = topSubtype(counts, hierarchy, arr(subject.type));
  return { ...rest, subtype: top };
}

/** Replace every chosenType:true subject in the card's abilities with the deck's top subtype
 *  among the subject's legal types (or the deck's global top subtype when the subject has no
 *  type constraint). Returns a new CardTags; the input is never mutated. */
export function resolveChosenTypes(tags: CardTags, counts: Map<string, number>, hierarchy: Hierarchy): CardTags {
  return {
    ...tags,
    abilities: tags.abilities.map((a) => ({
      ...a,
      trigger: a.trigger
        ? { ...a.trigger, subject: resolveSubject(a.trigger.subject, counts, hierarchy) }
        : a.trigger,
      effect: a.effect.subject
        ? { ...a.effect, subject: resolveSubject(a.effect.subject, counts, hierarchy) }
        : a.effect,
      emits: a.emits?.map((e) => ({ ...e, subject: resolveSubject(e.subject, counts, hierarchy) })),
    })),
  };
}
