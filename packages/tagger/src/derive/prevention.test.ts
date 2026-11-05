import { describe, expect, it } from "vitest";
import { deriveAbilities } from "./derive.js";
import { damageReplacementOf, preventionOf, redirectsDamage } from "./prevention.js";

/** Stored clause rows, copied from the corpus (cardClauses.clauses, 2026-11-05), and the printed text of each clause. */
const run = (abilityType: string, actions: object[], text: string, name: string, trigger?: object, cost?: string) =>
  deriveAbilities([{ id: 1, abilityType, ...(trigger ? { trigger } : {}), actions }] as never, name, { 1: text }, cost ? { 1: cost } : undefined).abilities;
const kinds = (abs: ReturnType<typeof run>) => abs.map((a) => a.effect.kind);

describe("#1469 prevention (CR 615) and damage-change (CR 614) kinds", () => {
  it("Fog is a prevention of all combat damage this turn, subject unnamed", () => {
    const [a] = run("spell", [{ verb: "prevent", object: "all combat damage that would be dealt this turn" }], "Prevent all combat damage that would be dealt this turn.", "Fog");
    expect(a!.effect.kind).toBe("prevention");
    expect(a!.prevention).toEqual({ damage: "combat", amount: "all", duration: "this-turn" });
    expect(a!.emits?.map((e) => e.verb)).toEqual(["prevented"]);
  });

  it("a mass prevention printed on a trigger keeps the trigger (Leery Fogbeast)", () => {
    const [a] = run("triggered", [{ verb: "prevent", object: "all combat damage that would be dealt this turn" }],
      "Whenever this creature becomes blocked, prevent all combat damage that would be dealt this turn.", "Leery Fogbeast", { event: "becomes-blocked", subject: "this creature", control: "you" });
    expect(a!.effect.kind).toBe("prevention");
    expect(a!.prevention).toMatchObject({ damage: "combat", amount: "all", duration: "this-turn" });
    expect(a!.trigger).toBeDefined();
  });

  it("Circle of Protection: Red prevents the next time a red source deals damage to you", () => {
    const [a] = run("activated", [{ verb: "prevent", object: "the next time a red source of your choice would deal damage to you this turn" }],
      "{1}: The next time a red source of your choice would deal damage to you this turn, prevent that damage.", "Circle of Protection: Red", undefined, "{1}");
    expect(a!.effect.kind).toBe("prevention");
    expect(a!.effect.subject).toMatchObject({ control: "you", player: true });
    expect(a!.prevention).toMatchObject({ damage: "any", amount: "all", duration: "this-turn", from: { colors: ["R"] } });
  });

  it("Heal prevents a shield of 1 to any target; Kor Haven prevents combat damage dealt by a target attacker", () => {
    const [heal] = run("spell", [{ verb: "prevent", object: "the next 1 damage that would be dealt to any target this turn" }], "Prevent the next 1 damage that would be dealt to any target this turn.", "Heal");
    expect(heal!.prevention).toMatchObject({ amount: 1, duration: "this-turn" });
    expect(heal!.effect.subject).toMatchObject({ scope: "target" });
    const [kor] = run("activated", [{ verb: "prevent", object: "all combat damage that would be dealt by target attacking creature this turn" }],
      "{1}{W}, {T}: Prevent all combat damage that would be dealt by target attacking creature this turn.", "Kor Haven", undefined, "{1}{W}, {T}");
    expect(kor!.prevention).toMatchObject({ damage: "combat", amount: "all", from: { type: "creature", scope: "target", combat: "attacking" } });
  });

  it("a static prevention is continuous", () => {
    const [a] = run("static", [{ verb: "prevent", object: "all damage that would be dealt to this creature" }], "Prevent all damage that would be dealt to this creature.", "Wall");
    expect(a!.prevention?.duration).toBe("continuous");
    expect(a!.effect.subject?.self).toBe(true);
  });

  it("Lava Burst's 'can't be prevented or dealt instead' is no prevention", () => {
    const abs = run("spell", [{ verb: "deal-damage", object: "any target", amount: "X" }, { verb: "prevent", object: "damage dealt to a creature by this spell can't be prevented or dealt instead to another permanent or player" }],
      "Lava Burst deals X damage to any target. If Lava Burst would deal damage to a creature, that damage can't be prevented or dealt instead to another permanent or player.", "Lava Burst");
    expect(kinds(abs)).not.toContain("prevention");
    expect(kinds(abs)).not.toContain("damage-change");
  });

  const change = (text: string, name: string, actions: object[], abilityType = "static", trigger?: object) => run(abilityType, actions, text, name, trigger);

  it("Benevolent Unicorn reduces, Lashknife Barrier reduces (stored as a prevent), Ghosts of the Innocent halves", () => {
    const [u] = change("If a spell would deal damage to a permanent or player, it deals that much damage minus 1 to that permanent or player instead.", "Benevolent Unicorn", [{ verb: "deal-damage", object: "a permanent or player", amount: "that much damage minus 1" }]);
    expect(u!.effect).toMatchObject({ kind: "damage-change", damageChange: "reduced" });
    expect(u!.emits ?? []).toEqual([]);
    expect(u!.amount).toBeUndefined();
    const [l] = change("If a source would deal damage to a creature you control, it deals that much damage minus 1 to that creature instead.", "Lashknife Barrier", [{ verb: "prevent", object: "1 damage to a creature you control" }]);
    expect(l!.effect).toMatchObject({ kind: "damage-change", damageChange: "reduced", subject: { control: "you", type: "creature" } });
    expect(l!.emits ?? []).toEqual([]);
    const [g] = change("If a source would deal damage to a permanent or player, it deals half that damage, rounded down, to that permanent or player instead.", "Ghosts of the Innocent", [{ verb: "other", object: "damage dealt to a permanent or player is halved, rounded down" }]);
    expect(g!.effect).toMatchObject({ kind: "damage-change", damageChange: "halved" });
  });

  it("Divine Presence caps, Forethought Amulet caps to you, Equal Treatment fixes", () => {
    const [d] = change("If a source would deal 4 or more damage to a permanent or player, that source deals 3 damage to that permanent or player instead.", "Divine Presence", [{ verb: "deal-damage", object: "that permanent or player", amount: "3" }]);
    expect(d!.effect).toMatchObject({ kind: "damage-change", damageChange: "capped" });
    const [f] = change("If an instant or sorcery source would deal 3 or more damage to you, it deals 2 damage to you instead.", "Forethought Amulet", [{ verb: "deal-damage", object: "you", amount: "2" }]);
    expect(f!.effect).toMatchObject({ kind: "damage-change", damageChange: "capped", subject: { control: "you", player: true } });
    const eq = change("If any source would deal 1 or more damage to a permanent or player this turn, it deals 2 damage to that permanent or player instead.", "Equal Treatment", [{ verb: "deal-damage", object: "a permanent or player", amount: "2" }], "spell");
    expect(eq[0]!.effect).toMatchObject({ kind: "damage-change", damageChange: "fixed" });
    expect(eq[0]!.kind).toBe("on-cast");
  });

  it("Harsh Judgment and Goblin Psychopath redirect; Jade Monolith's prevent is the redirect, its damage keeps the redirect mark", () => {
    const [h] = change("If an instant or sorcery spell of the chosen color would deal damage to you, it deals that damage to its controller instead.", "Harsh Judgment", [{ verb: "deal-damage", object: "its controller", amount: "that damage" }]);
    expect(h!.effect).toMatchObject({ kind: "damage-change", damageChange: "redirected", subject: { control: "you", player: true } });
    const psycho = change("Whenever this creature attacks or blocks, flip a coin. If you lose the flip, the next time it would deal combat damage this turn, it deals that damage to you instead.", "Goblin Psychopath",
      [{ verb: "flip-coin", object: "" }, { verb: "other", object: "if you lose the flip, the next time it would deal combat damage this turn, it deals that damage to you instead" }], "triggered", { event: "attacks", subject: "this creature", control: "you" });
    expect(psycho.map((a) => a.effect.kind)).toContain("damage-change");
    expect(psycho.find((a) => a.effect.kind === "damage-change")!.effect.damageChange).toBe("redirected");
    expect(psycho.find((a) => a.effect.kind === "damage-change")!.trigger?.verbs).toEqual(["attacks"]);
    const jade = change("{1}: The next time a source of your choice would deal damage to target creature this turn, that source deals that damage to you instead.", "Jade Monolith",
      [{ verb: "prevent", object: "damage dealt to target creature" }, { verb: "deal-damage", object: "you", amount: "that damage" }], "activated");
    expect(jade.map((a) => a.effect.kind)).toEqual(["damage-change", ""]);
    expect(jade.flatMap((a) => a.emits ?? []).map((e) => e.verb)).not.toContain("prevented");
  });

  it("a multiplier is unchanged (Furnace of Rath)", () => {
    const [a] = run("static", [{ verb: "double", object: "damage dealt to a permanent or player" }], "If a source would deal damage to a permanent or player, it deals double that damage to that permanent or player instead.", "Furnace of Rath");
    expect(a!.effect).toMatchObject({ kind: "damage-multiplier", damageChange: "twice" });
    expect(a!.replacement).toBe(true);
  });

  it("the readers", () => {
    expect(preventionOf("Prevent all damage that would be dealt to and dealt by target permanent an opponent controls this turn.")).toEqual({ damage: "any", amount: "all", duration: "this-turn" });
    expect(preventionOf("Damage can't be prevented this turn.")).toBeUndefined();
    expect(damageReplacementOf("If a source you control would deal exactly 2 damage to a permanent or player, it deals 3 damage instead.")).toBe("increased");
    expect(damageReplacementOf("If a source would deal damage to a permanent or player, it deals double that damage instead.")).toBeUndefined();
    expect(redirectsDamage("The next time a source of your choice would deal damage to you this turn, instead that source deals that much damage to you and Eye for an Eye deals that much damage to that source's controller.")).toBe(false);
  });
});

describe("#1469 'can't be prevented' is no prevention", () => {
  it("a stored prevent whose clause only forbids prevention stays kindless (Wild Slash, Questing Beast)", () => {
    const abs = run("static", [{ verb: "prevent", object: "combat damage that would be dealt by creatures you control" }], "Combat damage that would be dealt by creatures you control can't be prevented.", "Questing Beast");
    expect(kinds(abs)).not.toContain("prevention");
    expect(kinds(abs)).not.toContain("damage-change");
  });
});
