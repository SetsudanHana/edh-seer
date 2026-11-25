import { expect, test } from "vitest";
import { deriveCardTags, deriveInputOf, grammarClauseRecords } from "@edh-seer/tagger";
import type { CardTags, ClauseRecord } from "@edh-seer/tagger";
import { detectBuildCategories } from "./build.js";
import { isPolymorph } from "./edges.js";
import { loadHierarchy, pairReasons } from "./index.js";
import { fodderDemandsOf } from "./partners-core.js";
import type { DeckCard } from "./types.js";
import fixtures from "./fixtures/polymorph-swap-1808.json" with { type: "json" };

/** #1808 review. OWNER RULING #962 (mtg-polymorph-ruling, items 1 and 4): a polymorph links to token producers as fodder, and a target-any card is read by its PRIMARY use: Proteus Staff is played as a polymorph, so it links like one; Chaos Warp and Path to Exile are
 *  removal first. REWEAVE ("Target permanent's controller sacrifices it. If the player does, they reveal cards ... until they reveal a permanent card that shares a card type with the sacrificed permanent, put that card onto the battlefield") has the same shape widened to any
 *  permanent: a polymorph, with no removal role and no answer. MERCY KILLING ("Target creature's controller sacrifices it, then creates X ... tokens") is removal by primary use (owner-approved), and stays. Stored documents and clauses of the production corpus, 2026-11-25. */
type Fx = { source: Record<string, unknown> & { _id: string }; canonical: ClauseRecord[] | null };
const F = fixtures as unknown as Record<string, Fx>;
const dc = (name: string): DeckCard => {
  const src = F[name]!.source;
  const g = F[name]!.canonical === null ? grammarClauseRecords(src as never) : undefined;
  return { card: src as unknown as DeckCard["card"], tags: deriveCardTags(deriveInputOf(src as never, name, name, g ? g.records : F[name]!.canonical!, undefined, g?.readings)) as CardTags };
};
const reasons = (p: string, c: string, opts = {}) => pairReasons(dc(p), dc(c), loadHierarchy(), opts).filter((r) => r.producer === p && r.consumer === c);
const role = (n: string, cat: "targetedRemoval") => detectBuildCategories([dc(n)]).get(cat)?.has(n) === true;

test("Reweave is a polymorph, as Proteus Staff and Mass Polymorph are; Mercy Killing is not", () => {
  expect(F["Reweave"]!.source.oracleText).toContain("they reveal cards from the top of their library until they reveal a permanent card that shares a card type with the sacrificed permanent");
  for (const n of ["Reweave", "Proteus Staff", "Mass Polymorph"]) expect(isPolymorph(dc(n)), n).toBe(true);
  expect(isPolymorph(dc("Mercy Killing"))).toBe(false);
});

// A maker is fodder through the token it makes: on a card page (no token node) the maker stands in for it. Reweave's sacrifice is `permanent`, so its tag is `fodder:permanent`, as it was before the third-person fix.
test.each(["Captain's Call", "God-Eternal Oketra", "Springjack Shepherd"])("token producers are fodder for Reweave, through their tokens: %s", (p) => {
  const r = reasons(p, "Reweave", { tokensMediate: false }).filter((x) => x.tag.startsWith("fodder:"));
  expect(r.map((x) => x.tag), p).toEqual(["fodder:permanent"]);
  expect(r[0]!.text).toBe(`${p} makes fodder for Reweave`);
});
test("Reweave asks for fodder, as a polymorph does", () => {
  expect(fodderDemandsOf(dc("Reweave")).map((k) => k.key)).toEqual(["fodder|-|permanent|-"]);
});

test("Reweave has no targetedRemoval role and no answer; Mercy Killing keeps both (it is removal first)", () => {
  expect(role("Reweave", "targetedRemoval")).toBe(false);
  expect(role("Mercy Killing", "targetedRemoval")).toBe(true);
});

// "that creature's controller sacrifices it" after "becomes blocked by a creature": the blocker is the defending player's (CR 509.1a: the defending player chooses which creatures THEY control will block), an opponent of the attacker's controller.
test("Basalt Golem's blocker is an opponent's: it is no fodder or death for Zulaport Cutthroat (creatures YOU control)", () => {
  expect(F["Basalt Golem"]!.source.oracleText).toContain("Whenever this creature becomes blocked by a creature, that creature's controller sacrifices it");
  expect(reasons("Basalt Golem", "Zulaport Cutthroat")).toEqual([]);
});

// #1808 re-review: a polymorph swaps YOUR permanent (#962, primary use), so a token that goes to an OPPONENT is no fodder for it. Beast Within and Generous Gift give the
// token to the destroyed permanent's controller; with `control: any` kept on the swap they read as "makes fodder for Reweave" (95 false pairs). A maker of your own tokens still is.
test.each(["Beast Within", "Generous Gift"])("a token given to an opponent is no fodder for Reweave: %s", (p) => {
  expect(reasons(p, "Reweave", { tokensMediate: false }).filter((x) => x.tag.startsWith("fodder:"))).toEqual([]);
});
