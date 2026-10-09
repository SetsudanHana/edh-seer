import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** WHICH CARDS DERIVE `token-doubling`, AND WHAT THEIR TEXT SAYS (#1136). The sentence module reads
 *  the kind as "doubles the tokens", true only of a card that makes twice that many. Groups the
 *  derived cards by the shape of their printed replacement: "twice that many", an additional token
 *  ("additional", "in addition", "plus"), an "instead create one of each", or other.
 *
 *    npx tsx research/tagger/token-doubling-census.ts [static-out]
 */
const root = process.argv[2] ?? "static-out";
const dir = join(root, readdirSync(root).find((d) => d.startsWith("v-"))!, "cards");
const groups = new Map<string, string[]>();
for (const f of readdirSync(dir)) {
  const shard = JSON.parse(readFileSync(join(dir, f), "utf8")) as Record<string, { card: { name: string; oracleText?: string }; tags: { abilities?: { effect?: { kind?: string } }[] } | null }>;
  for (const v of Object.values(shard)) {
    if (!(v.tags?.abilities ?? []).some((a) => a.effect?.kind === "token-doubling")) continue;
    const t = (v.card.oracleText ?? "").toLowerCase();
    const shape = /twice that many|that many plus|double the number/.test(t) ? "twice"
      : /one of each/.test(t) ? "one of each"
      : /additional|in addition|plus (?:one|a|an|that many)/.test(t) ? "additional"
      : "other";
    groups.set(shape, [...(groups.get(shape) ?? []), v.card.name]);
  }
}
for (const [k, v] of [...groups].sort((a, b) => b[1].length - a[1].length)) console.log(`${k}: ${v.length}${k === "twice" ? "" : `  ${v.sort().join("; ")}`}`);

// RENDERED: every "doubles the tokens" sentence over the calibration decks, and the doubler's shape.
if (process.argv.includes("--sentences")) {
  const { CALIBRATION_DECKS } = await import("@edh-seer/data");
  const { analyzeDeckStatic } = await import("../../packages/web/client/src/api.static.js");
  const { existsSync } = await import("node:fs");
  const fetchImpl = (async (input: string | URL | Request) => {
    const path = join(root, new URL(String(input)).pathname);
    return existsSync(path) ? new Response(readFileSync(path), { headers: { "content-type": "application/json" } }) : new Response("nf", { status: 404 });
  }) as typeof fetch;
  const shapeOf = new Map<string, string>();
  for (const [k, v] of groups) for (const n of v) shapeOf.set(n, k);
  const seen = new Map<string, string>();
  for (const f of readdirSync(CALIBRATION_DECKS).filter((x) => x.endsWith(".txt"))) {
    const s = JSON.stringify(await analyzeDeckStatic(readFileSync(join(CALIBRATION_DECKS, f), "utf8"), undefined, "http://s.local", fetchImpl));
    for (const m of s.matchAll(/"([^"]{0,120}?, ([^",]+?(?:, [^",]+?)?) (doubles|triples) the tokens[^"]{0,40})"/g)) {
      const doubler = [...shapeOf.keys()].find((n) => m[1]!.includes(`, ${n} `) || m[1]!.includes(` ${n} doubles`) || m[1]!.includes(` ${n} triples`));
      seen.set(m[1]!, doubler ? shapeOf.get(doubler)! : "unknown");
    }
  }
  const by = new Map<string, number>();
  for (const v of seen.values()) by.set(v, (by.get(v) ?? 0) + 1);
  console.log(`rendered "doubles/triples the tokens" sentences: ${seen.size}; by the doubler's printed shape: ${[...by].map(([k, n]) => `${k} ${n}`).join(", ")}`);
}
