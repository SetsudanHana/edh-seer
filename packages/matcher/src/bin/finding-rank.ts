import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  connect, docToCard, loadConfig, mongoLookup, normalizeName, parseDecklistSections,
} from "@edh-seer/data";
import { createTagsLookup } from "@edh-seer/tagger";
import { ComboIndex } from "@edh-seer/engine";
import { analyzeDeckStructured } from "../analyze.js";
import { loadTokenTags } from "../token-tags.js";
import type { DeckCard } from "../types.js";
import { pathToFileURL } from "node:url";
import type { DeckReport } from "@edh-seer/engine";

/** THE RANKING ITSELF, NOT A SECOND COPY OF IT. `findings`/`rankedFindings` live in the client
 *  because that is the only surface that renders them, and re-deriving the order here would be two
 *  rankings that can disagree -- the defect class this repo has measured twice.
 *
 *  LOADED AT RUNTIME, BY URL, and that is not a style choice: a static import puts a client file
 *  inside this package's `rootDir`, which `tsc --noEmit -p packages/matcher` rejects outright (TS6059)
 *  and typecheck is a CI gate. A computed specifier is not followed by the type graph, so the bin
 *  compiles here and still runs the client's real code. The types are declared rather than imported,
 *  which is the cost; the alternative -- moving `findings.ts` into a shared package -- is a
 *  restructure this one-off instrument does not justify. */
interface FindingRow { id: string; kind: string; shortfall: number; impact?: number }
type FindingsModule = {
  findings: (r: DeckReport) => FindingRow[];
  rankedFindings: (r: DeckReport) => { scored: FindingRow[]; unseen: FindingRow[] };
};
const FINDINGS_PATH = join(process.cwd(), "packages", "web", "client", "src", "lib", "findings.ts");

/** DOES RANKING BY IMPACT ACTUALLY REORDER ANYTHING? (roadmap S10.)
 *
 *  S10 replaced chapter 6's sort key -- the fraction of a target that is missing -- with what closing
 *  each gap is worth to `buildScore`. That is a better question to ask, and it is worth nothing if
 *  the two orders agree on every real deck. This is the measurement that decides whether the ranking
 *  claim survives or is withdrawn and only the printed figure kept.
 *
 *  Three numbers, over the 71 calibration decks:
 *    1. how many decks change their TOP finding
 *    2. how many change the SET of three shown (not merely the order inside it)
 *    3. the spread of impact values -- if every finding on every deck reads between +0.05 and +0.15,
 *       the figure is true and useless as a discriminator, and the ranking claim is not supported.
 *
 *  Free: Mongo reads only, no API, no writes.
 *
 *    set -a && source packages/tagger/.env && set +a
 *    npx tsx packages/matcher/src/bin/finding-rank.ts
 */
const DECK_DIR = join(process.cwd(), "packages", "cli", "decks", "calibration");

interface Row {
  deck: string;
  byImpact: string[];
  byShortfall: string[];
  topChanged: boolean;
  setChanged: boolean;
}

async function main(): Promise<void> {
  const { findings, rankedFindings } = await import(pathToFileURL(FINDINGS_PATH).href) as FindingsModule;
  const store = await connect(loadConfig());
  const lookup = mongoLookup(store);
  const cardTags = createTagsLookup(store.db);
  const tokenTags = await loadTokenTags(store.db);

  const rows: Row[] = [];
  const impacts: number[] = [];
  const zeroByKind = new Map<string, number>();
  const byKind = new Map<string, number>();
  let decksWithFindings = 0;

  for (const file of readdirSync(DECK_DIR).filter((f) => f.endsWith(".txt")).sort()) {
    const sections = parseDecklistSections(readFileSync(join(DECK_DIR, file), "utf8"));
    const inputs: DeckCard[] = [];
    for (const name of [...sections.commanders, ...sections.deck]) {
      const doc = await lookup.findByName(normalizeName(name));
      if (!doc) continue;
      const tags = await cardTags.findOne(String(doc._id));
      inputs.push({ card: docToCard(doc), tags });
    }
    const commanderNames = sections.commanders;
    const report = analyzeDeckStructured(
      inputs, commanderNames, undefined, undefined, new ComboIndex([]), undefined, tokenTags,
    ) as unknown as DeckReport;

    const { scored } = rankedFindings(report);
    // The OLD rule, applied to the same set: `findings` already returns worst-shortfall first, so
    // this is that order restricted to the rows the new one ranks.
    const byShortfall = findings(report).filter((f) => scored.some((s) => s.id === f.id));
    if (scored.length === 0) continue;
    decksWithFindings += 1;
    for (const f of scored) {
      if (f.impact === undefined) continue;
      impacts.push(f.impact);
      // WHICH KINDS PRICE AT NOTHING, and it is the question the first run raised: a quarter of all
      // findings read exactly 0, and a row that says "does not move Build" is a different product
      // decision from one that says "+0.40".
      if (f.impact === 0) zeroByKind.set(f.kind, (zeroByKind.get(f.kind) ?? 0) + 1);
      byKind.set(f.kind, (byKind.get(f.kind) ?? 0) + 1);
    }

    const ids = (fs: { id: string }[]): string[] => fs.slice(0, 3).map((f) => f.id);
    const sorted = (fs: { id: string }[]): string => JSON.stringify(ids(fs).slice().sort());
    rows.push({
      deck: file.replace(/\.txt$/, ""),
      byImpact: ids(scored),
      byShortfall: ids(byShortfall),
      topChanged: scored[0]?.id !== byShortfall[0]?.id,
      setChanged: sorted(scored) !== sorted(byShortfall),
    });
  }
  await store.close();

  const topChanged = rows.filter((r) => r.topChanged);
  const setChanged = rows.filter((r) => r.setChanged);
  const sortedImpacts = impacts.slice().sort((a, b) => a - b);
  const at = (q: number): number => sortedImpacts[Math.min(sortedImpacts.length - 1, Math.floor(sortedImpacts.length * q))] ?? 0;

  console.log(JSON.stringify({
    decksWithFindings,
    topChanged: topChanged.length,
    setChanged: setChanged.length,
    impacts: {
      n: sortedImpacts.length,
      min: at(0), p25: at(0.25), median: at(0.5), p75: at(0.75), max: at(0.999),
      // If this is small the figure does not discriminate and the ranking claim is not supported.
      spread: at(0.999) - at(0),
    },
    zeroImpact: Object.fromEntries(
      [...byKind].map(([k, n]) => [k, `${zeroByKind.get(k) ?? 0} of ${n}`]).sort(),
    ),
    changed: topChanged.map((r) => ({ deck: r.deck, wasFirst: r.byShortfall[0], nowFirst: r.byImpact[0] })),
    setChangedDecks: setChanged.map((r) => ({ deck: r.deck, was: r.byShortfall, now: r.byImpact })),
  }, null, 2));
}

void main();
