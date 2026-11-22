import { describe, expect, test } from "vitest";
import { deriveCardTags, deriveInputOf } from "@edh-seer/tagger";
import type { CardTags, ClauseRecord } from "@edh-seer/tagger";
import { loadHierarchy, pairReasons } from "./index.js";
import type { DeckCard } from "./types.js";
import fixtures from "./fixtures/face-down-1682.json" with { type: "json" };

/** #1682: a card put onto the battlefield face down (manifest, manifest dread, cloak, "put ... onto the battlefield face down") has no abilities, because it is turned face down BEFORE it enters (CR 708.3: "the permanent's
 *  enters-the-battlefield abilities won't trigger"). So the put cannot satisfy a SELF trigger ("When this creature enters"), whose card is the one being put. A CLASS trigger ("Whenever another creature enters") watches the 2/2 that
 *  enters, so it still hears the put. Production fixtures: the card documents and the stored `cardClauses.canonical`, dumped from Mongo 2026-11-22 (DERIVE 577). */
const F = fixtures as unknown as Record<string, { source: Record<string, unknown>; canonical: ClauseRecord[] }>;
const dc = (name: string): DeckCard => ({
  card: F[name]!.source as unknown as DeckCard["card"],
  tags: deriveCardTags(deriveInputOf(F[name]!.source as never, name, name, F[name]!.canonical)) as CardTags,
});
const H = loadHierarchy();
const entersTags = (producer: string, consumer: string) => pairReasons(dc(producer), dc(consumer), H).map((r) => r.tag).filter((t) => t.startsWith("enters:"));
const putEmits = (name: string) => (dc(name).tags?.abilities ?? []).flatMap((a) => a.emits ?? []).filter((e) => e.verb === "enters" && e.subject.self !== true).map((e) => e.subject);

const FACE_DOWN_PRODUCERS = ["Temur War Shaman", "Formless Nurturing", "Unsettling Twins", "Experimental Lab // Staff Room", "Moldering Gym // Weight Room", "The Cyber-Controller", "Death in Heaven"];
const SELF_ETB = ["Wall of Omens", "Palinchron", "Solemn Simulacrum"];

describe("a face-down put is marked face-down", () => {
  test.each(FACE_DOWN_PRODUCERS)("%s: every put emit says face-down", (producer) => {
    // Moldering Gym also fetches a basic land face up (its other door): only the creature put is the face-down one.
    const puts = putEmits(producer).filter((s) => s.type !== "land");
    expect(puts.length).toBeGreaterThan(0);
    for (const s of puts) expect(s.status).toContain("face-down");
  });
  test("Reanimate's put is face up", () => {
    const puts = putEmits("Reanimate");
    expect(puts.length).toBeGreaterThan(0);
    for (const s of puts) expect(s.status ?? []).not.toContain("face-down");
  });
});
describe("a stored cloak the printed clause never words is no face-down put", () => {
  // The Foretold Soldier's "exile it face down. It becomes foretold" is stored with a `cloak` action beside the exile: the printed clause says nothing of cloaking, so its `enters` is not stamped face-down.
  test("The Foretold Soldier's enters emit is not marked face-down", () => {
    const enters = (dc("The Foretold Soldier").tags?.abilities ?? []).flatMap((a) => a.emits ?? []).filter((e) => e.verb === "enters");
    expect(enters.length).toBeGreaterThan(0);
    for (const e of enters) expect(e.subject.status ?? []).not.toContain("face-down");
  });
});
describe("a face-down put satisfies no self enters trigger (CR 708.3)", () => {
  for (const producer of FACE_DOWN_PRODUCERS) {
    test.each(SELF_ETB)(`${producer} -> %s: no enters reason`, (consumer) => {
      expect(entersTags(producer, consumer)).toEqual([]);
    });
  }
});
describe("a face-down put still satisfies a class enters trigger", () => {
  test.each(["Experimental Lab // Staff Room", "Moldering Gym // Weight Room", "The Cyber-Controller", "Death in Heaven"])("%s -> Soul Warden", (producer) => {
    expect(entersTags(producer, "Soul Warden")).not.toEqual([]);
  });
});
describe("an ordinary put is unchanged", () => {
  test.each(SELF_ETB)("Reanimate -> %s keeps its enters reason", (consumer) => {
    expect(entersTags("Reanimate", consumer)).not.toEqual([]);
  });
});

/** Yedora's put is "return it to the battlefield face down ... It's a Forest land. (It has no other types or abilities.)": a face-down LAND, so a "face-down creature enters" consumer (Kadena) never hears it, while a "face-down permanent enters" one does. */
describe("a face-down put that is a land is no face-down creature", () => {
  test("Yedora's put is a Forest land, face-down", () => {
    const puts = putEmits("Yedora, Grave Gardener");
    expect(puts.length).toBeGreaterThan(0);
    for (const s of puts) { expect(s.type).toBe("land"); expect(s.subtype).toBe("forest"); expect(s.status).toContain("face-down"); }
  });
  test("Yedora -> Kadena: no enters reason", () => {
    expect(entersTags("Yedora, Grave Gardener", "Kadena, Slinking Sorcerer")).toEqual([]);
  });
  test.each(["Cryptid Inspector", "Threats Around Every Corner"])("Yedora -> %s (a face-down permanent): still heard", (consumer) => {
    expect(entersTags("Yedora, Grave Gardener", consumer)).not.toEqual([]);
  });
});
