import type { Ability } from "../schema.js";

/** THE TWO PRINTED READS OF THE TOP OF A LIBRARY THE CLAUSE LAYER DOES NOT RECORD (#1266). The card-selection and impulse-draw roles read these two phrases off the whole oracle text; the same phrases are read here and stored on the abilities
 *  (`Ability.looksAtTop`, `Ability.impulse`), so the matcher reads derived data.
 *  CEILING: `looksAtTop` is read one CLAUSE at a time and a clause that derived no ability carries nothing (Aladdin's Lamp's replacement, Orcish Spy's look at another player's library, Hideaway's reminder: the matcher reads the Hideaway keyword for that last one; Gandalf, Goblins' Bane // Flameshape, whose back face "Look at the top two cards of your library..." derives no ability, so it carries no mark). A card with no derived row at all (Vivien's Invocation, the one commander-legal card without a cardClauses doc) gets nothing.
 *  CEILING: `impulse` is read off the WHOLE card, because the exile and the permission to play are often two clauses (Theater of Horrors, Colfenor's Plans, Pick Up the Pace), but only the ability that exiles from YOUR library carries it. A card with an
 *  exile of its top cards in one ability and an unrelated "you may play" in another is marked; so was the printed pattern. "You may cast" is not an impulse draw here, as it was not in that pattern (Aminatou's Augury, Apex of Power, Amped Raptor). */
const LOOKS_AT_TOP = /\blook at the top \w+ cards?\b/i;
/** A MANIFEST DREAD looks at the top two cards, and the clause says only "manifest dread": the look is in the reminder, which the clause text drops. Read from the card's own reminder, as the printed pattern was, so a card that prints no reminder
 *  (Dissection Tools) or words it "looks at" (Fear of Impostors, Unwanted Remake) is not a look here either. */
const MANIFESTS_DREAD = /\bmanifests? dread\b/i;
const IMPULSE = /\bexile the top (?:\w+ )?cards? of your library[\s\S]*?you may play\b/i;

/** An `exiled` emit that takes the card from YOUR library. */
const exilesYourLibrary = (a: Ability): boolean => (a.emits ?? []).some((e) => e.verb === "exiled" && e.subject.fromZone === "library" && e.subject.control === "you");

export function topReadsFromText(abilities: Ability[], clauseTexts: Record<number, string> | undefined, cardText: string): Ability[] {
  const impulseCard = IMPULSE.test(cardText), cardLooks = LOOKS_AT_TOP.test(cardText);
  return abilities.map((a) => {
    const text = a.clause === undefined ? undefined : clauseTexts?.[Math.trunc(Number(a.clause))];
    const looks = text !== undefined && (LOOKS_AT_TOP.test(text) || (MANIFESTS_DREAD.test(text) && cardLooks)), impulse = impulseCard && exilesYourLibrary(a);
    if (!looks && !impulse) return a;
    return { ...a, ...(looks ? { looksAtTop: true as const } : {}), ...(impulse ? { impulse: true as const } : {}) };
  });
}
