import type { ChatMessage, LlmProvider } from "./provider.js";

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

  async chat(messages: ChatMessage[]): Promise<string> {
    // /api/chat keeps the static system + few-shot turns as a stable prefix, so Ollama's
    // slot KV cache can reuse them across cards instead of re-prefilling every call.
    const res = await this.fetchImpl(`${this.host}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, messages, stream: false, format: "json" }),
    });
    if (!res.ok) {
      throw new Error(`Ollama request failed: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as { message?: { content?: string } };
    return json.message?.content ?? "";
  }
}
