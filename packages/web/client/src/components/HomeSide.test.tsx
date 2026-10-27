import { expect, test } from "vitest";
import { normalizeName } from "@edh-seer/data/names";
import { readBack } from "./HomeSide.js";

/** THE READ-BACK IS THE REPORT'S OWN READING (mockup A, #770): the same parser, names normalised for
 *  the prefetch as `analyzeDecklist` hands them over, and a line the lookup does not know listed
 *  once, as typed. */
test("the list is read as the report reads it: found cards counted, unknown lines named once", async () => {
  const known = new Map(["Krenko, Mob Boss", "Impact Tremors", "Mountain"].map((n) => [normalizeName(n), n]));
  const prefetched: string[][] = [];
  const lookup = {
    prefetch: async (names: string[]) => { prefetched.push(names); },
    findByName: async (n: string) => (known.has(n) ? { name: known.get(n)! } as never : null),
  };
  const r = await readBack("", "Commander\n1 Krenko, Mob Boss\n\nDeck\n1 Impact Tremors\n2 Mountain\n1 Sol Rng\n1 Sol Rng", lookup);
  expect(r.commanders).toEqual(["Krenko, Mob Boss"]);
  expect(r.cards).toBe(4);
  expect(r.missing).toEqual(["Sol Rng"]);
  // Normalised before the prefetch, or every shard key misses (the bug the first cut shipped with).
  expect(prefetched[0]).toContain(normalizeName("Krenko, Mob Boss"));
});

test("the whole list in the Commander box is reported as a problem, as the report refuses it", async () => {
  const lookup = { prefetch: async () => {}, findByName: async () => null };
  const box = Array.from({ length: 5 }, (_, i) => `1 Card ${i}`).join("\n");
  const r = await readBack(box, "", lookup);
  expect(r.problem).toMatch(/Commander box holds 5 cards/);
  expect((await readBack("1 Krenko", "", lookup)).problem).toBeUndefined();
});
