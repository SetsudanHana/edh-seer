import type { CardTags, SubjectFilter } from "@edh-seer/tagger";
import type { DeckCard, Hierarchy } from "./types.js";
import { impliesType } from "./hierarchy.js";

/** A subtype guaranteed absent from every card, so an unresolved chooser matches nothing. */
const NO_MATCH = "__none__";

/** Count how many deck cards carry each characteristic subtype. */
export function deckSubtypeCounts(inputs: DeckCard[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const { tags } of inputs) {
    if (!tags) continue;
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
