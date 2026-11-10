import type { Ability, GameEvent, SubjectFilter } from "../schema.js";
import { CARD_TYPES } from "./subject.js";

/** "EXILE THEM, THEN MELD THEM" EXILES THE PAIR, NOT A CLASS (#1582 part 2). The seven melding cards (Graf Rats, Hanweir Battlements, Mishra Claimed by Gix, Titania Voice of Gaea, Vanille Cheerful l'Cie, Urza Lord Protector, Gisela the Broken Blade) say
 *  "if you both own and control this and a creature named X, exile them, then meld them into Y" (CR 701.42a: put the two cards onto the battlefield combined). The two cards are THIS card and the one the condition names: a set the card defined, not a class.
 *  The object text read as one anyway: "Graf Rats and Midnight Scavengers" a mass of creatures (`scope: all`), "Mishra and Phyrexian Dragon Engine" the subtypes Phyrexian and Dragon, "Brisela, Voice of Nightmares" a mass of Nightmares, "Titania and Argoth" nothing at all, so a token payoff
 *  and a mass-leave payoff heard the pair. The exile and its leave keep what is TRUE of the two cards -- they are exiled permanents of the card's own types and the partner's ("a creature named", "an artifact named"), a creature exile that "whenever a creature you control is exiled" hears
 *  (own-name.test.ts: Syr Vondam, Soulherder, Hero of Bretagard) -- and lose what is not: the mass `scope`, a subtype read off a name, and they are marked `selection: chosen` (a set the card defined; `massCouldBeToken` and the Aura reach refuse it). The type is the pair's (the card's own and the partner's), whatever the object text read.
 *  The melded permanent's `enters` keeps nothing the result's NAME suggested (type, subtype, scope, name), and keeps the control and what the clause says of its entry (Mishra's "enters tapped and attacking"); tokens cannot be melded (701.42b), so the pair is nontoken.
 *  The meld pair itself is the `meld` relation (edges.ts `meldReason`), which reads Scryfall's meld parts, not these events.
 *  CEILING: the pair's types are one OR list (a creature and a land, "Titania and Argoth"), not two subjects, so a land payoff hears the creature half and a creature payoff the land half; the partner's type is read from "a <type> named" in the printed clause, and a clause without it
 *  gets the card's own types only. Detected by the printed clause text "meld them" (a string test); a clause without it is untouched. */
const MELD_THEM = "meld them";
const TYPE_WORDS: ReadonlySet<string> = new Set(CARD_TYPES);

/** The card type of "a creature named X" / "an artifact named X": the word before " named ", when it is a card type. */
function partnerType(text: string): string | undefined {
  const lower = text.toLowerCase();
  const at = lower.indexOf(" named ");
  if (at < 0) return undefined;
  const before = lower.slice(0, at).trimEnd();
  const word = before.slice(before.lastIndexOf(" ") + 1);
  return TYPE_WORDS.has(word) ? word : undefined;
}

export function meldPair(abilities: Ability[], clauseTexts: Record<number, string> | undefined, ownTypes: readonly string[]): Ability[] {
  return abilities.map((a) => {
    if (a.clause === undefined || !a.emits?.length) return a;
    const text = clauseTexts?.[Math.trunc(Number(a.clause))];
    if (text === undefined || !text.toLowerCase().includes(MELD_THEM)) return a;
    const partner = partnerType(text);
    const pair = [...new Set([...ownTypes.map((t) => t.toLowerCase()).filter((t) => TYPE_WORDS.has(t)), ...(partner !== undefined ? [partner] : [])])];
    const pairType = pair.length === 0 ? undefined : pair.length === 1 ? pair[0] : pair;
    const emits = a.emits.map((e): GameEvent => {
      if (e.verb === "exiled" || e.verb === "leaves") {
        const { scope: _scope, subtype: _subtype, ...rest } = e.subject;
        const subject: SubjectFilter = { ...rest, token: false, selection: "chosen", ...(pairType !== undefined ? { type: pairType } : {}) };
        return { ...e, subject };
      }
      if (e.verb === "enters") {
        const s = e.subject;
        return { ...e, subject: { control: s.control, token: false, ...(s.entersTapped !== undefined ? { entersTapped: s.entersTapped } : {}) } };
      }
      return e;
    });
    return { ...a, emits };
  });
}
