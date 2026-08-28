import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  connect, docToCard, loadConfig, mongoLookup, normalizeName, parseDecklistSections,
} from "@edh-seer/data";
import type { CardTags } from "@edh-seer/tagger";
import { ComboIndex } from "@edh-seer/engine";
import { analyzeDeckStructured } from "../analyze.js";
import type { DeckCard } from "../types.js";

/** Which report fields arrive EMPTY on real decks.
 *
 *  The failure this exists for: a block can be fully built, fully unit-tested and still not reach
 *  the report, because the wiring that carries it is one argument in `analyze.ts`. That happened --
 *  `computeDeckMath` was passed a hardcoded turn for an entire change, so the deck's own clock
 *  never priced anything in the product while every test passed. Unit tests call the functions
 *  directly and cannot see the wiring; only a real deck can.
 *
 *  Free: Mongo reads only. Run it after adding anything to the report.
 *
 *    npx tsx packages/matcher/src/bin/report-audit.ts [n-decks] */
const DECK_DIR = join(process.cwd(), "packages", "cli", "decks", "calibration");

/** Is this value the shape of a field nobody filled in? */
function emptiness(value: unknown): string | null {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (Array.isArray(value)) return value.length === 0 ? "empty array" : null;
  if (typeof value === "number") return value === 0 ? "zero" : null;
  if (typeof value === "string") return value === "" ? "empty string" : null;
  if (value instanceof Map) return value.size === 0 ? "empty map" : null;
  if (typeof value === "object") return Object.keys(value).length === 0 ? "empty object" : null;
  return null;
}

/** Every leaf worth checking, flattened one level into the deck-math sub-blocks so an empty
 *  `deckMath.wincons.classes` is not hidden by a non-empty `deckMath`. */
function leaves(report: Record<string, unknown>): [string, unknown][] {
  const out: [string, unknown][] = [];
  for (const [key, value] of Object.entries(report)) {
    out.push([key, value]);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const [k2, v2] of Object.entries(value as Record<string, unknown>)) {
        out.push([`${key}.${k2}`, v2]);
      }
    }
  }
  return out;
}

async function main(): Promise<void> {
  const limit = Number(process.argv[2] ?? 8);
  const store = await connect(loadConfig());
  const lookup = mongoLookup(store);
  const cardTags = store.db.collection("cardTags");
  const combos = (await store.db.collection("combos").find({}).toArray()) as never[];

  const emptyEverywhere = new Map<string, { count: number; why: string }>();
  // Scalar values per field, to find the ones that never move. EMPTINESS IS NOT THE ONLY SHAPE OF
  // AN UNREACHED FIELD, and the bug that prompted this audit proves it: `turn` was a hardcoded 5,
  // which is not empty, not null and not implausible -- it was just the same on every deck.
  const scalars = new Map<string, Set<string>>();
  let decks = 0;

  for (const file of readdirSync(DECK_DIR).filter((f) => f.endsWith(".txt")).sort().slice(0, limit)) {
    const sections = parseDecklistSections(readFileSync(join(DECK_DIR, file), "utf8"));
    const inputs: DeckCard[] = [];
    for (const name of [...sections.commanders, ...sections.deck]) {
      const doc = await lookup.findByName(normalizeName(name));
      if (!doc) continue;
      const tags = (await cardTags.findOne({ oracleId: doc._id })) as CardTags | null;
      inputs.push({ card: docToCard(doc), tags });
    }
    // Called the way the PRODUCT calls it (data.module.ts / cli main.ts): a ComboIndex, and the
    // commander taken from the decklist's first line when the file has no Commander section --
    // which every calibration file is. An audit that does not mirror the real wiring cannot see a
    // wiring defect, which is the only thing it exists to find.
    const commanderNames = sections.commanders.length > 0
      ? sections.commanders
      : [sections.deck[0]].filter(Boolean);
    const report = analyzeDeckStructured(
      inputs, commanderNames, undefined, undefined, new ComboIndex(combos),
    ) as unknown as Record<string, unknown>;
    decks++;
    for (const [path, value] of leaves(report)) {
      if (["number", "string", "boolean"].includes(typeof value)) {
        const seenValues = scalars.get(path) ?? new Set<string>();
        seenValues.add(String(value));
        scalars.set(path, seenValues);
      }
      const why = emptiness(value);
      if (why === null) continue;
      const prev = emptyEverywhere.get(path);
      emptyEverywhere.set(path, { count: (prev?.count ?? 0) + 1, why });
    }
  }

  console.log(`\n${decks} decks. Fields empty on EVERY one of them:\n`);
  const always = [...emptyEverywhere].filter(([, v]) => v.count === decks).sort();
  for (const [path, v] of always) console.log(`  ${path.padEnd(34)} ${v.why}`);
  console.log(`\n${always.length} always-empty fields. Sometimes-empty (deck-dependent, usually fine):\n`);
  for (const [path, v] of [...emptyEverywhere].filter(([, x]) => x.count < decks).sort()) {
    console.log(`  ${path.padEnd(34)} ${v.why} on ${v.count}/${decks}`);
  }
  const frozen = [...scalars].filter(([, v]) => v.size === 1).sort();
  console.log(`\nIdentical on every deck (a constant here is either a real constant or a wiring\ndefault that never reached the computation -- read each one):\n`);
  for (const [path, v] of frozen) console.log(`  ${path.padEnd(34)} always ${[...v][0]}`);
  await store.close();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error("report-audit failed:", err);
    process.exit(1);
  });
}
