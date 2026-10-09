import { BUILD_PARENTS } from "@edh-seer/matcher/build";

/** A role group's KEY from the name the report shows (#1086 branch review). Word maps are keyed by `key`
 *  so renaming the display text cannot silently drop one; the places that hold only a name (a finding id
 *  `build:<name>`, a persisted precon `gaps[].group`) resolve it here, once. Undefined for an unknown name. */
export const groupKey = (name: string): string | undefined => BUILD_PARENTS.find((p) => p.name === name)?.key;
