import { describe, expect, test } from "vitest";
import { deriveAbilities, deriveCardTags } from "./derive.js";
import { printsControlChange } from "./emits.js";
import { grammarClauseRecords } from "../grammar/clause-record.js";
import { deriveInputOf } from "../derive-input.js";
import { segment } from "../segment.js";
import type { Ability } from "../schema.js";

// A `gain-control` action is a control change only when its printed clause says one (#1318). Oracle text and stored model clauses read from the corpus 2026-10-22.
const AURA = "Enchantment — Aura";
const via = (name: string, typeLine: string, oracleText: string, clauses: Parameters<typeof deriveAbilities>[0]) => {
  const texts: Record<number, string> = {};
  for (const c of segment(oracleText, [], typeLine)) texts[c.id] = c.text;
  return deriveCardTags({ ...deriveInputOf({ name, typeLine, oracleText, keywords: [] } as never, "x", name, clauses as never), clauseTexts: texts });
};
const viaGrammar = (name: string, typeLine: string, oracleText: string) => {
  const card = { name, typeLine, oracleText, keywords: [] as string[] };
  const g = grammarClauseRecords(card);
  return deriveCardTags(deriveInputOf(card as never, "x", name, g.records, undefined, g.readings));
};
const steals = (abilities: Ability[]) => abilities.filter((a) => (a.emits ?? []).some((e) => e.verb === "gains-control"));
const act = (verb: string, object: string, extra: object = {}) => ({ verb, object, fromZone: null, toZone: null, amount: null, optional: false, ...extra });

describe("gains-control emits need a printed control change (#1318)", () => {
  test("Crown of Awe: 'gain protection' is no control change; both keyword grants stay", () => {
    const oracle = "Enchant creature\nEnchanted creature has protection from black and from red.\nSacrifice this Aura: Enchanted creature and other creatures that share a creature type with it gain protection from black and from red until end of turn.";
    const tags = via("Crown of Awe", AURA, oracle, [
      { id: 1, abilityType: "none", actions: [act("none", "Enchant creature")] },
      { id: 2, abilityType: "static", actions: [act("grant-ability", "protection from black and from red")] },
      { id: 3, abilityType: "activated", actions: [
        act("gain-control", "enchanted creature and other creatures that share a creature type with it"),
        act("grant-ability", "protection from black and from red until end of turn")] },
    ]);
    expect(steals(tags.abilities)).toHaveLength(0);
    expect(tags.abilities.filter((a) => a.effect.kind === "keyword-grant")).toHaveLength(2);
    expect(tags.unclaimed?.some((u) => u.verb === "gain-control" && u.clause === 3)).toBe(true);
  });

  test("Misleading Signpost: a reselected attack is no control change", () => {
    const oracle = "Flash\nWhen this artifact enters during the declare attackers step, you may reselect which player or permanent target attacking creature is attacking. (It can't attack its controller or their permanents.)\n{T}: Add {U}.";
    const tags = via("Misleading Signpost", "Artifact", oracle, [
      { id: 1, abilityType: "none", actions: [act("none", "Flash")] },
      { id: 2, abilityType: "triggered", trigger: { event: "enters", subject: "this artifact", control: "you" }, actions: [act("gain-control", "target attacking creature", { optional: true })] },
      { id: 3, abilityType: "activated", actions: [act("add-mana", "{U}")] },
    ]);
    expect(steals(tags.abilities)).toHaveLength(0);
  });

  test("keepers: Control Magic and Act of Treason (grammar), Gather Specimens, Fealty to the Realm, Opposition Agent, Cruel Entertainment (model)", () => {
    expect(steals(viaGrammar("Control Magic", AURA, "Enchant creature\nYou control enchanted creature.").abilities)).toHaveLength(1);
    expect(steals(viaGrammar("Act of Treason", "Sorcery", "Gain control of target creature until end of turn. Untap that creature. It gains haste until end of turn. (It can attack and {T} this turn.)").abilities)).toHaveLength(1);
    expect(steals(via("Gather Specimens", "Instant", "If a creature would enter the battlefield under an opponent's control this turn, it enters under your control instead.", [
      { id: 1, abilityType: "spell", actions: [act("gain-control", "a creature entering the battlefield under an opponent's control")] }]).abilities)).toHaveLength(1);
    expect(steals(via("Fealty to the Realm", AURA, "Enchant creature\nWhen this Aura enters, you become the monarch.\nThe monarch controls enchanted creature.\nEnchanted creature attacks each combat if able and can't attack you.", [
      { id: 1, abilityType: "none", actions: [act("none", "Enchant creature")] },
      { id: 2, abilityType: "triggered", trigger: { event: "enters", subject: "this Aura", control: "you" }, actions: [act("monarch", "you")] },
      { id: 3, abilityType: "static", actions: [act("gain-control", "enchanted creature")] }]).abilities)).toHaveLength(1);
    expect(steals(via("Opposition Agent", "Creature — Human Rogue", "Flash\nYou control your opponents while they're searching their libraries.", [
      { id: 1, abilityType: "none", actions: [act("none", "Flash")] },
      { id: 2, abilityType: "static", actions: [act("gain-control", "opponent")] }]).abilities)).toHaveLength(1);
    expect(steals(via("Cruel Entertainment", "Sorcery", "Choose target player and another target player. The first player controls the second player during the second player's next turn, and the second player controls the first player during the first player's next turn.", [
      { id: 1, abilityType: "spell", actions: [act("gain-control", "the second player during the second player's next turn"), act("gain-control", "the first player during the first player's next turn")] }]).abilities).length).toBeGreaterThan(0);
  });

  test("exchange control (Switcheroo) still derives its exchange", () => {
    const tags = viaGrammar("Switcheroo", "Sorcery", "Exchange control of two target creatures.");
    expect(tags.abilities.some((a) => (a.emits ?? []).some((e) => e.verb === "exchange"))).toBe(true);
  });

  test("printsControlChange is linear on a long run of spaces (CodeQL js/polynomial-redos)", () => {
    const t0 = performance.now();
    for (const t of [`under${" ".repeat(40_000)}x`, `${" ".repeat(40_000)}controls`, `gains${" ".repeat(40_000)}`, "under ".repeat(8_000)]) printsControlChange(t);
    expect(performance.now() - t0).toBeLessThan(200);
  });
});
