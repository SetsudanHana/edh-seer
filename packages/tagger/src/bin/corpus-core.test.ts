import { expect, test } from "vitest";
import { selectUntagged, renderPreamble, cardTagsFromRawAbilities, missingOracleIds, coverageReport, sample, expectsAbilities } from "./corpus-core.js";
import type { CardDoc } from "@mtg/data";
import { SCHEMA_VERSION } from "../schema.js";
import { PROMPT_VERSION } from "../llm/prompt.js";

const doc = (o: Partial<CardDoc> & { _id: string }): CardDoc => ({
  name: o._id, typeLine: "Creature", oracleText: "Draw a card.", keywords: [], colors: [],
  manaValue: 1, colorIdentity: [], power: null, toughness: null,
  tags: { produces: [], cares: [] }, searchNames: [], ...o,
});

test("selectUntagged skips done ids and empty-text cards, orders by edhrecRank asc", () => {
  const cards = [
    doc({ _id: "a", edhrecRank: 100 }),
    doc({ _id: "b", edhrecRank: 5 }),
    doc({ _id: "c", edhrecRank: 5 }),           // tie with b -> _id order
    doc({ _id: "done", edhrecRank: 1 }),        // excluded: done
    doc({ _id: "empty", edhrecRank: 2, oracleText: "" }), // excluded: no text
    doc({ _id: "norank" }),                      // undefined rank -> last
  ];
  const out = selectUntagged(cards, new Set(["done"]), 10).map((c) => c._id);
  expect(out).toEqual(["b", "c", "a", "norank"]);
});

test("selectUntagged respects n", () => {
  const cards = [doc({ _id: "a", edhrecRank: 1 }), doc({ _id: "b", edhrecRank: 2 })];
  expect(selectUntagged(cards, new Set(), 1).map((c) => c._id)).toEqual(["a"]);
});

test("renderPreamble includes the system prompt and excludes the final card turn", () => {
  const p = renderPreamble(doc({ _id: "x", name: "Whatever", oracleText: "Unique-oracle-text-marker." }));
  expect(p.length).toBeGreaterThan(200);            // has the real system+few-shot content
  expect(p).not.toContain("Unique-oracle-text-marker."); // the card's own turn is dropped
});

test("cardTagsFromRawAbilities normalizes raw abilities and stamps versions + characteristics", () => {
  const card = { name: "Essence Warden", typeLine: "Creature — Elf Shaman", oracleText: "Whenever another creature enters, you gain 1 life.", keywords: [], colors: ["G"], manaValue: 1, colorIdentity: ["G"], power: "1", toughness: "1" };
  const raw = [{ kind: "triggered", trigger: { verbs: ["enters"], subject: { type: "creature", control: "you", token: null } }, effect: { kind: "lifegain", subject: { control: "you", token: null } }, emits: [{ verb: "gain-life", subject: { control: "you", token: null } }] }];
  const t = cardTagsFromRawAbilities("oid-ew", card, raw, "claude-haiku-4-5-subagent");
  expect(t.oracleId).toBe("oid-ew");
  expect(t.model).toBe("claude-haiku-4-5-subagent");
  expect(t.schemaVersion).toBe(SCHEMA_VERSION);
  expect(t.promptVersion).toBe(PROMPT_VERSION);
  expect(t.characteristics.types).toContain("creature");
  expect(t.abilities).toHaveLength(1);
  expect(t.abilities[0].effect.kind).toBe("lifegain");
});

test("cardTagsFromRawAbilities yields empty abilities for an empty raw array", () => {
  const card = { name: "Grizzly Bears", typeLine: "Creature — Bear", oracleText: "", keywords: [], colors: ["G"], manaValue: 2, colorIdentity: ["G"], power: "2", toughness: "2" };
  expect(cardTagsFromRawAbilities("oid-gb", card, [], "m").abilities).toEqual([]);
});

test("cardTagsFromRawAbilities augments a connive card that dropped its discard clause", () => {
  const card = { name: "Toluz", typeLine: "Creature — Human", oracleText: "When Toluz enters, it connives. (Draw a card, then discard a card.)", keywords: [], colors: ["U"], manaValue: 3, colorIdentity: ["U"], power: "2", toughness: "3" };
  // Raw abilities captured only the draw — the discard clause was dropped, as Haiku does.
  const raw = [{ kind: "triggered", trigger: { verbs: ["enters"], subject: { control: "you", token: null } }, effect: { kind: "draw-card" }, emits: [{ verb: "draw", subject: { control: "you", token: null } }] }];
  const t = cardTagsFromRawAbilities("oid-toluz", card, raw, "m");
  const discardEmits = t.abilities.flatMap((a) => a.emits ?? []).filter((e) => e.verb === "discard");
  expect(discardEmits).toHaveLength(1);
  expect(discardEmits[0].subject.control).toBe("you");
});

test("missingOracleIds returns dispatched ids with no result, deduped", () => {
  expect(missingOracleIds(["a", "b", "c", "b"], ["b"])).toEqual(["a", "c"]);
});

test("coverageReport counts totals, tagged, remaining under cutoff, and next rank", () => {
  const cards = [
    doc({ _id: "a", edhrecRank: 10 }),
    doc({ _id: "b", edhrecRank: 100 }),
    doc({ _id: "c", edhrecRank: 5000 }),
    doc({ _id: "empty", edhrecRank: 1, oracleText: "" }), // ignored (no text)
  ];
  const r = coverageReport(cards, new Set(["a"]), 1000);
  expect(r.total).toBe(3);                 // a,b,c (empty excluded)
  expect(r.tagged).toBe(1);                // a
  expect(r.remainingUnderCutoff).toBe(1);  // b (rank 100 <= 1000); c is 5000
  expect(r.nextRank).toBe(100);            // smallest untagged rank
});

test("sample returns k distinct items and is deterministic under a fixed rng", () => {
  const items = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  let s = 42;
  const rng = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const a = sample(items, 3, rng);
  expect(a).toHaveLength(3);
  expect(new Set(a).size).toBe(3);              // distinct
  s = 42;
  expect(sample(items, 3, rng)).toEqual(a);     // deterministic
});

test("sample caps at the array length", () => {
  expect(sample([1, 2], 5, Math.random)).toHaveLength(2);
});

test("expectsAbilities: a card whose text is only keywords legitimately tags as []", () => {
  expect(expectsAbilities({ oracleText: "Flying, vigilance", keywords: ["Flying", "Vigilance"] } as never)).toBe(false);
  expect(expectsAbilities({ oracleText: "", keywords: [] } as never)).toBe(false);
  // Reminder text in parentheses is not an ability either.
  expect(expectsAbilities({ oracleText: "Trample (This creature can deal excess damage.)", keywords: ["Trample"] } as never)).toBe(false);
});

test("expectsAbilities: real rules text means an empty tag is a hole, not a vanilla card", () => {
  // These four all shipped with zero abilities and were invisible to the whole structured engine.
  expect(expectsAbilities({ oracleText: "This spell can't be countered.\nDestroy all creatures.", keywords: [] } as never)).toBe(true);
  expect(expectsAbilities({ oracleText: "Destroy target creature or planeswalker.", keywords: [] } as never)).toBe(true);
  expect(expectsAbilities({ oracleText: "At the beginning of your upkeep, you lose 1 life and create a 1/1 black Faerie Rogue creature token with flying.", keywords: [] } as never)).toBe(true);
  // Keyword PLUS real text still expects abilities.
  expect(expectsAbilities({ oracleText: "Flying\nWhenever this creature attacks, draw a card.", keywords: ["Flying"] } as never)).toBe(true);
});
