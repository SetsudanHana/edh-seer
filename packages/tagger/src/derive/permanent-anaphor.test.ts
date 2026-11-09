import { expect, test } from "vitest";
import { permanentAnaphorsResolved } from "./references.js";

const clause = (...objects: string[]) => ({ id: 1, abilityType: "spell", actions: objects.map((object) => ({ verb: "deal-damage", object })) }) as never;
const objects = (c: { actions?: { object?: string }[] }) => (c.actions ?? []).map((a) => a.object);

test("'that permanent' is the earlier typed target of its own clause (#1570)", () => {
  const r = permanentAnaphorsResolved(clause("target creature or planeswalker", "that permanent"), undefined);
  expect(objects(r.clause)).toEqual(["target creature or planeswalker", "target creature or planeswalker"]);
});

test("'a permanent dealt damage by ~' is a class of the card's last typed target, not a target", () => {
  const first = permanentAnaphorsResolved(clause("target creature or planeswalker an opponent controls"), undefined);
  const r = permanentAnaphorsResolved(clause("a permanent dealt damage by Torch the Tower"), first.lastTarget);
  expect(objects(r.clause)).toEqual(["creature or planeswalker an opponent controls"]);
  expect(objects(permanentAnaphorsResolved(clause("a permanent dealt damage this way that would die this turn"), first.lastTarget).clause)).toEqual(["creature or planeswalker an opponent controls"]);
});

test("an antecedent that is not made of type words is not carried, and 'that permanent' with no earlier target in its clause is left alone", () => {
  const c = clause("target permanent card with mana value 3 or less", "that permanent");
  expect(permanentAnaphorsResolved(c, undefined).clause).toBe(c);
  const lone = clause("that permanent");
  expect(permanentAnaphorsResolved(lone, "target creature").clause).toBe(lone);
  const nothing = clause("a permanent dealt damage this way");
  expect(permanentAnaphorsResolved(nothing, undefined).clause).toBe(nothing);
});
