import { expect, test } from "vitest";
import { deriveAbilities } from "./derive.js";

/** A TEMPORARY TOKEN LEAVES, ON THE ABILITY THAT MADE IT (overview persona rounds 2026-09-25, item 4):
 *  Inalla's copy token is exiled at the next end step, and Dour Port-Mage ("whenever one or more other
 *  creatures you control leave the battlefield without dying") never heard of it -- the rider was only
 *  a `temporary` flag. The leaving is now an EMIT on the same token-making ability (never a second
 *  ability: that doubled every trigger reason, +187 rows on 2026-09-16). Exiled tokens LEAVE;
 *  sacrificed ones DIE (CR 700.4). */
const flameshadow = "Whenever a nontoken creature enters under your control, you may pay {R}. If you do, create a token that's a copy of that creature. That token gains haste. Exile it at the beginning of the next end step.";

test("an end-step exile makes the token leave, from the same ability", () => {
  const { abilities } = deriveAbilities(
    [{ id: 1, abilityType: "triggered", trigger: { event: "enters", subject: "a nontoken creature", control: "you" },
      actions: [{ verb: "create", object: "a token that's a copy of that creature" }, { verb: "grant-ability", object: "haste" }, { verb: "exile", object: "it", toZone: "exile" }] }],
    "Flameshadow Conjuring", { 1: flameshadow }, undefined, flameshadow,
  );
  const maker = abilities.filter((a) => a.effect.kind === "token-generation");
  expect(maker).toHaveLength(1);
  const leaving = (maker[0]!.emits ?? []).filter((e) => e.verb === "leaves" || e.verb === "dies");
  expect(leaving.map((e) => [e.verb, e.subject.token])).toEqual([["leaves", true]]);
});

test("a token sacrificed at end of combat dies", () => {
  const geist = "Whenever Geist of Saint Traft attacks, create a 4/4 white Angel creature token with flying that's tapped and attacking. Sacrifice that token at end of combat.";
  const { abilities } = deriveAbilities(
    [{ id: 1, abilityType: "triggered", trigger: { event: "attacks", subject: "Geist of Saint Traft" },
      actions: [{ verb: "create", object: "a 4/4 white Angel creature token with flying that's tapped and attacking" }, { verb: "sacrifice", object: "that token" }] }],
    "Geist of Saint Traft", { 1: geist }, undefined, geist,
  );
  const maker = abilities.find((a) => a.effect.kind === "token-generation")!;
  expect((maker.emits ?? []).filter((e) => e.verb === "dies").map((e) => e.subject.token)).toEqual([true]);
});
