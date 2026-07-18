import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadGold } from "../gold.js";
import { extractCardTags } from "../extract.js";
import { scoreCard, aggregate, abilityKeys, type CardScore } from "../score.js";
import { OllamaProvider } from "../llm/ollama.js";
import { loadTaggerConfig } from "../config.js";
import { formatReport } from "../report.js";
import { mapPool } from "../pool.js";
import { startProgress } from "../progress.js";

interface DebugEntry {
  name: string;
  gold: string[];
  predicted: string[];
}

async function main(): Promise<void> {
  const cfg = loadTaggerConfig();
  const llm = new OllamaProvider({ model: cfg.model, host: cfg.ollamaHost });
  const gold = loadGold();
  const scores: CardScore[] = [];
  const failures: string[] = [];
  const debug: DebugEntry[] = [];

  console.log(`scoring ${gold.length} gold cards at concurrency ${cfg.concurrency} (model ${cfg.model})...`);
  const progress = startProgress(gold.length);
  await mapPool(gold, cfg.concurrency, async (g) => {
    try {
      const predicted = await extractCardTags(g.oracleId, g.card, llm);
      scores.push(scoreCard(predicted, g.expected));
      debug.push({
        name: g.card.name,
        gold: abilityKeys(g.expected.abilities),
        predicted: abilityKeys(predicted.abilities),
      });
    } catch (err) {
      // One card the model won't produce valid output for shouldn't sink the whole run.
      failures.push(`${g.card.name}: ${(err as Error).message}`);
    }
    progress.tick();
  });

  // Dump predicted-vs-gold ability keys for diagnosis (gitignored).
  const debugPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "score-debug.json");
  writeFileSync(debugPath, JSON.stringify(debug, null, 2) + "\n");
  console.log(`wrote per-card key diff to ${debugPath}`);

  console.log(formatReport(aggregate(scores)));
  if (failures.length > 0) {
    console.log(`\nextraction failures: ${failures.length}/${gold.length} (excluded from F1)`);
    for (const f of failures) console.log(`  ${f}`);
  }
}

main().catch((err) => {
  console.error("score-gold failed:", err);
  process.exit(1);
});
