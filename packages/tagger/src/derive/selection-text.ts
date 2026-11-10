import type { Ability, SubjectFilter } from "../schema.js";

/** A RESTRICTION THE STORED OBJECT NO LONGER CARRIES (#1557). The normalizer files "separates all permanents they control into three piles ... sacrifices those permanents" (Whims of the Fates) as
 *  "permanents each player controls", and the grammar cuts "each permanent unless it's colorless or it's only the color its controller chose" (Selective Obliteration) at "unless", so the subject
 *  reads as a bare "every permanent". The clause's printed text still has the words; like `chosenColorOf`, this pass reads them and marks `SubjectFilter.selection` on a bare permanent emit.
 *  Only a bare `permanent` mass (scope all|each, no other narrowing and no marker yet) is touched, and only by a phrase that names the permanents: "<permanents> unless", or a pile in the clause.
 *  CEILING: the clause is the unit, so a clause with a pile elsewhere marks every bare permanent mass in it. */
const UNLESS = /\bpermanents? unless\b/i;
const PILES = /\bpiles?\b/i;
/** "Each player chooses six lands they control. Destroy all other permanents." (Urza's Sylex): "other" is "other than the chosen", not "other than this card" (Gideon, Champion of Justice's "Exile all other permanents" is). */
const OTHER_THAN_CHOSEN = /\bchooses?\b[^.]*\.[^.]*\ball other permanents\b/i;

/** A NUMBER OR A SET THE CARD DEFINED EARLIER IS NOT EVERY PERMANENT (#1577). "Sacrifice any number of permanents" (Renounce, Bontu, Shimatsu), "sacrifice that many permanents" (Lich, Phyrexian Negator, Dralnu), "sacrifice X permanents", "put all permanent
 *  cards exiled with this enchantment" (Journey to the Lost City), "exiled this way" (Deep Space 9) and "all tokens that player controls with the same name" (Legions to Ashes) are chosen subsets: the grammar drops the quantifier from the object, and the bare `permanent` left behind read
 *  as a sweep that proves every subtype. A count is `counted` (the player's pick can be anything of the class, so it still reaches an Aura: matcher aura-reach.ts), a set the card defined earlier is `chosen`, the marker a card's own earlier pick already has (`parseSubject`).
 *  CEILING: the clause is the unit, so a clause that also sweeps ("Exile all permanents. Sacrifice two permanents.") marks its sweep too; and a quantifier word other than these (a spelled-out number above ten, "each of two") is not read. */
const COUNTED_PERMANENTS = /\b(?:any number of|that many|x|\d+|one|two|three|four|five|six|seven|eight|nine|ten) (?:other )?(?:nontoken )?permanents\b/i;
const SET_OF_THE_CARD = /\bpermanent cards? (?:exiled with|exiled this way|revealed this way)\b|\ball tokens\b[^.]*\bsame name\b/i;

// `nameRelation` is a condition the set already is ("all tokens ... with the same name": Legions to Ashes is `chosen`, #1586 carries the relation beside it).
const bare = (s: SubjectFilter): boolean => {
  const types = [s.type].flat();
  const { control: _c, token: _t, type: _ty, scope, other: _o, edictAll: _e, nameRelation: _n, ...rest } = s as SubjectFilter & Record<string, unknown>;
  return types.length === 1 && types[0] === "permanent" && (scope === "all" || scope === "each") && Object.keys(rest).length === 0;
};

export function selectionFromText(abilities: Ability[], clauseTexts: Record<number, string> | undefined, cardText: string): Ability[] {
  return abilities.map((a) => {
    if (!a.emits?.some((e) => bare(e.subject))) return a;
    const text = a.clause === undefined ? cardText : clauseTexts?.[Math.trunc(Number(a.clause))] ?? cardText;
    const selection = UNLESS.test(text) || OTHER_THAN_CHOSEN.test(text) ? "all-but" as const : PILES.test(text) ? "pile" as const
      : COUNTED_PERMANENTS.test(text) ? "counted" as const : SET_OF_THE_CARD.test(text) ? "chosen" as const : undefined;
    if (!selection) return a;
    return { ...a, emits: a.emits.map((e) => (bare(e.subject) ? { ...e, subject: { ...e.subject, selection } } : e)) };
  });
}
