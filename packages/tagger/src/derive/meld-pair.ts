import type { Ability, GameEvent, SubjectFilter } from "../schema.js";
import { CARD_TYPES } from "./subject.js";

/** The card types and subtypes of what a meld pair melds INTO and of its partner(s), read off Scryfall's `allParts` type lines (`meld_result`, `meld_part`). */
export interface MeldParts {
  result: { name?: string; types: string[]; subtypes: string[] };
  partners: { name?: string; types: string[]; subtypes: string[] }[];
}

/** "EXILE THEM, THEN MELD THEM" EXILES THE PAIR, NOT A CLASS (#1582 part 2). The seven melding cards (Graf Rats, Hanweir Battlements, Mishra Claimed by Gix, Titania Voice of Gaea, Vanille Cheerful l'Cie, Urza Lord Protector, Gisela the Broken Blade) say
 *  "if you both own and control this and a creature named X, exile them, then meld them into Y" (CR 701.42a: put the two cards onto the battlefield combined). The two cards are THIS card and the one the condition names: a set the card defined, not a class.
 *  The object text read as one anyway: "Graf Rats and Midnight Scavengers" a mass of creatures (`scope: all`), "Mishra and Phyrexian Dragon Engine" the subtypes Phyrexian and Dragon, "Brisela, Voice of Nightmares" a mass of Nightmares, "Titania and Argoth" nothing at all, so a token payoff
 *  and a mass-leave payoff heard the pair. The exile and its leave keep what is TRUE of the two cards -- they are nontoken permanents you control (tokens cannot be melded, 701.42b) of the card's own types and the partner's, a creature exile that "whenever a creature you control is exiled" hears
 *  (own-name.test.ts: Syr Vondam, Soulherder, Hero of Bretagard) -- and lose what is not: the mass `scope` and a subtype read off a name; they are marked `selection: chosen` (a set the card defined; `massCouldBeToken` and the Aura reach refuse it).
 *  The melded permanent's `enters` is the RESULT card: its types and subtypes from the `meld_result` type line (Chittering Host a creature Eldrazi Horror, Urza, Planeswalker a planeswalker), never the words of its name ("Brisela, Voice of Nightmares" is no Nightmare),
 *  under your control, nontoken, an artifact creature being BOTH (`allTypes`), with what the clause says of its entry (Mishra's "enters tapped and attacking"). The count the object text scaled the ability by (a mass of "creatures") goes: a meld happens once.
 *  The entering permanent carries `named` (the result's name, as `Gisela`'s partner already does): ONE card enters, so no other card's own enters trigger hears it (Birthing Hulk, a Horror) and `caresAboutCreatureType` does not read the result's creature types as ones the melder cares about, which made Graf Rats a cast and attack producer for every chosen-type payoff.
 *  The exile and leave hold THIS card or a named one: a pair that read neither (Mishra, Titania) is named for its partner (`self` when the document has no partner), so no other card's own leaves trigger (Thragtusk) hears it, while a class payoff does, including an `other` one (Sludge Strider hears the Engine).
 *  The meld pair itself is the `meld` relation (edges.ts `meldReason`), which reads Scryfall's meld parts, not these events.
 *  CEILING: the pair's types are one OR list (a creature and a land, "Titania and Argoth"), not two subjects, so a land payoff hears the creature half and a creature payoff the land half. The result's types and subtypes come from `allParts`; a card document without them
 *  (a fixture, an old ingest) gets the card's own types for the pair and an untyped entry. Detected by the printed clause text "meld them" (a string test); a clause without it is untouched. */
const MELD_THEM = "meld them";
const TYPE_WORDS: ReadonlySet<string> = new Set(CARD_TYPES);
const one = <T,>(xs: T[]): T | T[] | undefined => (xs.length === 0 ? undefined : xs.length === 1 ? xs[0] : xs);

export function meldPair(abilities: Ability[], clauseTexts: Record<number, string> | undefined, ownTypes: readonly string[], parts: MeldParts | undefined): Ability[] {
  return abilities.map((a) => {
    if (a.clause === undefined || !a.emits?.length) return a;
    const text = clauseTexts?.[Math.trunc(Number(a.clause))];
    if (text === undefined || !text.toLowerCase().includes(MELD_THEM)) return a;
    const pair = [...new Set([...ownTypes, ...(parts?.partners.flatMap((p) => p.types) ?? [])].map((t) => t.toLowerCase()).filter((t) => TYPE_WORDS.has(t)))];
    const pairType = one(pair);
    const partner = parts?.partners[0]?.name?.toLowerCase();
    const emits = a.emits.map((e): GameEvent => {
      if (e.verb === "exiled" || e.verb === "leaves") {
        const { scope: _scope, subtype: _subtype, ...rest } = e.subject;
        const subject: SubjectFilter = { ...rest, control: "you", token: false, selection: "chosen", ...(rest.self !== true && rest.named === undefined ? (partner !== undefined ? { named: partner } : { self: true }) : {}), ...(pairType !== undefined ? { type: pairType } : {}) };
        return { ...e, subject };
      }
      if (e.verb === "enters") {
        const types = parts?.result.types.map((t) => t.toLowerCase()).filter((t) => TYPE_WORDS.has(t)) ?? [];
        const subtypes = parts?.result.subtypes.map((t) => t.toLowerCase()) ?? [];
        const type = one(types);
        const subtype = one(subtypes);
        const subject: SubjectFilter = { control: "you", token: false, ...(type !== undefined ? { type } : {}), ...(types.length > 1 ? { allTypes: [...types].sort() } : {}), ...(subtype !== undefined ? { subtype } : {}), ...(parts?.result.name ? { named: parts.result.name.toLowerCase() } : {}), ...(e.subject.entersTapped !== undefined ? { entersTapped: e.subject.entersTapped } : {}) };
        return { ...e, subject };
      }
      return e;
    });
    // The scaling the mass object gave the ability ("a mass of creatures") is no count of the meld.
    const { count, ...rest } = a;
    return { ...rest, ...(count !== undefined && count.scalesWith === undefined ? { count } : {}), emits };
  });
}
