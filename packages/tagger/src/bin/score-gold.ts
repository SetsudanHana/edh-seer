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
  for (const g of gold) {
    const predicted = await extractCardTags(g.oracleId, g.card, llm);
    scores.push(scoreCard(predicted, g.expected));
  }
  console.log(formatReport(aggregate(scores)));
}

main().catch((err) => {
  console.error("score-gold failed:", err);
  process.exit(1);
});
