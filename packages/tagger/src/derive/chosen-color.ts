import type { Ability } from "../schema.js";

/** A CHOSEN COLOUR IS NOT A CHOSEN TYPE (#1360). "Creatures you control of the chosen color" (Heraldic Banner),
 *  "a spell of the chosen color" (Prism Ring), "one mana of the chosen color" (Crossroads Village) used to
 *  carry `chosenType: true`, which `matcher/chosen-type.ts` resolves to the deck's top SUBTYPE: a colour
 *  became a creature type. The grammar and `parseSubject` now set `chosenColor` from the words; this pass
 *  is for the reading they do not see, a stored model clause whose prompt gave it only `chosenType`.
 *
 *  A subject's own words are not in the stored record, so the clause that holds the ability decides: it names
 *  a chosen colour and names no chosen type. "of the chosen color and type" (Riptide Replicator, Volrath's
 *  Laboratory, Sarpadian Empires) is both, so it stays `chosenType`.
 *  CEILING: the clause is the unit. A clause naming a colour AND, elsewhere, a type keeps `chosenType` on
 *  every subject in it; no card in the corpus reads that way (59 colour-choice cards, 3 with both, all one phrase). */
const COLOUR = /\bchosen colou?rs?\b|\bthat colou?r\b|\bcolou?r of your choice\b/i;
const TYPE = /\bchosen (?:creature |card |basic land |land )?type\b|\bcolou?r and (?:creature )?type\b|\btype of your choice\b/i;

const recolour = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(recolour);
  if (v === null || typeof v !== "object") return v;
  const o = v as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(o)) {
    if (k === "chosenType" && x === true) out.chosenColor = true;
    else out[k] = recolour(x);
  }
  return out;
};

export function chosenColorOf(abilities: Ability[], clauseTexts: Record<number, string> | undefined, cardText: string): Ability[] {
  return abilities.map((a) => {
    if (!JSON.stringify(a).includes('"chosenType":true')) return a;
    const text = a.clause === undefined ? cardText : clauseTexts?.[Math.trunc(Number(a.clause))] ?? cardText;
    return COLOUR.test(text) && !TYPE.test(text) ? recolour(a) as Ability : a;
  });
}
