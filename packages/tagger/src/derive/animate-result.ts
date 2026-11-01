/** WHAT AN ANIMATE'S OBJECT BECOMES (#1364): "Target land you control becomes a 3/3 Elemental creature", "All lands are 1/1 creatures", "enchanted creature ... is a blue Fish". Read off the
 *  PRINTED clause, so the stored answer and the grammar's reading state the same result whatever they put in the animate's object (the store writes a self animate's result into its subject
 *  and a target animate's not at all). It is `Effect.becomes`, never the subject: the subject is what is targeted or affected, and `spellTargeting` reads a `scope: target` creature
 *  subject as "aimed at a creature you control" (Brave the Wilds is aimed at a land). */
import { parse } from "../grammar/filter.js";
import type { SubjectFilter } from "../schema.js";

/** Reminder text and quoted abilities are not this object's result ("it gains '{T}: Add {C}'"). */
const strip = (t: string): string => t.replace(/\([^)]*\)/g, " ").replace(/["“][^"“”]*["”]/g, " ");
/** Where the result noun phrase ends: its keywords and riders, a clause break, a "base power and toughness" tail. */
const END = /\s+(?:with|that(?:'s| are| is)|until|for as long as|as long as|in addition|and|it's|they're|has|have|gains?|loses?|unless|if)\b|[,.;:—]/i;
/** An alternative the printed text leaves to a choice: no one result. */
const CHOICE = /\b(?:your choice of|of your choice|the chosen|a copy of|copies of)\b/i;

/** The same, but a LIST goes on: "an Island, a Swamp, and a Forest" (Lush Growth: "a Mountain, Forest, and Plains"). Tried first; the short phrase answers when the long one reads nothing. */
const END_LIST = /\s+(?:with|that(?:'s| are| is)|until|for as long as|as long as|in addition|it's|they're|has|have|gains?|loses?|unless|if)\b|[.;:\u2014]/i;
/** A condition ahead of the result is not it: "As long as enchanted permanent is a Vehicle, it's a creature ..." (Aerial Modification), "During your turn, Gideon Blackblade is a 4/4 ...". */
const CONDITION_LEAD = /(?:^|(?<=[.\n]\s*))(?:[\w\u2014 ]+\u2014\s*)?(?:as long as|if|when|whenever|while|during)\b[^,.]*,\s*/gi;
/** ...and one trailing a sentence: "..., if it's a creature card, put it onto the battlefield" (Summoner's Egg, Clone Shell). */
const CONDITION_TAIL = /,?\s+(?:if|unless)\s+[^.,;]*/gi;

function phraseAfter(text: string, at: number, list = false): string {
  let rest = text.slice(at).replace(/^(?:also\s+|each\s+)?(?:an?|the)\s+/i, "");
  const m = (list ? END_LIST : END).exec(rest);
  if (m) rest = rest.slice(0, m.index);
  return rest.trim();
}

function resultOf(phrase: string, whole: string, longer: string): SubjectFilter | undefined {
  if (phrase === "" || phrase.length > 60) return undefined;
  const read = ((longer !== phrase && longer.length <= 60 && /,/.test(longer) ? parse(longer) : null) ?? parse(phrase)) as SubjectFilter | null;
  if (!read || (read.type === undefined && read.subtype === undefined && read.stats === undefined)) return undefined;
  const out: SubjectFilter = { ...read };
  // A plural ("1/1 Elemental creatures") is still one result, not a class of the deck.
  delete out.scope;
  // "a Rhino with base power and toughness 4/4", "a blue Fish with base power and toughness 0/1": the numbers are in the tail the noun phrase stopped before.
  const base = /\bbase power and toughness (\d+)\/(\d+)\b/i.exec(whole);
  if (out.stats === undefined && base) out.stats = [{ metric: "power", op: "eq", value: Number(base[1]) }, { metric: "toughness", op: "eq", value: Number(base[2]) }];
  return out;
}

/** The result an animate clause states, or undefined when it states none that reads (a colour alone, a creature type of your choice, a copy, two different results). A "becomes" is read before
 *  an "is" / "are" ("if it isn't a creature or Vehicle, it becomes a 0/0 Construct artifact creature"), and the second is only a static's wording ("All lands are 1/1 creatures"). */
export function animateResult(clauseText: string): SubjectFilter | undefined {
  const text = strip(clauseText).replace(CONDITION_LEAD, " ").replace(CONDITION_TAIL, " ");
  if (CHOICE.test(text)) return undefined;
  const found = (verbs: RegExp): SubjectFilter[] => {
    const out: SubjectFilter[] = [];
    for (const m of text.matchAll(new RegExp(verbs.source, "gi"))) {
      const at = m.index + m[0].length;
      const r = resultOf(phraseAfter(text, at), text, phraseAfter(text, at, true));
      if (r) out.push(r);
    }
    return out;
  };
  for (const verbs of [/\bbecomes?\s+/, /\b(?:is|are|it\u2019s|it's|they\u2019re|they're)\s+/]) {
    const all = found(verbs);
    if (all.length === 0) continue;
    // Two animates in a clause with different results (a branch, two targets) are not one result.
    return all.every((r) => JSON.stringify(r) === JSON.stringify(all[0])) ? all[0] : undefined;
  }
  return undefined;
}
