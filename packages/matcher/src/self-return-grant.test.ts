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

// #1256 REVIEW. The same step narrows EVERY trigger of the grant, the returned creature's emits, and the grants the stored clauses file as the card itself.
const ASHNOD = "Ashnod's Intervention";
test("Ashnod's Intervention ('dies or is put into exile from the battlefield'): the exile trigger is yours too, so Swords and Path no longer pair with it (Farewell, exile all creatures, hits yours too and keeps its pair, as a dies wipe does)", () => {
  const ex = dc(ASHNOD).tags!.abilities.filter((a) => a.grantedBy !== undefined && a.trigger?.verbs.includes("exiled")).map((a) => a.trigger!.subject.control);
  expect(ex.length).toBeGreaterThan(0);
  expect(ex.every((x) => x === "you")).toBe(true);
  for (const p of ["Swords to Plowshares", "Path to Exile"]) expect(pair(p, ASHNOD), p).toEqual([]);
  expect(pair("Farewell", ASHNOD)).toEqual(["exiled:creature"]);
});

test.each(["Infuse with Vitality", "Return to Action", "Pain 101", "Kaya the Inexorable"])("%s: the granted trigger is stored as the card itself; a granter that is no creature grants it to the recipient, so a sacrifice outlet pairs", (n) => {
  const t = dc(n).tags!.abilities.filter((a) => a.grantedBy !== undefined && a.trigger?.verbs.some((v) => v === "dies" || v === "exiled"));
  expect(t.length, n).toBeGreaterThan(0);
  for (const a of t) { expect(a.trigger!.subject.self, n).toBeUndefined(); expect(a.trigger!.subject.control, n).toBe("you"); }
  expect(pair("Viscera Seer", n), n).toContain("dies:creature");
});

// CR 702.95a (title: Soulbond): the paired creature is "another unpaired creature you control".
test("Breathkeeper Seraph (soulbond): its paired creatures are yours, so No Mercy no longer pairs and Viscera Seer still does", () => {
  expect(String(F["Breathkeeper Seraph"]!.source.oracleText)).toContain("each of those creatures has \"When this creature dies, you may return it to the battlefield under its owner's control at the beginning of your next upkeep.\"");
  expect(pair("No Mercy", "Breathkeeper Seraph")).toEqual([]);
  expect(pair("Viscera Seer", "Breathkeeper Seraph")).toEqual(["dies:creature"]);
});

test("the returned creature is yours: 'a creature an opponent controls enters' (Blood Seeker, Authority of the Consuls) no longer hears Malakir Rebirth or Undying Malice", () => {
  expect(pair(MALAKIR, "Blood Seeker")).toEqual([]);
  expect(pair("Undying Malice", "Authority of the Consuls")).toEqual([]);
  const enters = dc(MALAKIR).tags!.abilities.filter((a) => a.grantedBy !== undefined).flatMap((a) => (a.emits ?? []).filter((e) => e.subject.ref === "trigger").map((e) => e.subject.control));
  expect(enters.length).toBeGreaterThan(0);
  expect(enters.every((x) => x === "you")).toBe(true);
});
