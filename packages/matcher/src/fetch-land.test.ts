import { expect, test } from "vitest";
import { fetchDemand, fetchableLands, hasBasicLandType } from "./fetch-land.js";

const MYRIAD = "This land enters tapped.\n{T}: Add {C}.\n{2}, {T}, Sacrifice this land: Search your library for up to two basic land cards that share a land type, put them onto the battlefield tapped, then shuffle.";
const WILDS = "{T}, Sacrifice this land: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.";
const CULTIVATE = "Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.";
const land = (name: string, typeLine: string) => ({ name, typeLine });
const WASTES = land("Wastes", "Basic Land");
const ISLAND = land("Island", "Basic Land — Island");
const SNOW_ISLAND = land("Snow-Covered Island", "Basic Snow Land — Island");
const FOREST = land("Forest", "Basic Land — Forest");
const VENTS = land("Steam Vents", "Land — Island Mountain");

/** WASTES HAS NO LAND TYPE TO SHARE (owner, 2026-09-06). Myriad Landscape's two must share one;
 *  Evolving Wilds asks for any basic and Wastes is one. */
test("a shared-type fetch cannot find Wastes; a plain basic fetch can", () => {
  expect(hasBasicLandType("Basic Land")).toBe(false);
  expect(hasBasicLandType("Basic Snow Land — Island")).toBe(true);
  expect(fetchableLands(MYRIAD, [WASTES, WASTES, ISLAND, VENTS]).map((c) => c.name)).toEqual(["Island"]);
  expect(fetchableLands(WILDS, [WASTES, ISLAND, VENTS]).map((c) => c.name)).toEqual(["Wastes", "Island"]);
});

/** "NOT ENOUGH BASICS": one of each basic gives Myriad Landscape one land for its {2}. A snow basic
 *  shares the type with its plain twin; a dual is not basic and does not count. */
test("fetchDemand counts what one activation can return", () => {
  expect(fetchDemand(MYRIAD, [ISLAND, FOREST, WASTES, VENTS])).toEqual({ wants: 2, found: 1, sharedType: true });
  expect(fetchDemand(MYRIAD, [ISLAND, SNOW_ISLAND, FOREST])).toEqual({ wants: 2, found: 2, sharedType: true });
  expect(fetchDemand(CULTIVATE, [ISLAND])).toEqual({ wants: 2, found: 1, sharedType: false });
  expect(fetchDemand(WILDS, [WASTES])).toEqual({ wants: 1, found: 1, sharedType: false });
  expect(fetchDemand("{T}: Add {G}.", [ISLAND])).toBeNull();
});
