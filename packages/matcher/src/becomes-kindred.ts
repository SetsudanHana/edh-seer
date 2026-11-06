import type { CardTags, SubjectFilter } from "@edh-seer/tagger";
import { CREATURE_SUBTYPES } from "@edh-seer/tagger/subtypes";

/** WHAT AN ANIMATE MAKES A CARD, as a kindred (#1364 part 2). `Effect.becomes` is the result of an animate: "This artifact becomes a 1/1 Soldier artifact creature", "target land you control becomes a
 *  3/3 Elemental creature". While that permanent is a creature it IS that kindred, so a lord that names the kindred reaches it and a count of the kindred counts it. The card's PRINTED characteristics
 *  say none of that (Boros Keyrune is an Artifact), so a kindred reader asks these shapes after the printed one fails.
 *
 *  READ ONLY BY THE KINDRED READERS in `edges.ts` (a lord's recipients, a board count), never by `spellTargeting` or any reader that aims: `becomes` is not a subject and a land that becomes an Elemental is
 *  still not a creature the spell targets (Brave the Wilds). The shape is the card's own printed one with the result's creature types ADDED, so every other field a consumer asks of the card still comes
 *  from its printed characteristics.
 *
 *  WHICH ANIMATES COUNT: the result states a creature type AND a creature subtype (a bare "creature" names no kindred, and reading it would mesh every animator with every creature-type-less lord);
 *  not an Aura's host (an enchanted creature is not this card's permanent, and its controller is often the opponent); and only the card itself or a permanent YOU control (an animate of `any` lands, Living
 *  Plane, animates the opponent's too, and a clause that does not say whose is not read as ours). A land type ("becomes an Island") and a spell or Aura subtype are no creature type.
 *  ONLY A LASTING ANIMATE MAKES A KINDRED (owner 2026-11-06): `Effect.becomesLasts`, read off the clause by derive. "Until end of turn" animates (man-lands, Keyrunes, the Gideons, Kamahl's Will) make none; "for as long
 *  as", "until your next turn" and a change with no stated duration do.
 *  CEILING: TIMED MAKES NO KINDRED, AND AN UNKNOWN DURATION COUNTS AS TIMED (owner 2026-11-06): a card whose clause cannot be read for its duration, or carries any "until" but "until your next turn", is refused, so a
 *  permanent change with a timed rider in its clause is missed. A static whose effect only applies on your turn (Bello) lasts as long as the static does.
 *  THE LORD'S SIDE IS REFUSED WHERE ITS STORED SUBJECT CANNOT BE TRUSTED (Opus review of #1364; the stored subjects are the defects, see issue-1364-subjects): a grant with a zone (`fromZone` / `zone`: Ashling's evoke for
 *  Elemental spells cast from your hand), a grant that works off the battlefield (unearth, evoke, flashback ...: Solemn Doomguide), a host-scoped static (an Equipment's "Equipped creature is a Wizard"), a static
 *  with a threshold (Skyknight Squire's own "is a Knight" with three counters, stored as a Knight lord), and a granted ENTERS trigger (an animated permanent is already on the battlefield). These lose
 *  the true lords they would also have refused. */
const CREATURE_TYPES: ReadonlySet<string> = new Set(CREATURE_SUBTYPES);
const list = (v: string | string[] | undefined): string[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

export interface AnimatedKindred {
  /** The printed shape with the result's creature types added: what a kindred consumer is matched against. */
  shape: SubjectFilter;
  /** The same shape WITHOUT the result's creature types (its types added, its printed subtypes kept): a consumer this one meets is reached by the TYPE ("artifact creatures you control"), not by the kindred. */
  typed: SubjectFilter;
  /** The result's creature types (lowercase), for the sentence. */
  kinds: string[];
  /** The animate is of the card itself ("this artifact becomes ..."), not of a permanent it targets or counts. */
  self: boolean;
}

/** The kindreds a card's animates make. `printed` is the card's own printed shape (`characteristicsSubject`), used ONLY for an animate of the CARD ITSELF. A TARGET or CLASS animate is shaped by the object it
 *  animates, never by the animator: `subject.type` plus the result, control you ("target land you control becomes a 3/3 Elemental creature" makes a land that is an Elemental creature of 3/3; Noyan Dar, a
 *  4/4 creature, animates a land, so Bello's "4/4 ... mana value 4 or greater" must not meet Noyan Dar's own printed numbers). One entry per animate that states a creature subtype. */
export function animatedKindreds(tags: CardTags, printed: SubjectFilter): AnimatedKindred[] {
  const out: AnimatedKindred[] = [];
  for (const a of tags.abilities) {
    const becomes = a.effect.kind === "animate" ? a.effect.becomes : undefined;
    if (becomes === undefined || a.host === true || a.effect.becomesLasts !== true) continue;
    const subject = a.effect.subject;
    const self = subject?.self === true;
    if (!self && subject?.control !== "you") continue;
    const kinds = list(becomes.subtype).filter((t) => CREATURE_TYPES.has(t));
    if (kinds.length === 0 || !list(becomes.type).includes("creature")) continue;
    // The base power / toughness the result sets, read against a consumer's stat predicates (a missing stat reads 0, `subjectMatches`).
    const stat = (metric: string): number | undefined => becomes.stats?.find((p) => p.metric === metric && p.op === "eq")?.value as number | undefined;
    const power = stat("power"), toughness = stat("toughness");
    const object: SubjectFilter = self
      ? (({ allTypes: _a, ...rest }) => rest)(printed)
      : { control: "you", token: null, ...(subject?.type !== undefined ? { type: subject.type } : {}), ...(subject?.subtype !== undefined ? { subtype: subject.subtype } : {}) };
    const types = [...new Set([...list(object.type), ...list(becomes.type)])];
    const base = { ...object, type: types, ...(power !== undefined ? { power } : {}), ...(toughness !== undefined ? { toughness } : {}) };
    out.push({
      shape: { ...base, subtype: [...new Set([...list(object.subtype), ...kinds])] },
      typed: { ...base, ...(object.subtype !== undefined ? { subtype: object.subtype } : {}) },
      kinds,
      self,
    });
  }
  return out;
}

/** The kindred of `k` that `consumer` is reached by: one of its result types satisfies the consumer, and the consumer is NOT already satisfied without them (a lord of "Artifact creatures and Heroes", Cid,
 *  is met by an animated artifact's TYPE, which is no kindred supply). `meets` is the caller's `subjectMatches` over the hierarchy. */
export function kindredReaching(k: AnimatedKindred, consumer: SubjectFilter, meets: (shape: SubjectFilter, consumer: SubjectFilter) => boolean): string | undefined {
  if (meets(k.typed, consumer)) return undefined;
  return k.kinds.find((t) => meets({ ...k.shape, subtype: t }, consumer));
}

/** Does this consumer subject NAME a kindred (a creature subtype, in the subject or an `anyOf` branch)? A bare type ("creatures you control") is every creature, not a kindred, and is not fed by an animate. */
export function namesKindred(s: SubjectFilter): boolean {
  return list(s.subtype).some((t) => CREATURE_TYPES.has(t)) || (s.anyOf ?? []).some((b) => namesKindred({ ...s, anyOf: undefined, ...b }));
}
