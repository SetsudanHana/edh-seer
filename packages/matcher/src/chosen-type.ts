import type { CardTags, SubjectFilter } from "@mtg/tagger";
import type { DeckCard } from "./types.js";

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

/** Pick the deck's most-represented subtype (lexical tie-break); NO_MATCH if the deck has none. */
function topSubtype(counts: Map<string, number>): string {
  let best = NO_MATCH;
  let bestN = 0;
  for (const [sub, n] of counts) {
    if (n > bestN || (n === bestN && sub < best)) {
      best = sub;
      bestN = n;
    }
  }
  return best;
}

function resolveSubject(subject: SubjectFilter, top: string): SubjectFilter {
  if (subject.chosenType !== true) return subject;
  const { chosenType, ...rest } = subject;
  return { ...rest, subtype: top };
}

/** Replace every chosenType:true subject in the card's abilities with the deck's top subtype.
 *  Returns a new CardTags; the input is never mutated. */
export function resolveChosenTypes(tags: CardTags, counts: Map<string, number>): CardTags {
  const top = topSubtype(counts);
  return {
    ...tags,
    abilities: tags.abilities.map((a) => ({
      ...a,
      trigger: a.trigger
        ? { ...a.trigger, subject: resolveSubject(a.trigger.subject, top) }
        : a.trigger,
      effect: a.effect.subject
        ? { ...a.effect, subject: resolveSubject(a.effect.subject, top) }
        : a.effect,
      emits: a.emits?.map((e) => ({ ...e, subject: resolveSubject(e.subject, top) })),
    })),
  };
}
