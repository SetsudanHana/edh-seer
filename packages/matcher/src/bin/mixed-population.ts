/** Is a MIXED flat/derived tag population coherent, or does it lose edges both pure arms find?
 *
 *  The persistence path buys derived tags for a subset of the corpus, so a real deck analysis reads
 *  some cards' tags from the old flat extractor and some from derivation. Coverage measurement puts
 *  that split near 50/50 for a newly built deck, which makes "mixed" the NORMAL case rather than an
 *  edge case -- and `edges.ts` matches producer events against consumer triggers ACROSS the two
 *  cards, so nothing guarantees the two populations speak the same dialect.
 *
 *  Four arms over the same verified gold pairs, with the `card` held constant (always the Mongo
 *  document) so the ONLY variable is where `tags` came from:
 *
 *    FF  both flat      -- the live baseline, expected 55/55 (and partly wrong; see the
 *                          compass-baseline-defects stub -- 12 pass on tags contradicting the cards)
 *    DD  both derived   -- the ratchet, expected 41/55
 *    FD / DF  mixed     -- what a real deck actually gets
 *
 *  The signal is not the raw counts. It is the pairs that PASS IN BOTH PURE ARMS and FAIL MIXED:
 *  those are edges lost purely to dialect mismatch, and they are what would silently disappear from
 *  a user's deck analysis after a partial-corpus run.
 *
 *  FF is the harness self-check: it must read 55/55, because that is the live pipeline's own score
 *  on this gold set. Anything else means the harness is broken, not that the population is.
 *
 *  Free: no API calls. Needs Mongo and the committed gold fixture.
 *  Usage: tsx src/bin/mixed-population.ts */
import { readFileSync } from "node:fs";
import { connect, loadConfig, mongoLookup, normalizeName, docToCard } from "@edh-seer/data";
import { deriveCardTags } from "@edh-seer/tagger";
import type { CardTags, Characteristics, ClauseRecord } from "@edh-seer/tagger";
import { loadHierarchy, pairReasons } from "../index.js";
import type { DeckCard } from "../types.js";
import { classifyPair, type GoldPair } from "./eval-pairs-core.js";

interface Fixture {
  name: string;
  oracleId: string;
  clauses: ClauseRecord[];
  characteristics: Characteristics;
}

const GOLD = JSON.parse(
  readFileSync(new URL("../goldpairs.json", import.meta.url), "utf8"),
) as GoldPair[];
const FIXTURE = JSON.parse(
  readFileSync(new URL("../fixtures/gold-clauses.json", import.meta.url), "utf8"),
) as Fixture[];
const byName = new Map(FIXTURE.map((f) => [f.name, f]));

type Source = "flat" | "derived";
const ARMS: { id: string; a: Source; b: Source }[] = [
  { id: "FF", a: "flat", b: "flat" },
  { id: "DD", a: "derived", b: "derived" },
  { id: "FD", a: "flat", b: "derived" },
  { id: "DF", a: "derived", b: "flat" },
];

const store = await connect(loadConfig());
const lookup = mongoLookup(store);
const cardTagsCol = store.db.collection("cardTags");
const hierarchy = loadHierarchy();

/** Both tag populations for one card, sharing a single `card` so tags are the only variable. */
async function load(name: string): Promise<{ flat: DeckCard; derived: DeckCard } | null> {
  const doc = await lookup.findByName(normalizeName(name));
  if (!doc) return null;
  const fx = byName.get(name);
  if (!fx) return null;
  const card = docToCard(doc as never);
  const flatTags = (await cardTagsCol.findOne({ oracleId: (doc as { _id: string })._id })) as CardTags | null;
  const derivedTags = deriveCardTags({
    oracleId: fx.oracleId, clauses: fx.clauses, characteristics: fx.characteristics,
  });
  return { flat: { card, tags: flatTags }, derived: { card, tags: derivedTags } };
}

const pairs = GOLD.filter((p) => p.verified);
const loaded = new Map<string, { flat: DeckCard; derived: DeckCard }>();
const skipped: string[] = [];
for (const name of new Set(pairs.flatMap((p) => [p.a, p.b]))) {
  const got = await load(name);
  if (got) loaded.set(name, got);
  else skipped.push(name);
}
await store.close();

const usable = pairs.filter((p) => loaded.has(p.a) && loaded.has(p.b));
const pass = new Map<string, Set<string>>(ARMS.map((a) => [a.id, new Set<string>()]));

for (const pair of usable) {
  const key = `${pair.a} / ${pair.b}`;
  for (const arm of ARMS) {
    const a = loaded.get(pair.a)![arm.a];
    const b = loaded.get(pair.b)![arm.b];
    if (classifyPair(pair, pairReasons(a, b, hierarchy), a, b).status === "PASS") {
      pass.get(arm.id)!.add(key);
    }
  }
}

const n = usable.length;
console.log(`gold pairs usable: ${n}${skipped.length ? ` (skipped ${skipped.length}: ${skipped.join(", ")})` : ""}\n`);
for (const arm of ARMS) {
  const c = pass.get(arm.id)!.size;
  console.log(`  ${arm.id}  a=${arm.a.padEnd(7)} b=${arm.b.padEnd(7)}  ${String(c).padStart(2)}/${n} = ${(100 * c / n).toFixed(0)}%`);
}

// The finding: edges BOTH pure arms agree on, that a mixed population loses.
const ff = pass.get("FF")!, dd = pass.get("DD")!;
const bothPure = [...ff].filter((k) => dd.has(k));
console.log(`\npairs passing in BOTH pure arms: ${bothPure.length}`);
for (const armId of ["FD", "DF"]) {
  const lost = bothPure.filter((k) => !pass.get(armId)!.has(k));
  console.log(`  lost by ${armId}: ${lost.length}`);
  for (const k of lost) console.log(`      ${k}`);
}

// The reverse: mixed finding something neither pure arm does would be equally suspicious.
for (const armId of ["FD", "DF"]) {
  const gained = [...pass.get(armId)!].filter((k) => !ff.has(k) && !dd.has(k));
  if (gained.length) {
    console.log(`\n  ${armId} passes ${gained.length} pair(s) NEITHER pure arm does (suspicious):`);
    for (const k of gained) console.log(`      ${k}`);
  }
}
