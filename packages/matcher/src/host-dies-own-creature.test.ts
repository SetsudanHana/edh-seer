import { describe, expect, test } from "vitest";
import { pairReasonsAcrossFaces } from "./edges.js";
import type { DeckCard, Hierarchy } from "./types.js";
import fixtures from "./host-dies-own-creature.fixtures.json" with { type: "json" };

/** "WHEN ENCHANTED / EQUIPPED CREATURE DIES" ON AN AURA OR EQUIPMENT YOU PUT ON YOUR OWN CREATURE (#736, owner 2026-11-16). The host is a creature you control, so what feeds it is
 *  whatever can kill YOURS (a sacrifice outlet, a self-sacrifice, a board wipe); a producer that can only kill an opponent's creatures (Massacre Wurm, "Destroy target creature an
 *  opponent controls") feeds nothing. An Aura on an opponent's creature keeps the #1513 reading (aura-host-control.test.ts). Fixtures are STORED rows (`cardTagsDerived`).
 *  A producer's OWN death (`impliedProducer`) is left out: any creature can wear the Aura, so Massacre Wurm dying is a creature of yours dying whatever its text says. */
const F = fixtures as unknown as Record<string, DeckCard>;
const H: Hierarchy = {};
/** Only reasons into the card's HOST-death trigger (`trigger.host`): Necrosynthesis also GRANTS "Whenever another creature dies, put a +1/+1 counter", which an opponent's death does feed. */
const hostDies = (producer: string, consumer: string) => {
  const hostAbility = new Set(F[consumer]!.tags!.abilities.flatMap((a, i) => (a.trigger?.host === true ? [i] : [])));
  return pairReasonsAcrossFaces(F[producer]!, F[consumer]!, H).filter((r) => (r.tag === "dies:creature" || r.tag === "dies:aura") && r.impliedProducer !== true && hostAbility.has(r.consumerAbility!));
};
test.each(["Fungal Fortitude", "Necrosynthesis", "Demonic Vigor", "Skullclamp", "Kaya's Ghostform"])("%s has a host-death trigger", (n) => {
  expect(F[n]!.tags!.abilities.some((a) => a.trigger?.host === true)).toBe(true);
});
const OWN_HOSTS = ["Fungal Fortitude", "Necrosynthesis", "Demonic Vigor", "Skullclamp", "Kaya's Ghostform"];

describe("a producer that can only kill an opponent's creatures feeds no host-dies trigger", () => {
  test.each(["Massacre Wurm", "Summon: Primal Odin", "Suspended Sentence", "Oath of Liliana"])("%s -> every own-side host-dies card: none", (producer) => {
    for (const consumer of OWN_HOSTS) expect(hostDies(producer, consumer), `${producer} -> ${consumer}`).toEqual([]);
  });
});

describe("a producer that can kill YOUR creature still does", () => {
  test.each(["Murder", "Withering Torment"])("%s (an unrestricted target, stored opp, aimable at your own creature) -> Fungal Fortitude", (producer) => {
    expect(hostDies(producer, "Fungal Fortitude").length).toBeGreaterThan(0);
  });
  test.each(["Village Rites", "Plaguecrafter", "Toxic Deluge", "Cacophony Unleashed"])("%s -> Fungal Fortitude, Skullclamp", (producer) => {
    for (const consumer of ["Fungal Fortitude", "Skullclamp"]) expect(hostDies(producer, consumer).length, `${producer} -> ${consumer}`).toBeGreaterThan(0);
  });
});
