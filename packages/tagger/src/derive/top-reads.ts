import type { Ability, GameEvent } from "../schema.js";

/** THE TWO PRINTED READS OF THE TOP OF A LIBRARY THE CLAUSE LAYER DOES NOT RECORD (#1266). The card-selection and impulse-draw roles read these two phrases off the whole oracle text; the same phrases are read here and stored on the abilities
 *  (`Ability.looksAtTop`, `Ability.impulse`), so the matcher reads derived data.
 *  CEILING: `looksAtTop` is read one CLAUSE at a time and a clause that derived no ability carries nothing (Aladdin's Lamp's replacement, Orcish Spy's look at another player's library, Hideaway's reminder: the matcher reads the Hideaway keyword for that last one; Gandalf, Goblins' Bane // Flameshape, whose back face "Look at the top two cards of your library..." derives no ability, so it carries no mark). A card with no derived row at all (Vivien's Invocation, the one commander-legal card without a cardClauses doc) gets nothing.
 *  CEILING: `impulse` is read off the WHOLE card, because the exile and the permission to play are often two clauses (Theater of Horrors, Colfenor's Plans, Pick Up the Pace), but only the ability that exiles from YOUR library carries it. A card with an
 *  exile of its top cards in one ability and an unrelated "you may play" in another is marked; so was the printed pattern. "You may cast" is not an impulse draw here, as it was not in that pattern (Aminatou's Augury, Apex of Power, Amped Raptor).
 *
 *  THE IMPULSE DRAW IS A CAST FROM EXILE (#1665, owner ruling 2026-11-17), HEARD ONLY BY PAYOFFS THAT ASK WHERE A SPELL CAME FROM. To play a card is to cast it as a spell or play it as a land (CR 701.18b), so the marked ability also carries
 *  `cast {control: you, owner: you, type: spell, fromZone: exile}` with `originOnly` (the matcher refuses it to every cast trigger that states no origin: "whenever you cast a spell", prowess, a class payoff). A cast from your own library is YOUR card,
 *  hence `owner: you` ("a spell you don't own" stays deaf). Added once per card, to the first marked ability, and only where the card derives no cast of another card already (Jacob Hauken, Theater of Horrors, Colfenor's Plans state both halves).
 *  CEILING: NO LAND PLAY. The ruling names the cast; the four commander-legal "play a land from exile" payoffs (Rocco, Gwen Stacy, Pia Nalaar, Urianger Augurelt) hear no impulse land. The cast is typed `spell`, so a class payoff that asks where
 *  the spell came from ("a creature spell from exile": none today) would hear a land card's impulse too; the emit does not know the class of the card on top. */
const LOOKS_AT_TOP = /\blook at the top \w+ cards?\b/i;
/** A MANIFEST DREAD looks at the top two cards, and the clause says only "manifest dread": the look is in the reminder, which the clause text drops. Read from the card's own reminder, as the printed pattern was, so a card that prints no reminder
 *  (Dissection Tools) or words it "looks at" (Fear of Impostors, Unwanted Remake) is not a look here either. */
const MANIFESTS_DREAD = /\bmanifests? dread\b/i;
const IMPULSE = /\bexile the top (?:\w+ )?cards? of your library[\s\S]*?you may play\b/i;

/** An `exiled` emit that takes the card from YOUR library. */
const exilesYourLibrary = (a: Ability): boolean => (a.emits ?? []).some((e) => e.verb === "exiled" && e.subject.fromZone === "library" && e.subject.control === "you");

/** The cast an own-library impulse draw derives (#1665): see the CEILING above. */
const IMPULSE_CAST: GameEvent = { verb: "cast", subject: { control: "you", token: null, type: "spell", owner: "you", fromZone: "exile" }, originOnly: true };
const ownExileCast = (e: GameEvent): boolean => e.verb === "cast" && e.subject.self !== true && e.subject.type === "spell" && e.subject.fromZone === "exile" && e.subject.control === "you" && e.subject.owner !== "opp" && e.originOnly !== true;
const castsAnotherCard = (a: Ability): boolean => (a.emits ?? []).some((e) => e.verb === "cast" && e.subject.self !== true);

export function topReadsFromText(abilities: Ability[], clauseTexts: Record<number, string> | undefined, cardText: string): Ability[] {
  const impulseCard = IMPULSE.test(cardText), cardLooks = LOOKS_AT_TOP.test(cardText);
  let castAdded = abilities.some(castsAnotherCard);
  // A card that already derived the cast of its own exiled cards (Theater of Horrors, Colfenor's Plans, Nahiri, Brilliant Ultimatum, Jacob Hauken: `type: spell`, `fromZone: exile`) is the same permission, so that cast is origin-only
  // too and Beast Whisperer and Sai do not hear it (#1665 review). Chandra, Heart of Fire and Chandra, Pyromaster state a typed instant-or-sorcery cast of their own: left as they are.
  const marksOwn = impulseCard && abilities.some(exilesYourLibrary);
  return abilities.map((a) => {
    if (marksOwn && (a.emits ?? []).some(ownExileCast)) a = { ...a, emits: a.emits!.map((e) => (ownExileCast(e) ? { ...e, originOnly: true as const } : e)) };
    const text = a.clause === undefined ? undefined : clauseTexts?.[Math.trunc(Number(a.clause))];
    const looks = text !== undefined && (LOOKS_AT_TOP.test(text) || (MANIFESTS_DREAD.test(text) && cardLooks)), impulse = impulseCard && exilesYourLibrary(a);
    if (!looks && !impulse) return a;
    const withCast = impulse && !castAdded;
    if (withCast) castAdded = true;
    return { ...a, ...(looks ? { looksAtTop: true as const } : {}), ...(impulse ? { impulse: true as const } : {}), ...(withCast ? { emits: [...(a.emits ?? []), IMPULSE_CAST] } : {}) };
  });
}
