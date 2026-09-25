import type { TaggerConfig } from "../config.js";
import { AnthropicProvider } from "./anthropic.js";
import type { LlmProvider } from "./provider.js";

/** Build the extraction provider. fetchImpl is injectable for tests. */
export function createProvider(cfg: TaggerConfig, fetchImpl?: typeof fetch): LlmProvider {
  if (!cfg.anthropicApiKey) {
    throw new Error("the tagger needs ANTHROPIC_API_KEY: source packages/tagger/.env first");
  }
  return new AnthropicProvider({
    model: cfg.model,
    apiKey: cfg.anthropicApiKey,
    baseUrl: cfg.anthropicBaseUrl,
    maxTokens: cfg.maxTokens,
    fetchImpl,
  });
}
