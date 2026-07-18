import type { LlmProvider } from "./provider.js";

export interface OllamaOptions {
  model?: string;
  host?: string;
  fetchImpl?: typeof fetch;
}

const DEFAULT_MODEL = "qwen2.5:14b";
const DEFAULT_HOST = "http://localhost:11434";

export class OllamaProvider implements LlmProvider {
  readonly model: string;
  private readonly host: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: OllamaOptions = {}) {
    this.model = opts.model ?? DEFAULT_MODEL;
    this.host = opts.host ?? DEFAULT_HOST;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async complete(prompt: string): Promise<string> {
    const res = await this.fetchImpl(`${this.host}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, prompt, stream: false, format: "json" }),
    });
    if (!res.ok) {
      throw new Error(`Ollama request failed: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as { response?: string };
    return json.response ?? "";
  }
}
