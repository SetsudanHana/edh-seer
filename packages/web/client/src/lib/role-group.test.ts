import { expect, test } from "vitest";
import { BUILD_PARENTS } from "@edh-seer/matcher/build";
import { GAP_WORD_BY_KEY } from "./verdict.js";
import { SECTION_BY_KEY } from "./precon-packages.js";
import { NOUN_BY_KEY, WORD_BY_KEY } from "./precon-upgrades.js";
import { groupKey } from "./role-group.js";

/** THE WORD MAPS ARE KEYED BY `key`, NOT BY THE DISPLAY NAME (#1086 branch review): "Consistency" ->
 *  "Card advantage" silently dropped four maps at once. A parent added or renamed without a word fails here. */
test("every build parent's key has a word in every map that names a role group", () => {
  for (const p of BUILD_PARENTS) {
    expect(groupKey(p.name), `${p.name} does not resolve to its key`).toBe(p.key);
    expect(GAP_WORD_BY_KEY[p.key], `verdict gap word for ${p.key}`).toBeTruthy();
    expect(SECTION_BY_KEY[p.key], `precon section for ${p.key}`).toBeTruthy();
    expect(WORD_BY_KEY[p.key], `precon group word for ${p.key}`).toBeTruthy();
    expect(NOUN_BY_KEY[p.key], `precon group noun for ${p.key}`).toBeTruthy();
  }
});
