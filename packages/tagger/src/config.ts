export type TaggerProvider = "ollama" | "anthropic";

export interface TaggerConfig {
  /** Which extraction backend to use. */
  provider: TaggerProvider;
  /** Active model id for the chosen provider (recorded on tag output). */
  model: string;
  ollamaHost: string;
  /** Anthropic API key; required only when provider=anthropic. */
  anthropicApiKey?: string;
  anthropicBaseUrl: string;
  /** Max output tokens (Anthropic). */
  maxTokens: number;
  /** Number of extractions to run concurrently. */
  concurrency: number;
}

const DEFAULT_OLLAMA_MODEL = "qwen2.5:14b";
const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-4-5";

export function loadTaggerConfig(env: NodeJS.ProcessEnv = process.env): TaggerConfig {
  const provider: TaggerProvider = env.TAGGER_PROVIDER === "anthropic" ? "anthropic" : "ollama";
  const rawConc = Number(env.TAGGER_CONCURRENCY ?? env.OLLAMA_CONCURRENCY ?? "4");
  const concurrency = Number.isFinite(rawConc) && rawConc >= 1 ? Math.floor(rawConc) : 4;
  const rawMax = Number(env.ANTHROPIC_MAX_TOKENS ?? "1500");
  const maxTokens = Number.isFinite(rawMax) && rawMax >= 1 ? Math.floor(rawMax) : 1500;

  const model =
    provider === "anthropic"
      ? (env.ANTHROPIC_MODEL ?? DEFAULT_ANTHROPIC_MODEL)
      : (env.OLLAMA_MODEL ?? DEFAULT_OLLAMA_MODEL);

  return {
    provider,
    model,
    ollamaHost: env.OLLAMA_HOST ?? "http://localhost:11434",
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    anthropicBaseUrl: env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com",
    maxTokens,
    concurrency,
  };
}
