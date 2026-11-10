import type { Ability, GameEvent, SubjectFilter } from "../schema.js";

/** "EXILE THEM, THEN MELD THEM" EXILES THE PAIR, NOT A CLASS (#1582 part 2). The seven melding cards (Graf Rats, Hanweir Battlements, Mishra Claimed by Gix, Titania Voice of Gaea, Vanille Cheerful l'Cie, Urza Lord Protector, Gisela the Broken Blade) say
 *  "if you both own and control this and a creature named X, exile them, then meld them into Y" (CR 701.42a: put the two cards onto the battlefield combined). The two cards are THIS card and the one the condition names: a set the card defined, not a class.
 *  The object text read as one anyway: "Graf Rats and Midnight Scavengers" a mass of creatures (`scope: all`), "Mishra and Phyrexian Dragon Engine" the subtypes Phyrexian and Dragon, "Brisela, Voice of Nightmares" a mass of Nightmares, so a token payoff and a mass-leave payoff
 *  heard the pair. The exile and its leave become `selection: chosen` with no class and no scope (the rest of the pair's conditions is the clause's, not a filter); the melded permanent's `enters` keeps nothing the result's NAME suggested (type, subtype, scope, name), and
 *  keeps the control and what the clause says of its entry (Mishra's "enters tapped and attacking"). The meld pair itself is the `meld` relation (edges.ts `meldReason`), which reads Scryfall's meld parts, not these events.
 *  CEILING: the pair's own leave is a real zone change for a "whenever a creature leaves the battlefield" payoff; it is dropped here (owner brief of #1582), so such a payoff does not hear a melding card's own exile.
 *  Detected by the printed clause text "meld them" (a string test); a clause without it is untouched. */
const MELD_THEM = "meld them";

const pairSubject = (s: SubjectFilter): SubjectFilter => ({ control: s.control, token: null, selection: "chosen" });
const resultSubject = (s: SubjectFilter): SubjectFilter => ({ control: s.control, token: s.token, ...(s.entersTapped !== undefined ? { entersTapped: s.entersTapped } : {}) });

export function meldPair(abilities: Ability[], clauseTexts: Record<number, string> | undefined): Ability[] {
  return abilities.map((a) => {
    if (a.clause === undefined || !a.emits?.length) return a;
    const text = clauseTexts?.[Math.trunc(Number(a.clause))];
    if (text === undefined || !text.toLowerCase().includes(MELD_THEM)) return a;
    const emits = a.emits.map((e): GameEvent => {
      if (e.verb === "exiled" || e.verb === "leaves") return { ...e, subject: pairSubject(e.subject) };
      if (e.verb === "enters") return { ...e, subject: resultSubject(e.subject) };
      return e;
    });
    return { ...a, emits };
  });
}
