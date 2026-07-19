import type { Card } from "@mtg/engine";
import { SCHEMA_VERSION, type Ability, type CardTags } from "./schema.js";
import { extractCharacteristics } from "./characteristics.js";
import type { ChatMessage, LlmProvider } from "./llm/provider.js";
import { buildAbilityMessages, PROMPT_VERSION } from "./llm/prompt.js";
import { parseAbilities } from "./validate.js";

const MAX_ATTEMPTS = 2;

export async function extractCardTags(
  oracleId: string,
  card: Card,
  llm: LlmProvider,
): Promise<CardTags> {
  const characteristics = extractCharacteristics(card);
  const messages = buildAbilityMessages(card);
  const abilities = await extractAbilities(messages, llm);
  return {
    oracleId,
    schemaVersion: SCHEMA_VERSION,
    promptVersion: PROMPT_VERSION,
    model: llm.model,
    characteristics,
    abilities,
  };
}

async function extractAbilities(messages: ChatMessage[], llm: LlmProvider): Promise<Ability[]> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const raw = await llm.chat(messages);
    try {
      return parseAbilities(raw);
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(`Ability extraction failed after ${MAX_ATTEMPTS} attempts: ${(lastErr as Error).message}`);
}
