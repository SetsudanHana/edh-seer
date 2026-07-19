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
  ollamaTopK?: number;
  ollamaRepeatPenalty?: number;
  ollamaMinP?: number;
  /** Selected preset name (OLLAMA_PRESET), used to label per-run output files. */
  ollamaPreset?: string;
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

/** Bundled Ollama flags + vendor-recommended sampling for a model family/mode. Selected with
 *  OLLAMA_PRESET; every field is a DEFAULT that an explicit env var still overrides. Numbers are
 *  from the Qwen model-card "best practices" sections (thinking vs non-thinking differ). */
interface OllamaPreset {
  think?: boolean;
  jsonFormat?: boolean;
  numCtx?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  repeatPenalty?: number;
  minP?: number;
}

const PRESETS: Readonly<Record<string, OllamaPreset>> = {
  "qwen2.5": { think: false, jsonFormat: true, temperature: 0.7, topP: 0.8, topK: 20, repeatPenalty: 1.05 },
  "qwen3-think": { think: true, jsonFormat: false, temperature: 0.6, topP: 0.95, topK: 20, minP: 0, numCtx: 8192 },
  "qwen3-nothink": { think: false, jsonFormat: true, temperature: 0.7, topP: 0.8, topK: 20, minP: 0, numCtx: 8192 },
  "qwen3.5": { think: true, jsonFormat: false, temperature: 0.6, topP: 0.95, topK: 20, repeatPenalty: 1.05, minP: 0, numCtx: 8192 },
};

/** Parse an env value to a finite number, or undefined if absent/invalid (→ preset/Ollama default). */
function numOrUndefined(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** Boolean env with a three-way outcome: explicit "true"/"false" wins, else the preset fallback. */
function boolEnv(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined) return fallback;
  return v === "true";
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

  // Preset supplies defaults; individual OLLAMA_* env vars override any preset field.
  const p: OllamaPreset = (env.OLLAMA_PRESET && PRESETS[env.OLLAMA_PRESET]) || {};

  return {
    provider,
    model,
    ollamaHost: env.OLLAMA_HOST ?? "http://localhost:11434",
    ollamaJsonFormat: boolEnv(env.OLLAMA_FORMAT_JSON, p.jsonFormat ?? true),
    ollamaThink: boolEnv(env.OLLAMA_THINK, p.think ?? false),
    ollamaNumCtx: numOrUndefined(env.OLLAMA_NUM_CTX) ?? p.numCtx,
    ollamaTemperature: numOrUndefined(env.OLLAMA_TEMPERATURE) ?? p.temperature,
    ollamaTopP: numOrUndefined(env.OLLAMA_TOP_P) ?? p.topP,
    ollamaTopK: numOrUndefined(env.OLLAMA_TOP_K) ?? p.topK,
    ollamaRepeatPenalty: numOrUndefined(env.OLLAMA_REPEAT_PENALTY) ?? p.repeatPenalty,
    ollamaMinP: numOrUndefined(env.OLLAMA_MIN_P) ?? p.minP,
    ollamaPreset: env.OLLAMA_PRESET || undefined,
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    anthropicBaseUrl: env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com",
    maxTokens,
    concurrency,
  };
}
