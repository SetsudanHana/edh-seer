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
  return pairReasonsAcrossFaces(F[producer]!, F[consumer]!, H).filter((r) => (r.tag === "dies:creature" || r.tag === "dies:aura" || r.tag === "leaves:creature") && r.impliedProducer !== true && hostAbility.has(r.consumerAbility!));
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

describe("an Aura of unknown side keeps main's reading (#1513 stays on the host-death route)", () => {
  // Creature Bond, Funeral March and Minion's Return print a plain "Enchant creature" and do nothing that names a side (`auraHostSide` is undefined): the pair is kept as it was, fed by an opponent's creature dying.
  test.each(["Creature Bond", "Funeral March", "Minion's Return"])("Massacre Wurm -> %s still forms its reason", (aura) => {
    expect(hostDies("Massacre Wurm", aura).length).toBeGreaterThan(0);
  });
  test("an Aura printed 'Enchant creature an opponent controls' (Dead Man's Chest) is fed by Massacre Wurm and not by your own sacrifice", () => {
    expect(hostDies("Massacre Wurm", "Dead Man's Chest").length).toBeGreaterThan(0);
    expect(hostDies("Village Rites", "Dead Man's Chest")).toEqual([]);
  });
});

describe("a creature that is sacrificed by 'its controller' is yours", () => {
  test.each(["Goblin Ski Patrol", "Cauldron Dance", "Killing Wave", "Fade Away"])("%s -> Fungal Fortitude", (producer) => {
    expect(hostDies(producer, "Fungal Fortitude").length).toBeGreaterThan(0);
  });
  test("Fungal Fortitude, Necrosynthesis and Demonic Vigor read as own-side", () => {
    for (const n of ["Fungal Fortitude", "Necrosynthesis", "Demonic Vigor"]) expect(hostDies("Massacre Wurm", n), n).toEqual([]);
  });
});

describe("a host-death trigger that acts on the dead creature's controller is the opponent's side (read from the trigger's own line)", () => {
  // Impending Doom ("deals 3 damage to that creature's controller"), Decomposition ("its controller loses 2 life") and Necrotic Plague ("its controller chooses ...") read own-side by `auraHostSide` (a pump or grant), but are put on an opponent's creature.
  test.each(["Impending Doom", "Decomposition", "Necrotic Plague"])("Massacre Wurm -> %s still forms its reason", (aura) => {
    expect(hostDies("Massacre Wurm", aura).length).toBeGreaterThan(0);
  });
});

describe("an Aura made for an opponent's creature, or one that moves to a host it does not choose, keeps main's reading", () => {
  // Ghoulish Impetus goads its host (a drawback on your own creature, CR 701.15b); Infectious Rage re-attaches "to a creature at random": its next host can be anyone's.
  test.each(["Ghoulish Impetus", "Infectious Rage"])("Massacre Wurm -> %s still forms its reason", (aura) => {
    expect(hostDies("Massacre Wurm", aura).length).toBeGreaterThan(0);
  });
  test("Reins of the Vinesteed re-attaches to a creature of YOUR choice: own-side, Massacre Wurm feeds nothing", () => {
    expect(hostDies("Massacre Wurm", "Reins of the Vinesteed")).toEqual([]);
  });
});
