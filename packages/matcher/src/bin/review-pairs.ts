import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { applyDecision, pendingIndices, type Decision } from "./review-core.js";
import type { GoldPair } from "./eval-pairs-core.js";

const GOLD_URL = new URL("../goldpairs.json", import.meta.url);

async function main(): Promise<void> {
  let pairs = JSON.parse(readFileSync(GOLD_URL, "utf8")) as GoldPair[];
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  // Re-read pending indices after every mutation, since reject shifts positions.
  for (;;) {
    const pending = pendingIndices(pairs);
    if (pending.length === 0) break;
    const i = pending[0];
    const p = pairs[i];
    const ans = (await rl.question(
      `[${p.category}] ${p.a} / ${p.b}\n  ${p.note}\n  accept / reject / quit (a/r/q)? `,
    )).trim().toLowerCase();
    if (ans === "q") break;
    if (ans !== "a" && ans !== "r") {
      console.log("  (unrecognized — skipping, will revisit next run)");
      // Move it to the end so we don't loop forever on the same entry this session.
      pairs = [...pairs.slice(0, i), ...pairs.slice(i + 1), p];
      continue;
    }
    const decision: Decision = ans === "a" ? "accept" : "reject";
    pairs = applyDecision(pairs, i, decision);
    writeFileSync(fileURLToPath(GOLD_URL), JSON.stringify(pairs, null, 2) + "\n");
  }
  rl.close();

  const verified = pairs.filter((p) => p.verified).length;
  console.log(`\ndone. ${verified} verified, ${pendingIndices(pairs).length} still pending.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error("review-pairs failed:", err);
    process.exit(1);
  });
}
