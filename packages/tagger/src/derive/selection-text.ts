import type { Ability, SubjectFilter } from "../schema.js";

/** A RESTRICTION THE STORED OBJECT NO LONGER CARRIES (#1557). The normalizer files "separates all permanents they control into three piles ... sacrifices those permanents" (Whims of the Fates) as
 *  "permanents each player controls", and the grammar cuts "each permanent unless it's colorless or it's only the color its controller chose" (Selective Obliteration) at "unless", so the subject
 *  reads as a bare "every permanent". The clause's printed text still has the words; like `chosenColorOf`, this pass reads them and marks `SubjectFilter.selection` on a bare permanent emit.
 *  Only a bare `permanent` mass (scope all|each, no other narrowing and no marker yet) is touched, and only by a phrase that names the permanents: "<permanents> unless", or a pile in the clause.
 *  CEILING: the clause is the unit, so a clause with a pile elsewhere marks every bare permanent mass in it. */
const UNLESS = /\bpermanents? unless\b/i;
const PILES = /\bpiles?\b/i;

const bare = (s: SubjectFilter): boolean => {
  const types = [s.type].flat();
  const { control: _c, token: _t, type: _ty, scope, ...rest } = s as SubjectFilter & Record<string, unknown>;
  return types.length === 1 && types[0] === "permanent" && (scope === "all" || scope === "each") && Object.keys(rest).length === 0;
};

export function selectionFromText(abilities: Ability[], clauseTexts: Record<number, string> | undefined, cardText: string): Ability[] {
  return abilities.map((a) => {
    if (!a.emits?.some((e) => bare(e.subject))) return a;
    const text = a.clause === undefined ? cardText : clauseTexts?.[Math.trunc(Number(a.clause))] ?? cardText;
    const selection = UNLESS.test(text) ? "all-but" as const : PILES.test(text) ? "pile" as const : undefined;
    if (!selection) return a;
    return { ...a, emits: a.emits.map((e) => (bare(e.subject) ? { ...e, subject: { ...e.subject, selection } } : e)) };
  });
}
