import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { detectAnswerClasses, detectBuildCategories } from "./build.js";
import { fixtureDeckCard, fixtureNames } from "./fixture-cards.js";

/** THE ROLE RULINGS, CHECKED ON PRODUCTION'S DERIVATION (owner 2026-09-28: a fix no instrument sees
 *  is a case the instruments lack). Each row of `role-expectations.json` is an owner ruling on a
 *  `[role]` issue. `rules.test.ts` pins the printed-text rules with `tags: null`; this reads the card
 *  the way the report does -- stored canonical clauses through `deriveCardTags` -- which is where
 *  Arcane Denial's Draw role comes from, and what a derive regression would break. */
interface RoleExpectation { card: string; has?: string[]; hasNot?: string[]; noAnswers?: true; issue: number; ruling: string }
const ROWS = JSON.parse(readFileSync(new URL("./role-expectations.json", import.meta.url), "utf8")) as RoleExpectation[];

test("the fixture carries every card a role ruling names (regenerate: build-compass-fixture.ts --from-store)", () => {
  expect(ROWS.map((r) => r.card).filter((n) => !fixtureNames.has(n))).toEqual([]);
});

test("every owner role ruling holds on the derived card", () => {
  const broken: string[] = [];
  for (const r of ROWS) {
    const d = fixtureDeckCard(r.card);
    const roles: string[] = [...detectBuildCategories([d])].filter(([, v]) => v.size > 0).map(([k]) => k);
    const answers = [...detectAnswerClasses([d])].filter(([, v]) => v.cards.size > 0).map(([k]) => k);
    for (const x of r.has ?? []) if (!roles.includes(x)) broken.push(`#${r.issue} ${r.card} should be ${x} (${r.ruling})`);
    for (const x of r.hasNot ?? []) if (roles.includes(x)) broken.push(`#${r.issue} ${r.card} should not be ${x} (${r.ruling})`);
    if (r.noAnswers && answers.length > 0) broken.push(`#${r.issue} ${r.card} should answer nothing, answers ${answers.join(", ")}`);
  }
  expect(broken).toEqual([]);
});
