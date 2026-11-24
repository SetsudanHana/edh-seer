import { expect, test } from "vitest";
import { abilityTermsOf, abilityTermsOfFilters, needsAcrossNote } from "./ability-scope.js";
import type { Query } from "./query.js";

const ab = (f: string) => f.startsWith("tags.abilities.");
const has = (field: string, value = "x"): Query => ({ field, op: "has", value });

test("a typed query needs its ability terms together: and adds, or takes the widest branch, not is its inner term", () => {
  const a = has("tags.abilities.kind"), b = has("tags.abilities.emits.verb"), plain = has("st", "elf");
  expect(abilityTermsOf(a, ab)).toBe(1);
  expect(abilityTermsOf({ and: [a, b, plain] }, ab)).toBe(2);
  expect(abilityTermsOf({ or: [a, b] }, ab)).toBe(1);
  expect(abilityTermsOf({ and: [{ or: [a, b] }, { not: a }] }, ab)).toBe(2);
  expect(abilityTermsOf({ and: [a, { op: "event", side: "makes", key: "dies|creature|-|-" }] }, ab)).toBe(1);
  expect(abilityTermsOf(plain, ab)).toBe(0);
});

test("builder rows: all the any-of values of one field are one term; the note starts at two", () => {
  const f = (op: "must" | "any" | "not", field: string, value = "v") => ({ field, op, value }) as const;
  expect(abilityTermsOfFilters([f("any", "tags.abilities.kind", "a"), f("any", "tags.abilities.kind", "b")], ab)).toBe(1);
  expect(abilityTermsOfFilters([f("must", "tags.abilities.kind"), f("not", "tags.abilities.kind"), f("must", "read")], ab)).toBe(2);
  expect(abilityTermsOfFilters([{ field: "tags.abilities.count.floor", op: "range", min: 1 }], ab)).toBe(1);
  expect(needsAcrossNote(1)).toBe(false);
  expect(needsAcrossNote(2)).toBe(true);
});

test("an ability( … ) group is ONE term toward the note, and adds nothing inside itself (#1786 review)", () => {
  const a = has("tags.abilities.kind"), b = has("tags.abilities.emits.verb");
  expect(abilityTermsOf({ ability: { and: [a, b] } }, ab)).toBe(1);
  expect(abilityTermsOf({ and: [{ ability: a }, b] }, ab)).toBe(2);
  expect(abilityTermsOf({ and: [{ ability: { and: [a, b] } }, has("st", "elf")] }, ab)).toBe(1);
});
