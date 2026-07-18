export interface TaggerConfig {
  model: string;
  ollamaHost: string;
  /** Number of extractions to run against Ollama concurrently. */
  concurrency: number;
}

export function loadTaggerConfig(env: NodeJS.ProcessEnv = process.env): TaggerConfig {
  const concurrency = Number(env.OLLAMA_CONCURRENCY ?? "4");
  return {
    model: env.OLLAMA_MODEL ?? "qwen2.5:14b",
    ollamaHost: env.OLLAMA_HOST ?? "http://localhost:11434",
    concurrency: Number.isFinite(concurrency) && concurrency >= 1 ? Math.floor(concurrency) : 4,
  };
}
