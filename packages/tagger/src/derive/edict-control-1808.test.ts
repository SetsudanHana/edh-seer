import { describe, expect, test } from "vitest";
import { deriveAsCorpus } from "../derive-worker.js";
import { actionRecipients } from "./recipient.js";
import fixtures from "./edict-control-1808.fixtures.json" with { type: "json" };

/** #1808: A SACRIFICE'S CONTROL FOLLOWS THE ACTOR WHO SACRIFICES. The derive wrote `control: "you"` for a third-person sacrifice whose actor the cue table did not know ("each foe", "that creature's controller", "target creature's controller", "unless they sacrifice"), so an
 *  edict read as your own cost and fed fodder pairs (#1805 review: Pir's Whim, Torment of Venom, Maarika). Stored documents and clauses of the production corpus, 2026-11-25. */
type Fx = { source: Record<string, unknown>; canonical?: unknown[]; segmentHash?: string };
const rowOf = (name: string) => {
  const f = (fixtures as unknown as Record<string, Fx>)[name]!;
  return deriveAsCorpus({ doc: { oracleId: name, name, canonical: f.canonical ?? [], segmentHash: f.segmentHash } as never, source: f.source, isToken: false });
};
/** Every sacrifice emit of the card: its control, and whether the victim may decline. */
const sacrifices = (name: string) => rowOf(name).tags.abilities.flatMap((a) => (a.emits ?? []).filter((e) => e.verb === "sacrifice").map((e) => ({ control: e.subject.control, victimMay: e.victimMay === true })));
const text = (name: string) => String((fixtures as unknown as Record<string, Fx>)[name]!.source.oracleText);

describe("a third-person sacrifice is the opponent's or anyone's, not yours", () => {
  test.each([
    ["Pir's Whim", "Each foe sacrifices an artifact or enchantment of their choice.", "opp"],
    ["Virtus's Maneuver", "Each foe sacrifices a creature of their choice.", "opp"],
    ["Maarika, Brutal Gladiator", "that creature's controller sacrifices a noncreature, nonland permanent.", "any"],
    ["Mercy Killing", "Target creature's controller sacrifices it", "any"],
    ["Parasitic Implant", "enchanted creature's controller sacrifices it", "any"],
    ["Burning Sands", "that creature's controller sacrifices a land of their choice.", "any"],
    ["Reweave", "Target permanent's controller sacrifices it.", "any"],
    ["Innocent Blood", "Each player sacrifices a creature of their choice.", "any"],
  ])("%s (%s) -> %s", (name, printed, control) => {
    expect(text(name)).toContain(printed);
    expect(sacrifices(name).map((s) => s.control)).toEqual([control]);
  });
  test("Torment of Venom: 'unless they sacrifice' is its controller's option (they = its controller, an opponent's)", () => {
    expect(text("Torment of Venom")).toContain("Its controller loses 3 life unless they sacrifice another nonland permanent");
    expect(sacrifices("Torment of Venom")).toEqual([{ control: "opp", victimMay: true }]);
  });
});

describe("your own sacrifice stays yours", () => {
  test("Deadly Dispute (an additional cost), Celestial Sword ('its controller' of a target you control)", () => {
    expect(text("Deadly Dispute")).toContain("As an additional cost to cast this spell, sacrifice an artifact or creature.");
    expect(sacrifices("Deadly Dispute").map((s) => s.control)).toEqual(["you"]);
    expect(text("Celestial Sword")).toContain("Target creature you control gets +3/+3 until end of turn. Its controller sacrifices it");
    expect(sacrifices("Celestial Sword").map((s) => s.control)).toEqual(["you"]);
  });
  test("an own cost beside an edict keeps both: Dusk Mangler (cost: you; each opponent: opp), Shattergang Brothers", () => {
    expect(sacrifices("Dusk Mangler").map((s) => s.control)).toEqual(["you", "opp"]);
    expect(sacrifices("Shattergang Brothers").map((s) => s.control)).toEqual(["you", "opp", "you", "opp", "you", "opp"]);
  });
});

test("the cue reads the printed words: 'each foe', 'that creature's controller', 'unless they sacrifice'", () => {
  expect(actionRecipients("Each foe sacrifices an artifact or enchantment of their choice.")).toEqual({ sacrifice: "opp" });
  expect(actionRecipients("Whenever a creature dies, that creature's controller sacrifices a land of their choice.")).toEqual({ sacrifice: "any" });
  expect(actionRecipients("Put three -1/-1 counters on target creature. Its controller loses 3 life unless they sacrifice another nonland permanent of their choice or discard a card.").sacrifice).toBe("opp");
  // "unless YOU sacrifice" is yours, and a sacrifice cost with no actor is untouched.
  expect(actionRecipients("At the beginning of your upkeep, sacrifice this creature unless you sacrifice a land.")).not.toHaveProperty("sacrifice", "opp");
  expect(actionRecipients("As an additional cost to cast this spell, sacrifice an artifact or creature.")).toEqual({});
});
