import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import * as index from "@edh-seer/matcher";
import { hasSubject, pairContext, reasonsOf, tokenNodeIds, type MatcherModule } from "./derive-impact-pairs.js";

/** #1666 round 3: a token only ever given to an opponent has an `<id>#opp` node and no node under its bare doc id, so a lookup of the bare id alone read every one of its BASE reasons as lost (derive-impact's token-subject path).
 *  The world is Generous Gift (its Elephant goes to the destroyed permanent's controller) and Blood Seeker, which hears a creature entering under an opponent's control. */
// The matcher modules the pair loop needs but does not re-export are loaded by path, as `derive-impact-worker.ts` does (a static import of another package's source breaks this workspace's rootDir).
const REPO = new URL("../../..", import.meta.url).pathname;
const load = async (rel: string): Promise<any> => import(pathToFileURL(`${REPO}${rel}`).href);
const [analyze, edges, tokenTags] = [await load("packages/matcher/src/analyze.ts"), await load("packages/matcher/src/edges.ts"), await load("packages/matcher/src/token-tags.ts")];
const fixtures = JSON.parse(readFileSync(`${REPO}packages/matcher/src/fixtures/opp-token-perspective.json`, "utf8"));
const F = fixtures as unknown as { cards: Record<string, { source: { allParts: { printingId: string }[] }; tags: { oracleId: string } }> };
const m = { ...index, collectTokenNodes: analyze.collectTokenNodes, disambiguateFaceNames: analyze.disambiguateFaceNames, synthesizeTokenTags: tokenTags.synthesizeTokenTags, createsForYou: edges.createsForYou } as unknown as MatcherModule;
const gift = F.cards["Generous Gift"]!, seeker = F.cards["Blood Seeker"]!;
const pid = gift.source.allParts.find((p) => (p as { component?: string }).component === "token")!.printingId;
const TOKEN = "tok-elephant";
const world = () => pairContext(
  m,
  new Map<string, unknown>([[gift.tags.oracleId, gift.tags], [seeker.tags.oracleId, seeker.tags]]) as never,
  new Map<string, unknown>([[gift.tags.oracleId, gift.source], [seeker.tags.oracleId, seeker.source]]) as never,
  [{ _id: TOKEN, printingIds: [pid], name: "Elephant", typeLine: "Token Creature — Elephant", power: "3", toughness: "3", colors: ["G"] } as never],
);

describe("a token given only to opponents", () => {
  test("has only an #opp node, and tokenNodeIds, hasSubject and reasonsOf find it by the bare token doc id", () => {
    const ctx = world();
    expect(ctx.nodeByOracle.has(TOKEN)).toBe(false);
    expect(ctx.nodeByOracle.has(`${TOKEN}#opp`)).toBe(true);
    expect(tokenNodeIds(ctx, TOKEN)).toEqual([`${TOKEN}#opp`]);
    expect(hasSubject(ctx, TOKEN, true)).toBe(true);
    expect(hasSubject(ctx, "no-such-token", true)).toBe(false);
    const reasons = reasonsOf(ctx, TOKEN, true);
    expect(reasons.length).toBeGreaterThan(0);
    expect(reasons.some((r) => (r.consumer === "Blood Seeker" || r.producer === "Blood Seeker"))).toBe(true);
  });
});
