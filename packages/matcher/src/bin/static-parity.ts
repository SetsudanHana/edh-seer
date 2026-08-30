/** Task 6's acceptance test for the whole static-build-data-plane plan: every one of the 71
 *  calibration decks must analyze IDENTICALLY through the Mongo path and the static-artifacts
 *  path. Both paths call the SAME orchestration (`resolveDeck` / `analyzeResolvedDeck` /
 *  `buildWireGraph`), so a difference means the artifacts `build-static.ts` wrote are lossy or
 *  `StaticLookup` is not an equivalent `AnalysisSources`, not that the two code paths diverge.
 *
 *  Free: no model call, Mongo reads only, static reads only.
 *
 *    set -a && source packages/tagger/.env && set +a
 *    npx tsx packages/matcher/src/bin/build-static.ts     # if static-out/ needs rebuilding
 *    npx tsx packages/matcher/src/bin/static-parity.ts */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Db } from "mongodb";
import { connect, loadConfig, mongoLookup, normalizeName, parseDecklistSections } from "@edh-seer/data";
import { createTagsLookup } from "@edh-seer/tagger";
import { StaticLookup } from "../static-lookup.js";
import { loadTokenTags } from "../token-tags.js";
import { analyzeResolvedDeck, buildWireGraph, resolveDeck, type AnalysisSources } from "../orchestrate.js";

const DECK_DIR = join(process.cwd(), "packages", "cli", "decks", "calibration");
const outDir = "static-out";

// A NODE `fetch` SHIM OVER THE BUILT DIRECTORY, so the parity run needs no HTTP server. It is the
// only thing in this bin that differs from what the browser does, and it is deliberately thin:
// read the file, or 404. Anything smarter here would be testing the shim rather than the
// artifacts. Verified against the real `static-out/` tree before trusting it in this bin: a
// `StaticLookup`-built URL round-trips through `new URL(url, "file:///").pathname` back to the
// exact `encodeURIComponent`-escaped filename `build-static.ts` wrote, percent-encoding intact.
const fileFetch = (async (url: string) => {
  const path = join(outDir, new URL(url, "file:///").pathname);
  try {
    const body = readFileSync(path, "utf8");
    return { ok: true, status: 200, json: async () => JSON.parse(body) } as Response;
  } catch {
    return { ok: false, status: 404, json: async () => ({}) } as Response;
  }
}) as unknown as typeof fetch;

/** Runs the shared `AnalysisSources` a decklist needs through one `Sources`, returning the four
 *  outputs the two paths must agree on plus the wire graph -- everything a client sees for one
 *  analyzed deck. */
async function runOne(
  text: string,
  sources: AnalysisSources,
  prefetch?: (names: string[]) => Promise<void>,
): Promise<unknown> {
  const sections = parseDecklistSections(text);
  // `StaticLookup.prefetch` builds its fetch URL straight off each name (`cardFileName(n)`, no
  // normalization inside it -- pinned by its own test using already-lowercased names), while
  // every OTHER caller resolves through `findByName(normalizeName(name))`. Prefetching the raw
  // decklist strings would fetch a path that never exists on disk (`Felothar%20the%20Steadfast`
  // vs the file `felothar%20the%20steadfast.json`) and silently cache every name as missing.
  const names = [...sections.commanders, ...sections.deck].map(normalizeName);
  if (prefetch) await prefetch(names);
  const { cards, combos, missing, commanderResolved, commanderColorIdentity } =
    await resolveDeck(sections.commanders, sections.deck, sources.lookup);
  const report = await analyzeResolvedDeck(cards, combos, commanderResolved, sources);
  const cardNames = cards.map((c) => c.name);
  const copiesByName = new Map<string, number>();
  for (const n of cardNames) copiesByName.set(n, (copiesByName.get(n) ?? 0) + 1);
  const rolesByName = new Map(
    report.cards.filter((c) => c.roles && c.roles.length > 0)
      .map((c) => [c.cardName ?? c.name, c.roles!] as const),
  );
  const graph = await buildWireGraph(cardNames, rolesByName, copiesByName, sources);
  return { report, graph, missing, commanderResolved, commanderColorIdentity };
}

