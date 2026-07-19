import type { TaggerConfig } from "../config.js";
import { AnthropicProvider } from "./anthropic.js";
import { OllamaProvider } from "./ollama.js";
import type { LlmProvider } from "./provider.js";

/** Build the extraction provider selected by config. fetchImpl is injectable for tests. */
export function createProvider(cfg: TaggerConfig, fetchImpl?: typeof fetch): LlmProvider {
  if (cfg.provider === "anthropic") {
    if (!cfg.anthropicApiKey) {
      throw new Error("provider=anthropic requires ANTHROPIC_API_KEY");
    }
    return new AnthropicProvider({
      model: cfg.model,
      apiKey: cfg.anthropicApiKey,
      baseUrl: cfg.anthropicBaseUrl,
      maxTokens: cfg.maxTokens,
      fetchImpl,
    });
  }
  return new OllamaProvider({ model: cfg.model, host: cfg.ollamaHost, fetchImpl });
}
