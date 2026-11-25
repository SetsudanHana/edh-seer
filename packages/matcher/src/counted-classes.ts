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
    if (types.length !== 1 || types[0] !== "artifact" || f.control !== "you" || f.subtype !== undefined || f.self === true) return [];
    return [{ ...f, zone: "battlefield" as const }];
  });
};
