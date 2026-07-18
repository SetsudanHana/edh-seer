import type { Card } from "@mtg/engine";
import { SCHEMA_VERSION, type Ability, type CardTags } from "./schema.js";
import { extractCharacteristics } from "./characteristics.js";
import type { LlmProvider } from "./llm/provider.js";
import { buildAbilityPrompt, PROMPT_VERSION } from "./llm/prompt.js";
import { parseAbilities } from "./validate.js";

const MAX_ATTEMPTS = 2;

export async function extractCardTags(
  oracleId: string,
  card: Card,
  llm: LlmProvider,
): Promise<CardTags> {
  const characteristics = extractCharacteristics(card);
  const prompt = buildAbilityPrompt(card);
  const abilities = await extractAbilities(prompt, llm);
  return {
    oracleId,
    schemaVersion: SCHEMA_VERSION,
    promptVersion: PROMPT_VERSION,
    model: llm.model,
    characteristics,
    abilities,
  };
}

async function extractAbilities(prompt: string, llm: LlmProvider): Promise<Ability[]> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const raw = await llm.complete(prompt);
    try {
      return parseAbilities(raw);
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(`Ability extraction failed after ${MAX_ATTEMPTS} attempts: ${(lastErr as Error).message}`);
}
