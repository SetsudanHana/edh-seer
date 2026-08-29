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

export interface AnthropicResponse {
  content?: AnthropicContentBlock[];
  stop_reason?: string;
}

/** The request body, byte-identical whichever transport sends it.
 *
 *  Extracted so the Batch API submits exactly what the per-card path submits. A batch is priced at
 *  half rate for the SAME request -- if the two ever drifted, the cheaper arm would be answering a
 *  different question and the discount would be buying a different corpus. */
export function anthropicBody(
  model: string,
  maxTokens: number,
  messages: ChatMessage[],
  prefill: boolean,
): Record<string, unknown> {
  const systemText = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const convo = messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role, content: m.content }));
  // Prefill the assistant turn with "{" so the model must emit a JSON object; we re-add it below.
  if (prefill) convo.push({ role: "assistant", content: "{" });
  else convo[convo.length - 1] = {
    ...convo[convo.length - 1],
    content: `${convo[convo.length - 1].content}\n\nReturn ONLY the JSON object, starting with {.`,
  };
  return {
    model,
    max_tokens: maxTokens,
    // MEASURED 2026-08-29: THIS MARKER IS INERT AND HAS BEEN FOR THE PROJECT'S WHOLE LIFE. The
    // normalize system block is ~2,700 tokens and Claude Haiku 4.5's minimum cacheable prompt is
    // 4,096 -- and Anthropic's own docs say a request under the minimum is "processed without
    // caching, and NO ERROR IS RETURNED", which is exactly why nobody noticed.
    //
    // Proven three ways rather than argued. (1) The whole 2026-08-22 batch, all 1,408 cards:
    // cache_creation_input_tokens 0 AND cache_read_input_tokens 0. (2) A live call, same prompt,
    // same zero -- so it is not the Batch API's best-effort caching missing. (3) The threshold
    // bracketed by doubling the block: at 2,788 tokens write 0 / read 0, at 5,466 tokens write
    // 5,466 then read 5,466 on the next call. 4,096 sits between the two.
    //
    // WHAT IT COSTS, because the number is the reason to care: the system block is 97.6% of the
    // input bill (one copy ~2,531 tok against a ~59-token card, repeated once per card), and a
    // cache read bills at 0.1x. On a whole-corpus buy that is ~$63 against ~$13.
    //
    // NOT FIXED HERE, DELIBERATELY. Clearing 4,096 means ENLARGING the system prompt, which changes
    // what the model answers on every card -- a NORMALIZE_VERSION question with corpus-wide blast
    // radius, not a tuning knob. Padding it with inert filler to game the threshold is the same
    // change wearing a disguise: the prompt is the specification, and 1,400 tokens of nothing in it
    // is 1,400 tokens the model reads. Left set so the day the prompt legitimately grows past the
    // minimum, the discount arrives on its own.
    //
    // AND IT IS TWO CHANGES, NOT ONE: batches routinely run longer than the default 5-minute
    // entry, so a fix wants ttl "1h" as well or the entry expires mid-batch. Anthropic puts batch
    // hit rates at 30-98%, best-effort. Cache pre-warming (max_tokens 0) is NOT supported inside a
    // batch, so the warm has to come from the batch's own first requests.
    system: [{ type: "text", text: systemText, cache_control: { type: "ephemeral" } }],
    messages: convo,
  };
}

/** Pull the completion text out of a response body, re-attaching the prefilled "{" the API omits
 *  from its continuation. Shared with the batch collector, which reads the identical shape out of
 *  the results JSONL. */
export function anthropicText(json: AnthropicResponse, prefill: boolean, maxTokens: number): string {
  if (json.stop_reason === "max_tokens") {
    throw new Error(
      `Anthropic response hit max_tokens (${maxTokens}) and is truncated — the JSON cannot ` +
        `parse. Raise ANTHROPIC_MAX_TOKENS, or send fewer cards per batch.`,
    );
  }
  const text = (json.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
  if (!prefill) return text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  return `{${text}`;
}

/** Claude behind the shared LlmProvider interface. An assistant "{" prefill forces the reply to
 *  start as a JSON object (Anthropic has no format:"json" flag), which parseAbilities then
 *  consumes.
 *
 *  THE cache_control BELOW HAS NEVER ONCE FIRED, AND THIS COMMENT USED TO CLAIM IT DID. See
 *  anthropicBody. */
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

  /** Whether this model accepted an assistant prefill. Read by the batch submitter, which
   *  cannot do the per-call try/catch fallback and must decide the shape up front. */
  get prefill(): boolean { return this.prefillSupported; }

  private prefillSupported = true;

  private async request(messages: ChatMessage[], prefill: boolean): Promise<string> {
    const res = await this.fetchImpl(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify(anthropicBody(this.model, this.maxTokens, messages, prefill)),
    });
    if (!res.ok) {
      throw new Error(`Anthropic request failed: ${res.status} ${await res.text()}`);
    }
    // Truncation surfaces downstream as "Unterminated string in JSON", which reads like a model
    // fault and sends you looking in the wrong place. It is a budget fault, so `anthropicText` says so.
    return anthropicText((await res.json()) as AnthropicResponse, prefill, this.maxTokens);
  }
}
