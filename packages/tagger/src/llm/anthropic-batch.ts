/** The Anthropic Message Batches API, raw over `fetch` like the live client beside it.
 *
 *  HALF PRICE for the SAME request. It batches the TRANSPORT, never the prompt: each card still
 *  carries its own one-card request built by the shared `anthropicBody`, so the 2026-08 prompt-
 *  stuffing defect (40 cards in one prompt, dropped and duplicated clauses) cannot recur here.
 *  What you pay for the discount is latency — results arrive within 24h rather than immediately.
 *
 *  No SDK: this repo already talks to `/v1/messages` over `fetch`, and a dependency to reach two
 *  more endpoints would be the larger change. */
import type { ChatMessage } from "./provider.js";
import { anthropicBody } from "./anthropic.js";

const ANTHROPIC_VERSION = "2023-06-01";

export interface BatchRequest {
  /** Anthropic's own constraint: <= 64 chars, alphanumeric plus underscore and hyphen. A Scryfall
   *  oracle id is a 36-char UUID, so it satisfies both without encoding. */
  customId: string;
  messages: ChatMessage[];
}

export interface BatchStatus {
  id: string;
  /** `in_progress` | `canceling` | `ended`. Only `ended` means the results are fetchable. */
  processingStatus: string;
  counts: Record<string, number>;
  resultsUrl: string | null;
}

/** One result line. `type` is succeeded | errored | canceled | expired — the last two are why a
 *  collector must never assume a submitted card came back. */
export interface BatchResult {
  customId: string;
  type: string;
  body?: unknown;
  error?: string;
}

interface Client {
  apiKey: string;
  baseUrl: string;
  model: string;
  maxTokens: number;
  fetchImpl?: typeof fetch;
}

const headers = (c: Client) => ({
  "Content-Type": "application/json",
  "x-api-key": c.apiKey,
  "anthropic-version": ANTHROPIC_VERSION,
});

async function call(c: Client, path: string, init?: RequestInit): Promise<Response> {
  const res = await (c.fetchImpl ?? fetch)(`${c.baseUrl}${path}`, { ...init, headers: headers(c) });
  if (!res.ok) throw new Error(`Batch API ${path} failed: ${res.status} ${await res.text()}`);
  return res;
}

/** A batch id is NETWORK DATA and it is used to build a file path, so it is checked before it is
 *  joined rather than trusted for coming from Anthropic. `join` resolves `..`, so an id containing
 *  one writes outside `.batches/`; a leading `/` replaces the directory outright. Nothing about a
 *  remote response is a promise about the local filesystem.
 *
 *  An ALLOW-list, never a strip: rejecting an id we cannot name is the right failure direction here,
 *  because the alternative is silently writing the state file somewhere the operator will not look
 *  for it — and losing the state file means losing every card the batch was paid for. Anthropic's
 *  ids are `msgbatch_` plus alphanumerics; the length bound keeps a pathological one out of a
 *  filename. */
export function safeBatchId(id: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
    throw new Error(`Refusing to write a state file for a batch id that is not a safe filename: ${JSON.stringify(id.slice(0, 80))}`);
  }
  return id;
}

/** Submit one batch. Returns its id. */
export async function submitBatch(c: Client, requests: BatchRequest[], prefill: boolean): Promise<string> {
  const body = {
    requests: requests.map((r) => ({
      custom_id: r.customId,
      params: anthropicBody(c.model, c.maxTokens, r.messages, prefill),
    })),
  };
  const res = await call(c, "/v1/messages/batches", { method: "POST", body: JSON.stringify(body) });
  return ((await res.json()) as { id: string }).id;
}

export async function batchStatus(c: Client, id: string): Promise<BatchStatus> {
  const res = await call(c, `/v1/messages/batches/${id}`);
  const j = (await res.json()) as {
    id: string; processing_status: string; request_counts?: Record<string, number>; results_url?: string | null;
  };
  return { id: j.id, processingStatus: j.processing_status, counts: j.request_counts ?? {}, resultsUrl: j.results_url ?? null };
}

/** Stream the results JSONL.
 *
 *  RESULTS COME BACK IN ANY ORDER — Anthropic says so outright — so a caller must key on
 *  `customId` and never on position. Reading them positionally would silently write each card's
 *  clauses onto a different card, which is the worst failure this pipeline has available to it. */
export async function batchResults(c: Client, id: string): Promise<BatchResult[]> {
  const res = await call(c, `/v1/messages/batches/${id}/results`);
  const out: BatchResult[] = [];
  for (const line of (await res.text()).split("\n")) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as {
      custom_id: string;
      result: { type: string; message?: unknown; error?: { message?: string; type?: string } };
    };
    out.push({
      customId: row.custom_id,
      type: row.result.type,
      body: row.result.message,
      error: row.result.error?.message ?? row.result.error?.type,
    });
  }
  return out;
}
