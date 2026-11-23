import { describe, expect, test } from "vitest";
import { deriveCardTags, deriveInputOf } from "../index.js";
import type { CardTags, ClauseRecord } from "../index.js";
import fixtures from "./ascend-1322.fixtures.json" with { type: "json" };

/** #1322. Source documents and clause records are the corpus's own (cards, cardClauses.canonical), dumped from Mongo at DERIVE 582. */
const F = fixtures as unknown as Record<string, { source: Record<string, unknown>; canonical: ClauseRecord[] }>;
const tagsOf = (name: string) => deriveCardTags(deriveInputOf(F[name]!.source as never, name, name, F[name]!.canonical)) as CardTags;
const blessings = (name: string) => tagsOf(name).abilities.filter((a) => (a.emits ?? []).some((e) => e.verb === "city-blessing"));

describe("Ascend (CR 702.131) supplies the city's blessing", () => {
  // 702.131b: on a permanent it is a static ability.
  test.each(["Wayward Swordtooth", "Ocelot Pride"])("%s (permanent): one static, once-only city-blessing emit by you", (name) => {
    const hits = blessings(name);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.kind).toBe("static");
    expect(hits[0]!.repeats).toBe("once");
    expect(hits[0]!.emits).toEqual([{ verb: "city-blessing", subject: { control: "you", token: null } }]);
  });
  // 702.131a: on an instant or sorcery it is a spell ability.
  test.each(["Vona's Hunger", "Golden Demise"])("%s (instant/sorcery): one on-cast, once-only city-blessing emit by you", (name) => {
    const hits = blessings(name);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.kind).toBe("on-cast");
    expect(hits[0]!.repeats).toBe("once");
    expect(hits[0]!.emits).toEqual([{ verb: "city-blessing", subject: { control: "you", token: null } }]);
  });
  test("a card that only becomes the monarch (Court of Ire) emits no city-blessing", () => {
    expect(blessings("Court of Ire")).toEqual([]);
  });
  test("a card that merely READS the blessing without Ascend emits none: Skymarcher Aspirant's keyword removed", () => {
    const src = { ...F["Skymarcher Aspirant"]!.source, keywords: [] as string[] };
    const tags = deriveCardTags(deriveInputOf(src as never, "x", "Skymarcher Aspirant", F["Skymarcher Aspirant"]!.canonical)) as CardTags;
    expect(tags.abilities.some((a) => (a.emits ?? []).some((e) => e.verb === "city-blessing"))).toBe(false);
  });
});