/** Walks two equal-shaped JSON trees and returns the first path where they diverge, dotted /
 *  bracketed like `edges[12].reasons[0].text` -- so a mismatch names exactly where to look instead
 *  of dumping tens of thousands of lines of `DeckReport`. */
function firstDiff(a: unknown, b: unknown, path = "$"): string | null {
  if (a === b) return null;
  if (typeof a !== typeof b) return `${path} (type ${typeof a} vs ${typeof b})`;
  if (a === null || b === null || typeof a !== "object") {
    return `${path} (${JSON.stringify(a)} vs ${JSON.stringify(b)})`;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return `${path} (array shape mismatch)`;
    if (a.length !== b.length) return `${path}.length (${a.length} vs ${b.length})`;
    for (let i = 0; i < a.length; i++) {
      const d = firstDiff(a[i], b[i], `${path}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
  for (const k of [...keys].sort()) {
    const d = firstDiff(ao[k], bo[k], `${path}.${k}`);
    if (d) return d;
  }
  return null;
}

async function main(): Promise<void> {
  const store = await connect(loadConfig());
  const mongoSources: AnalysisSources = {
    lookup: mongoLookup(store),
    tagsLookup: createTagsLookup(store.db),
    tokenTags: await loadTokenTags(store.db),
    tokenArt: async (oracleIds: string[]) => {
      const rows = await (store.db as Db)
        .collection<{ _id: string; artCrop?: string }>("tokens")
        .find({ _id: { $in: oracleIds } }, { projection: { artCrop: 1 } })
        .toArray();
      return new Map(rows.filter((r) => r.artCrop).map((r) => [r._id, r.artCrop!] as const));
    },
  };

  // ONE shared instance across all 71 decks. `findByName`/`findOne` are pure lookups with no
  // per-deck scope, and `allCombos()` accumulating combos from earlier decks is harmless: a stale
  // combo only survives `combosContainedIn(present)` on THIS deck's resolveNames call when every
  // one of its cards -- including its alphabetically-first anchor -- is itself present in this
  // deck's own name list, which is exactly the true-membership case. Prefetching each deck's own
  // names before resolving it (dedup skips names already cached) keeps it equivalent to Mongo's
  // `allCombos()`, which is unscoped in the identical way (the whole `combos` collection, filtered
  // per deck by `present`).
  const staticLookup = new StaticLookup("http://static", fileFetch);
  const staticSources: AnalysisSources = {
    lookup: staticLookup,
    tagsLookup: staticLookup,
    tokenTags: await staticLookup.tokenTags(),
    tokenArt: (oracleIds: string[]) => staticLookup.tokenArt(oracleIds),
  };

  const files = readdirSync(DECK_DIR).filter((f) => f.endsWith(".txt")).sort();
  let identical = 0;
  const mismatches: string[] = [];

  for (const file of files) {
    const deckName = file.replace(/\.txt$/, "");
    const text = readFileSync(join(DECK_DIR, file), "utf8");
    const [mongoResult, staticResult] = await Promise.all([
      runOne(text, mongoSources),
      runOne(text, staticSources, (names) => staticLookup.prefetch(names)),
    ]);
    // THE ACCEPTANCE TEST IS `JSON.stringify` EQUALITY, PER THE BRIEF -- exactly what a browser
    // receiving this over HTTP and a Nest response body both reduce to. `firstDiff` only runs on
    // a mismatch, over the PARSED JSON (so Map/Set/undefined quirks in the raw objects can never
    // produce a false difference the stringify comparison itself would not have seen).
    const mongoJson = JSON.stringify(mongoResult);
    const staticJson = JSON.stringify(staticResult);
    if (mongoJson === staticJson) {
      identical++;
    } else {
      mismatches.push(deckName);
      const diff = firstDiff(JSON.parse(mongoJson), JSON.parse(staticJson));
      console.log(`MISMATCH ${deckName}: ${diff ?? "(stringify differs, no path found -- key order?)"}`);
    }
  }

  await store.close();

  console.log(`\n${identical} of ${files.length} decks identical`);
  if (mismatches.length > 0) {
    console.log(`mismatched: ${mismatches.join(", ")}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
