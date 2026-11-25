import type { Ability, SubjectFilter } from "@edh-seer/tagger";

/** EVERY CLASS A COUNT NAMES, in printed order: `scalingSubject`, then the rest of a summed count (`scalingAlso`, #811: Armix's artifacts you control plus the artifact cards in your graveyard). */
export const countedClassesOf = (e: Ability["effect"]): SubjectFilter[] => e.scalingSubject ? [e.scalingSubject, ...(e.scalingAlso ?? [])] : [];
