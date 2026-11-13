import { describe, expect, test } from "vitest";
import { computeBuild, detectBuildCategories, detectWeakRoles } from "./build.js";
import { NARROW_WEIGHT } from "./narrow-weight.js";
import { realCard } from "./removal-test-support.js";
import rules from "./rules.json" with { type: "json" };

/** OWNER 2026-11-13 (a): WEAK STAX COUNTS AT NARROW_WEIGHT, the same 0.5 as a colour-locked answer. Urza's Sylex ("Each player chooses six lands they control. Destroy all other permanents.") is the case.
 *  Membership stays plain (it is a stax card); the weight is applied where the roles are summed. */
describe("weak stax (owner 2026-11-13)", () => {
  const staxCount = (names: string[]): number => computeBuild(names.map((n) => realCard(n)), undefined).buildCategories.find((c) => c.category === "stax")!.count;

  test("Urza's Sylex is still a stax member, and is the weak one", () => {
    const cards = ["Urza's Sylex", "Armageddon", "Ajani Vengeant", "Burning of Xinye"].map((n) => realCard(n));
    expect([...detectBuildCategories(cards).get("stax")!].sort()).toEqual(["Ajani Vengeant", "Armageddon", "Burning of Xinye", "Urza's Sylex"]);
    expect([...detectWeakRoles(cards).get("stax")!]).toEqual(["Urza's Sylex"]);
  });

  test("the stax count adds NARROW_WEIGHT for Sylex and 1 for full stax", () => {
    expect(staxCount(["Urza's Sylex"])).toBe(NARROW_WEIGHT);
    expect(staxCount(["Urza's Sylex", "Armageddon"])).toBe(1 + NARROW_WEIGHT);
    expect(staxCount(["Armageddon", "Burning of Xinye", "Ajani Vengeant"])).toBe(3);
  });

  test("a weak mark never lowers a card that is also full stax through another rule", () => {
    const sylex = realCard("Urza's Sylex");
    const both = { ...sylex, card: { ...sylex.card, oracleText: `${sylex.card.oracleText}\nPlayers can't cast spells.` } };
    expect(detectWeakRoles([both]).get("stax")?.has("Urza's Sylex") ?? false).toBe(false);
  });

  test("the rule text no longer carries a CEILING for it", () => {
    const stax = (rules as { rules: { id: string; why?: string }[] }).rules.filter((r) => r.id.startsWith("stax"));
    expect(stax.map((r) => r.why ?? "").join(" ")).not.toMatch(/no weak-stax level/);
  });
});
