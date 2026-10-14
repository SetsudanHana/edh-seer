import { ROLE_PARENTS } from "@edh-seer/matcher/role-parents";
import type { DeckReport } from "../types.js";

/** A role group's KEY from a NAME, for the one place that still holds only a name: a persisted precon
 *  `gaps[].group` (#1086). Everything built from a report carries the key already and selects by it
 *  (#1194): a finding id is `build:<key>`, a slack row has `key`. Undefined for an unknown name. */
export const groupKey = (name: string): string | undefined => ROLE_PARENTS.find((p) => p.name === name)?.key;

/** The finding id of a build parent, the one spelling (`build:<key>`). */
export const buildFindingId = (key: string): string => `build:${key}`;

/** The leaves of the build parent a slack row is about, found by KEY. */
export function slackLeaves(report: Pick<DeckReport, "buildParents">, s: { key: string; category: string }): readonly string[] {
  return report.buildParents?.find((p) => p.key === s.key)?.leaves ?? [s.category];
}

/** Finding ids a run snapshot saved BEFORE #1194 holds, `build:<display name>`, read as the key ids. */
export function currentFindingId(id: string): string {
  const key = ROLE_PARENTS.find((p) => id === `build:${p.name}`)?.key;
  return key ? buildFindingId(key) : id;
}
