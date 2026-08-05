import type { ChatMessage, LlmProvider } from "./provider.js";

export interface AnthropicOptions {
  model: string;
  apiKey: string;
  baseUrl?: string;
  maxTokens?: number;
  fetchImpl?: typeof fetch;
}

const DEFAULT_BASE_URL = "https://api.anthropic.com";
const DEFAULT_MAX_TOKENS = 1500;
const ANTHROPIC_VERSION = "2023-06-01";

interface AnthropicContentBlock {
  type: string;
  text?: string;
}

/** Claude behind the shared LlmProvider interface. The static system block is marked
 *  cache_control:ephemeral so repeated calls read it from cache instead of re-billing full
 *  input; an assistant "{" prefill forces the reply to start as a JSON object (Anthropic has no
 *  format:"json" flag), which parseAbilities then consumes. */
export class AnthropicProvider implements LlmProvider {
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly maxTokens: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: AnthropicOptions) {
    this.model = opts.model;
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
    this.maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async chat(messages: ChatMessage[]): Promise<string> {
    // Newer models reject a prefilled assistant turn ("This model does not support assistant
    // message prefill"), so fall back to asking for the object outright. Detected once per
    // instance rather than per call.
    try {
      return await this.request(messages, this.prefillSupported);
    } catch (e) {
      if (this.prefillSupported && /does not support assistant message prefill/i.test((e as Error).message)) {
        this.prefillSupported = false;
        return await this.request(messages, false);
      }
      throw e;
    }
  }

  private prefillSupported = true;

  private async request(messages: ChatMessage[], prefill: boolean): Promise<string> {
    const systemText = messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const convo = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role, content: m.content }));
    // Prefill the assistant turn with "{" so the model must emit a JSON object; we re-add it below.
    if (prefill) convo.push({ role: "assistant", content: "{" });
    else convo[convo.length - 1] = {
      ...convo[convo.length - 1],
      content: `${convo[convo.length - 1].content}\n\nReturn ONLY the JSON object, starting with {.`,
    };

    const res = await this.fetchImpl(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: this.maxTokens,
        system: [{ type: "text", text: systemText, cache_control: { type: "ephemeral" } }],
        messages: convo,
      }),
    });
    if (!res.ok) {
      throw new Error(`Anthropic request failed: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as { content?: AnthropicContentBlock[]; stop_reason?: string };
    // Truncation surfaces downstream as "Unterminated string in JSON", which reads like a model
    // fault and sends you looking in the wrong place. It is a budget fault, so say so here.
    if (json.stop_reason === "max_tokens") {
      throw new Error(
        `Anthropic response hit max_tokens (${this.maxTokens}) and is truncated — the JSON cannot ` +
          `parse. Raise ANTHROPIC_MAX_TOKENS, or send fewer cards per batch.`,
      );
    }
    const text = (json.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");
    // Re-attach the prefilled "{" the API omits from its continuation. Without prefill the model
    // emits the whole object itself, so return it as-is (trimming any stray prose fence).
    if (!prefill) return text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
    return `{${text}`;
  }
}
