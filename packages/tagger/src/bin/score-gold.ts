import { loadGold } from "../gold.js";
import { extractCardTags } from "../extract.js";
import { scoreCard, aggregate, type CardScore } from "../score.js";
import { OllamaProvider } from "../llm/ollama.js";
import { loadTaggerConfig } from "../config.js";
import { formatReport } from "../report.js";

async function main(): Promise<void> {
  const cfg = loadTaggerConfig();
  const llm = new OllamaProvider({ model: cfg.model, host: cfg.ollamaHost });
  const gold = loadGold();
  const scores: CardScore[] = [];
  const failures: string[] = [];
  for (const g of gold) {
    process.stdout.write(`\rscoring ${scores.length + failures.length + 1}/${gold.length} ...`);
    try {
      const predicted = await extractCardTags(g.oracleId, g.card, llm);
      scores.push(scoreCard(predicted, g.expected));
    } catch (err) {
      // One card the model won't produce valid output for shouldn't sink the whole run.
      failures.push(`${g.card.name}: ${(err as Error).message}`);
    }
  }
  process.stdout.write("\n");
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
