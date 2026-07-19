export type TaggerProvider = "ollama" | "anthropic";

export interface TaggerConfig {
  /** Which extraction backend to use. */
  provider: TaggerProvider;
  /** Active model id for the chosen provider (recorded on tag output). */
  model: string;
  ollamaHost: string;
  /** Send Ollama format:"json". Off for reasoning models; JSON is then enforced via prompt. */
  ollamaJsonFormat: boolean;
  /** Enable Ollama's `think` reasoning phase (qwen3 etc.). */
  ollamaThink: boolean;
  /** Ollama sampling/context options; each undefined = leave Ollama's default. */
  ollamaNumCtx?: number;
  ollamaTemperature?: number;
  ollamaTopP?: number;
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

/** Parse an env value to a finite number, or undefined if absent/invalid (→ Ollama's default). */
function numOrUndefined(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

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
    ollamaJsonFormat: env.OLLAMA_FORMAT_JSON !== "false",
    ollamaThink: env.OLLAMA_THINK === "true",
    ollamaNumCtx: numOrUndefined(env.OLLAMA_NUM_CTX),
    ollamaTemperature: numOrUndefined(env.OLLAMA_TEMPERATURE),
    ollamaTopP: numOrUndefined(env.OLLAMA_TOP_P),
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    anthropicBaseUrl: env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com",
    maxTokens,
    concurrency,
  };
}
