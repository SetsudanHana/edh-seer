export interface TaggerConfig {
  model: string;
  ollamaHost: string;
}

export function loadTaggerConfig(env: NodeJS.ProcessEnv = process.env): TaggerConfig {
  return {
    model: env.OLLAMA_MODEL ?? "qwen2.5:14b",
    ollamaHost: env.OLLAMA_HOST ?? "http://localhost:11434",
  };
}
