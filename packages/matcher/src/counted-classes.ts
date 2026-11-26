import type { Ability, SubjectFilter } from "@edh-seer/tagger";

/** EVERY CLASS A COUNT NAMES, in printed order: `scalingSubject`, then the rest of a summed count (`scalingAlso`, #811: Armix's artifacts you control plus the artifact cards in your graveyard). */
export const countedClassesOf = (e: Ability["effect"]): SubjectFilter[] => e.scalingSubject ? [e.scalingSubject, ...(e.scalingAlso ?? [])] : [];

/** THE ARTIFACTS A COST TAPS ARE A COUNT OF ARTIFACTS YOU CONTROL (owner ruling 2026-11-24, #1804): "Tap X untapped artifacts you control" (Necron Overlord, Shao Jun, Network Terminal) is paid with them, so it asks for artifacts exactly as "for each artifact you control" does,
 *  and the board-count readers read it beside the effect's own classes. A plain artifact only: "artifact creature" and "artifact or creature" (a list of types) are refused here as they are for every other count, and so is a cost that taps another player's.
 *  The derive files the cost line as a blank ability beside the one that has the effect (same cost text): the blank twin is skipped, or the one cost would be said twice. */
export const tapCostClassesOf = (a: Ability, all: readonly Ability[]): SubjectFilter[] => {
  if (a.effect.kind === "" && all.some((b) => b !== a && b.effect.kind !== "" && b.cost === a.cost && b.kind === a.kind)) return [];
  return (a.payment?.tapOther ?? []).flatMap((o) => {
    const s = o.subject;
    if ("self" in s && s.self === true && !("type" in s)) return [];
    const f = s as SubjectFilter;
    const types = Array.isArray(f.type) ? f.type : f.type ? [f.type] : [];
    // "Tap three untapped artifact creatures you control" (Collation Trimatrix, #1813): a CONJUNCTION is its own narrow class, read as such everywhere (`conjunctionKey`).
    if (conjunctionKey(f) !== undefined && f.control === "you" && f.self !== true) return [{ ...f, zone: "battlefield" as const }];
    if (types.length !== 1 || types[0] !== "artifact" || f.control !== "you" || f.subtype !== undefined || f.self === true) return [];
    return [{ ...f, zone: "battlefield" as const }];
  });
};

/** A CONJUNCTION OF TYPES IS ITS OWN NARROW CLASS (owner ruling 2026-11-26, #1813): "artifact creatures you control" (`allTypes: [artifact, creature]`, both types at once) is a minority of the deck although "creature" alone is the whole deck, and it is satisfied
 *  only by what IS, or MAKES, an artifact creature, never by a plain artifact or a plain creature. Its key is the sorted `allTypes` joined by "+" ("artifact+creature"; the comma already means a disjunction in a key slot). Undefined for anything else.
 *  Only a bare conjunction: a subtype, a colour, a name, an alternative ("a black or artifact creature", Soldevi Adnate) or a negation makes it another subject, and a conjunction of whole-deck types alone (creature + land) names no minority.
 *  CEILING: the corpus census (2026-11-26) finds counts, outlets and tap costs over `allTypes` for artifact + creature only; other pairs (creature + enchantment, creature + land, artifact + enchantment) occur only in effects, triggers and token makers, and would read the same way. */
const WHOLE = new Set(["creature", "permanent", "card", "spell", "land"]);
export function conjunctionKey(s: Partial<SubjectFilter> | undefined): string | undefined {
  const all = s?.allTypes;
  if (!s || !Array.isArray(all) || all.length < 2) return undefined;
  if (s.subtype !== undefined || s.colors !== undefined || s.anyOf !== undefined || s.named !== undefined || (s.notType?.length ?? 0) > 0) return undefined;
  if (all.every((t) => WHOLE.has(t))) return undefined;
  return [...all].sort().join("+");
}
