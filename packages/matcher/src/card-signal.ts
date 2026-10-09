import type { CardTags } from "@edh-seer/tagger";
import { combatTag } from "./zones.js";
import type { CardSignal } from "./archetypes.js";
import { cardCaresTags, cardThemeTags, isPolymorph, POLYMORPH_HIT_MV } from "./edges.js";

/** THE SIGNAL THE REPORT'S DETECTOR READS, built once for a card (spec 2026-09-08 part 4).
 *
 *  Lifted verbatim from `analyze.ts`, where it was the body of a `.map` over the deck. The facet
 *  index needs the same construction for every card in the corpus, at build time, and a second
 *  copy would be a second definition of what a card signals; the report and the search would
 *  then disagree about who is a "+1/+1 Counters" card. */
export function cardSignalOf(card: { name: string; oracleText: string }, tags: CardTags): CardSignal {
  const ch = tags.characteristics;
  return {
    name: card.name,
    themeTags: [...cardThemeTags(tags), ...tags.abilities.flatMap((a) => (a.conditionCares ?? []).map(combatTag))],
    caresTags: [...cardCaresTags(tags), ...tags.abilities.flatMap((a) => (a.conditionCares ?? []).map(combatTag))],
    // An intercepted graveyard fill (Dauthi Voidwalker) exiles the card and plays it from exile: it
    // signals exile-processing, not reanimation (owner 2026-10-08, #1083).
    effectKinds: tags.abilities.map((a) => (a.effect.kind === "graveyard-recursion" && a.effect.intercepted === true ? "exile-processing" : a.effect.kind)),
    tokenKinds: tags.abilities
      .filter((a) => a.effect.kind === "token-generation")
      .map((a) => (a.effect.subject?.type === "creature" ? "creature" : a.effect.subject?.subtype))
      .filter((k): k is string => typeof k === "string"),
    subtypes: (ch?.subtypes ?? []).filter(
      (s) => s === "equipment" || (s === "aura" && /enchant creature/i.test(card.oracleText)),
    ),
    cardTypes: (ch?.types ?? []).map((t) => t.toLowerCase()),
    keywords: (ch?.keywords ?? []).map((k) => k.toLowerCase()),
    lineWords: [...(ch?.types ?? []), ...(ch?.subtypes ?? [])].map((w) => w.toLowerCase()),
    creatureTypes: (ch?.types ?? []).some((t) => t.toLowerCase() === "creature")
      ? ((ch?.keywords ?? []).some((k) => k.toLowerCase() === "changeling")
        ? ["*"]
        : (ch?.subtypes ?? []).map((s) => s.toLowerCase()))
      : [],
    polymorph: isPolymorph({ card, tags }),
    // A creature token is fodder, read as `partners-core`'s fodder supply reads it: the emit's type
    // list (an artifact creature Mite token is one), not `tokenKinds`, which keeps a single type.
    makesCreatureTokens: tags.abilities.some((a) => (a.emits ?? []).some((e) => e.verb === "create-token" && e.subject.token === true
      && [e.subject.type].flat().includes("creature"))),
    polymorphHit: ch.token !== true && (ch.types ?? []).some((t) => t.toLowerCase() === "creature") && ch.cmc >= POLYMORPH_HIT_MV,
    namedTypes: tags.abilities.flatMap((a) =>
      [a.trigger?.subject, a.effect.subject, ...(a.emits ?? []).map((e) => e.subject)]
        .filter((s): s is NonNullable<typeof s> => s !== undefined && s !== null && s.self !== true)
        .flatMap((s) => (Array.isArray(s.subtype) ? s.subtype : s.subtype ? [s.subtype] : []))
        .map((s) => s.toLowerCase()),
    ),
  };
}
