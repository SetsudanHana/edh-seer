import type { CardTags, SubjectFilter } from "@mtg/tagger";

/** BEING A COMMANDER IS A DECK FACT, NOT A PRINTED ONE.
 *
 *  Every other subject qualifier — `legendary`, `basic`, `keyword` — is read off a type line, so the
 *  matcher can stamp it from `Characteristics` alone. This one cannot: the same card is a commander
 *  in one list and an ordinary creature in another, and CR 903.3 says the designation "is not a
 *  characteristic of the object represented by the card; rather, it is an attribute of the card
 *  itself."
 *
 *  So the demand is parsed from clause text by `parseSubject` (`SubjectFilter.commander`) and the
 *  SUPPLY is stamped here, once per deck, before any edge forms. That is the shape
 *  `resolveChosenTypes` already uses for the other deck-aware fact, and it is deliberately the same
 *  shape so there is one answer to "where do deck facts enter matching".
 *
 *  Found by sweeping CR 903 in an engine that analyses the Commander format and had never read it.
 *  206 corpus cards / 35 derived name a commander as a subject; the witness is Kediss, Emberclaw
 *  Familiar, whose "whenever a commander you control deals combat damage to an opponent" derived
 *  `{control: "you", token: null}` — no type at all — and so matched ANY combat damage from anything
 *  its controller had on the battlefield. */
const stamp = (s: SubjectFilter): SubjectFilter => ({ ...s, commander: true as const });

/** Mark this card's OWN events as coming from a commander. Only the card's self-referential subjects
 *  are stamped — its emits and the effect it has on itself — never a trigger's subject, which
 *  describes what the card WATCHES rather than what it IS.
 *
 *  `emits` is the load-bearing one: a commander's combat damage, death and entry are what a
 *  commander-matters consumer is looking for. */
export function markCommander(tags: CardTags): CardTags {
  return {
    ...tags,
    // The characteristics carry it so IMPLIED events are stamped as well — a commander mostly
    // supplies its combat damage, entry and death, and all three are synthesized from here rather
    // than authored. Without this Kediss saw nothing at all, including its own partner.
    characteristics: { ...tags.characteristics, commander: true },
    abilities: tags.abilities.map((a) => ({
      ...a,
      emits: a.emits?.map((e) => ({ ...e, subject: stamp(e.subject) })),
    })),
  };
}

/** Does a consumer demanding a commander accept this producer? Called from `subjectMatches`.
 *
 *  ASYMMETRIC, like `legendary` and `basic`: a consumer that does not ask is unaffected, and one
 *  that DOES ask is satisfied only by a card the deck actually designated. An unstamped producer is
 *  not a commander — the stamp is applied to every commander in the list before matching, so absence
 *  is a real answer here rather than missing information. */
export function commanderMatches(producer: SubjectFilter, consumer: SubjectFilter): boolean {
  return consumer.commander !== true || producer.commander === true;
}
