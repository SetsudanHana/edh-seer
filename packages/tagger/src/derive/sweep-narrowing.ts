import type { SubjectFilter } from "../schema.js";

/** WHAT NARROWS A MASS REMOVAL BEYOND ITS CLASS (#1586). `parseSubject` reads the nouns of "destroy each nonland permanent with mana value X or less" and drops the rest, so the emit read as the whole type list and the matcher took it for a sweep of every
 *  subtype (`sweepsEveryPermanent`). The filter grammar reads the conditions into fields the schema already has, each one documented on the consumer side: `stats` (a mana value open to the player, `variable`), `shares` ("the same mana value as that permanent",
 *  Mists of Lorien), `history` ("that entered this turn", Renet), `nameRelation` ("with the same name as", Deputy of Detention) and `except` ("that's not historic", Desynchronization). A mass removal keeps them; no new field.
 *
 *  Taken from the grammar's reading of the object only when `parseSubject` has not already read the field, and `except` only when the object is not an "except for" list (Scourglass spares by `notType` / `notSubtype`, #1582).
 *  CEILING: the grammar's reading is trusted as a whole; an object it cannot parse ("that player controls with the same name as that permanent": Deputy of Detention) is covered by the two text cues below only (the same name; the indestructible spare). */
const GRAMMAR_FIELDS = ["stats", "shares", "history", "nameRelation", "except"] as const;
const SAME_NAME = " with the same name as ";
const GAINS_INDESTRUCTIBLE = [" you control gain indestructible", " you control gains indestructible"];
const DESTROYS = ["destroy ", "then destroy "];

/** "Artifacts and planeswalkers you control gain indestructible until end of turn. Destroy all nonland permanents." (Urza, Planeswalker; Fated Clash and Localized Destruction target or count their creatures and spare none by class): the class named before the
 *  grant is spared when it is yours. Sentence by sentence, string tests only; the grant must come BEFORE a sentence that destroys. Returns the class phrase ("artifacts and planeswalkers you control"). */
function indestructibleSpare(clauseText: string): string | undefined {
  const sentences = clauseText.split(". ").map((s) => s.trim());
  for (let i = 0; i < sentences.length - 1; i++) {
    const lower = sentences[i]!.toLowerCase();
    const cue = GAINS_INDESTRUCTIBLE.map((c) => lower.indexOf(c)).filter((at) => at >= 0).sort((a, b) => a - b)[0];
    if (cue === undefined) continue;
    if (!sentences.slice(i + 1).some((s) => DESTROYS.some((d) => s.toLowerCase().startsWith(d)))) continue;
    // The loyalty cost ("−10:") or any "{cost}:" in front is not part of the class.
    const head = sentences[i]!.slice(0, cue + " you control".length);
    return head.slice(head.lastIndexOf(": ") + 1).trim();
  }
  return undefined;
}

const PERMANENT_TYPES = ["creature", "artifact", "enchantment", "planeswalker", "land", "battle"];
/** A mass of the WHOLE permanent set that is on the battlefield: the single type `permanent`, or the six permanent types minus its `notType` (the shape the matcher's `sweepsEveryPermanent` reads, #1577, #1582). Only this shape keeps a condition: the matcher reads an emit
 *  as a FILTER too (a card that "enters thanks to" a mass put is tested against it), and a relation on that filter is a demand nothing can check, so a mass PUT from a graveyard or hand (Faith's Reward, Second Sunrise, Cryptic Gateway, Bloodbond March) and a sweep of one type
 *  (Death-Rattle Oni's damaged creatures, Winnowing's shared type) are left as they were: carrying the relation there lost 65,053 pair reasons on the first build.
 *  CEILING: a sweep of one type with a condition (Death-Rattle Oni, Winnowing, Bounce Chamber) still derives without it; only the whole-set sweep, the one the matcher reads as proving every subtype, carries it. */
export function wholePermanentMass(s: SubjectFilter): boolean {
  if ((s.scope !== "all" && s.scope !== "each") || (s.fromZone !== undefined && s.fromZone !== "battlefield")) return false;
  const types = [s.type].flat().filter((t): t is string => typeof t === "string").map((t) => t.toLowerCase());
  if (types.length === 1 && types[0] === "permanent") return true;
  const left = PERMANENT_TYPES.filter((t) => !(s.notType ?? []).map((n) => n.toLowerCase()).includes(t));
  return left.length > 0 && types.length === left.length && left.every((t) => types.includes(t));
}

export function sweepNarrowing(
  read: SubjectFilter | null,
  subjectText: string,
  clauseText: string | undefined,
  verb: string | undefined,
  parseClass: (text: string) => SubjectFilter,
): Partial<SubjectFilter> {
  const out: Record<string, unknown> = {};
  const lower = subjectText.toLowerCase();
  if (read !== null) {
    const r = read as unknown as Record<string, unknown>;
    for (const k of GRAMMAR_FIELDS) {
      if (r[k] === undefined) continue;
      if (k === "except" && lower.includes(" except")) continue;
      out[k] = r[k];
    }
  }
  if (out.nameRelation === undefined && lower.includes(SAME_NAME)) out.nameRelation = "same";
  if (out.except === undefined && verb === "destroy" && clauseText !== undefined) {
    const phrase = indestructibleSpare(clauseText);
    if (phrase !== undefined) {
      const c = parseClass(phrase);
      if (c.control === "you" && c.type !== undefined && (c.scope === "all" || c.scope === "each")) out.except = [{ type: c.type, control: "you" }];
    }
  }
  return out as Partial<SubjectFilter>;
}
