export interface TaggerConfig {
  /** Model id sent to Anthropic, and recorded on the output. */
  model: string;
  /** Anthropic API key. Only a call needs it, so a dry run works without one. */
  anthropicApiKey?: string;
  anthropicBaseUrl: string;
  /** Max output tokens. */
  maxTokens: number;
  /** Number of extractions to run concurrently. */
  concurrency: number;
}

/** THE MODEL EVERY MEASUREMENT WAS TAKEN ON. The spending bins refuse to persist any other model's
 *  output unless told to, because staleness compares segment hash and normalize version, never the
 *  model: a corpus written by another model would look fresh forever. */
export const MEASURED_MODEL = "claude-haiku-4-5";

export function loadTaggerConfig(env: NodeJS.ProcessEnv = process.env): TaggerConfig {
  const rawConc = Number(env.TAGGER_CONCURRENCY ?? "4");
  const concurrency = Number.isFinite(rawConc) && rawConc >= 1 ? Math.floor(rawConc) : 4;
  const rawMax = Number(env.ANTHROPIC_MAX_TOKENS ?? "1500");
  const maxTokens = Number.isFinite(rawMax) && rawMax >= 1 ? Math.floor(rawMax) : 1500;
  return {
    model: env.ANTHROPIC_MODEL ?? MEASURED_MODEL,
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    anthropicBaseUrl: env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com",
    maxTokens,
    concurrency,
  };
}
