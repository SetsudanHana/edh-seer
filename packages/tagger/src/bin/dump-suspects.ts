import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { connect, loadConfig, type CardDoc } from "@edh-seer/data";
import { renderPreamble } from "./corpus-core.js";

// Usage: dump-suspects [--size N] [--out DIR]
// One-off: dumps cards whose oracle text names an explicit power/toughness numeric threshold
// (the Slice 1 A-path shape — "power 2 or less" etc.), regardless of edhrecRank/needsRetag,
// so the v23 StatPredicate teaching can be spot-applied without a full corpus re-grind.
const PATTERNS = [
  /power \d+ or (less|greater)/i,
  /toughness \d+ or (less|greater)/i,
  /power (is )?(greater|less) than/i,
  /toughness (is )?(greater|less) than/i,
  /power or toughness \d+ or (less|greater)/i,
  /with power \d+/i,
  /with toughness \d+/i,
  /power and toughness \d+ or (less|greater)/i,
];

async function main(): Promise<void> {
  const args = new Map<string, string>();
  for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1]);
  const size = Number(args.get("size") ?? 40);
  const outDir = args.get("out") ?? "/tmp/mtg-tag-batches";

  const store = await connect(loadConfig());
  const cards = (await store.db.collection("cards").find({}).toArray()) as unknown as CardDoc[];

  const picked = cards
    .filter((c) => c.oracleText.trim() !== "" && PATTERNS.some((p) => p.test(c.oracleText)))
    .sort((x, y) => x._id.localeCompare(y._id));

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "preamble.txt"), picked.length ? renderPreamble(picked[0]) : "");
  let written = 0;
  for (let i = 0; i < picked.length; i += size) {
    const batch = picked.slice(i, i + size).map((c) => ({ oracleId: c._id, name: c.name, oracleText: c.oracleText }));
    writeFileSync(join(outDir, `batch-${written}.json`), JSON.stringify(batch, null, 1));
    written++;
  }
  console.log(`dumped ${picked.length} suspect cards into ${written} batch file(s) at ${outDir} (preamble.txt written).`);
  await store.close();
}

main().catch((e) => { console.error("dump-suspects failed:", e); process.exit(1); });
