import { expect, test } from "vitest";
import { deriveCardTags, deriveInputOf, grammarClauseRecords } from "@edh-seer/tagger";
import type { CardTags, ClauseRecord } from "@edh-seer/tagger";
import { loadHierarchy, pairReasons } from "./index.js";
import type { DeckCard } from "./types.js";
import fixtures from "./fixtures/self-return-grant-1256.json" with { type: "json" };

/** #1256, owner ruling 2026-11-26: a protective self-return GRANTED to "target creature" ("Until end of turn, that creature gains 'When this creature dies, return it to the battlefield tapped under its owner's control.'", Malakir Rebirth) is read by its PRIMARY use, as in #962:
 *  a creature YOU control. The granted trigger read `dies {control: any}` because "target creature" names no controller, so No Mercy and Mikaeus (opponent-death engines) paired with it. Stored documents and clauses of the production corpus, 2026-11-26. */
type Fx = { source: Record<string, unknown> & { _id: string }; canonical: ClauseRecord[] | null };
const F = fixtures as unknown as Record<string, Fx>;
const dc = (name: string): DeckCard => {
  const src = F[name]!.source;
  const g = F[name]!.canonical === null ? grammarClauseRecords(src as never) : undefined;
  return { card: src as unknown as DeckCard["card"], tags: deriveCardTags(deriveInputOf(src as never, name, name, g ? g.records : F[name]!.canonical!, undefined, g?.readings)) as CardTags };
};
const MALAKIR = "Malakir Rebirth // Malakir Mire";
const pair = (p: string, c: string) => pairReasons(dc(p), dc(c), loadHierarchy()).filter((r) => r.producer === p && r.consumer === c).map((r) => r.tag);
const grantedDies = (n: string) => dc(n).tags!.abilities.filter((a) => a.grantedBy !== undefined && a.trigger?.verbs.includes("dies")).map((a) => a.trigger!.subject.control);

test("the oracle text the ruling reads", () => {
  expect(String(F[MALAKIR]!.source.oracleText)).toContain(`Choose target creature. You lose 2 life. Until end of turn, that creature gains "When this creature dies, return it to the battlefield tapped under its owner's control."`);
});

test.each([MALAKIR, "Demonic Gifts", "Ashnod's Intervention", "Verdant Rebirth", "Undying Malice"])("%s: the granted self-return reads a creature you control", (n) => {
  const c = grantedDies(n);
  expect(c.length, n).toBeGreaterThan(0);
  expect(c.every((x) => x === "you"), `${n} ${c}`).toBe(true);
});

test.each(["No Mercy", "Mikaeus, the Unhallowed"])("%s (an opponent-death engine) no longer pairs with Malakir Rebirth", (p) => {
  expect(pair(p, MALAKIR)).toEqual([]);
});

test("a payoff for YOUR creatures dying still pairs: Viscera Seer and Village Rites (you sacrifice a creature) with Malakir Rebirth; Not Dead After All ('target creature you control') is unchanged", () => {
  for (const p of ["Viscera Seer", "Village Rites"]) expect(pair(p, MALAKIR), p).toEqual(["dies:creature"]);
  expect(grantedDies("Not Dead After All").every((x) => x === "you")).toBe(true);
  expect(pair("Viscera Seer", "Not Dead After All").length).toBeGreaterThan(0);
});
