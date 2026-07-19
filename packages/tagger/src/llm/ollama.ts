import type { ChatMessage, LlmProvider } from "./provider.js";

export interface OllamaOptions {
  model?: string;
  host?: string;
  /** Send format:"json" to grammar-constrain output. Default true. Turn OFF for reasoning models
   *  (qwen3) whose <think> phase the JSON grammar would suppress — enforce JSON via prompt instead. */
  jsonFormat?: boolean;
  /** Ollama `think` flag: enable a reasoning phase on thinking-capable models. Default false. */
  think?: boolean;
  fetchImpl?: typeof fetch;
}

const DEFAULT_MODEL = "qwen2.5:14b";
const DEFAULT_HOST = "http://localhost:11434";

export class OllamaProvider implements LlmProvider {
  readonly model: string;
  private readonly host: string;
  private readonly jsonFormat: boolean;
  private readonly think: boolean;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: OllamaOptions = {}) {
    this.model = opts.model ?? DEFAULT_MODEL;
    this.host = opts.host ?? DEFAULT_HOST;
    this.jsonFormat = opts.jsonFormat ?? true;
    this.think = opts.think ?? false;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async chat(messages: ChatMessage[]): Promise<string> {
    // /api/chat keeps the static system + few-shot turns as a stable prefix, so Ollama's
    // slot KV cache can reuse them across cards instead of re-prefilling every call.
    const body: Record<string, unknown> = { model: this.model, messages, stream: false, think: this.think };
    if (this.jsonFormat) body.format = "json";
    const res = await this.fetchImpl(`${this.host}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`Ollama request failed: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as { message?: { content?: string } };
    return json.message?.content ?? "";
  }
}
