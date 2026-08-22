import { expect, test } from "vitest";
import { anthropicBody } from "./anthropic.js";
import { batchResults, submitBatch } from "./anthropic-batch.js";

const client = (impl: typeof fetch) => ({
  apiKey: "k", baseUrl: "https://api.example", model: "claude-haiku-4-5", maxTokens: 3000, fetchImpl: impl,
});

const MESSAGES = [
  { role: "system" as const, content: "SYS" },
  { role: "user" as const, content: "Card: Bitterblossom" },
];

/** THE WHOLE JUSTIFICATION FOR --batch IS THAT THE REQUEST DOES NOT CHANGE.
 *
 *  Half price is only a discount if it buys the same corpus. If the batch path ever built its own
 *  body, the cheap arm would be answering a different question and every measurement taken against
 *  the live path would stop applying to it — the prompt-stuffing defect one level up. */
test("a batched request is byte-identical to the live one", async () => {
  let sent: string | undefined;
  const c = client((async (_u: string, init?: RequestInit) => {
    sent = init?.body as string;
    return new Response(JSON.stringify({ id: "msgbatch_01" }), { status: 200 });
  }) as unknown as typeof fetch);

  const id = await submitBatch(c, [{ customId: "abc", messages: MESSAGES }], true);
  expect(id).toBe("msgbatch_01");

  const body = JSON.parse(sent!) as { requests: { custom_id: string; params: unknown }[] };
  expect(body.requests).toHaveLength(1);
  expect(body.requests[0].custom_id).toBe("abc");
  expect(body.requests[0].params).toEqual(anthropicBody("claude-haiku-4-5", 3000, MESSAGES, true));
});

/** Results come back in ANY order, so the collector keys on `custom_id`. Reading them positionally
 *  would write each card's clauses onto a DIFFERENT card — a silent, corpus-wide wrong answer, and
 *  the worst failure this pipeline has available to it. The fixture is deliberately out of order. */
test("results parse by custom_id, not position, and non-succeeded rows survive", async () => {
  const jsonl = [
    JSON.stringify({ custom_id: "second", result: { type: "succeeded", message: { content: [{ type: "text", text: "B" }] } } }),
    JSON.stringify({ custom_id: "first", result: { type: "succeeded", message: { content: [{ type: "text", text: "A" }] } } }),
    JSON.stringify({ custom_id: "third", result: { type: "errored", error: { message: "overloaded" } } }),
    "",
  ].join("\n");
  const c = client((async () => new Response(jsonl, { status: 200 })) as unknown as typeof fetch);

  const rows = await batchResults(c, "msgbatch_01");
  expect(rows).toHaveLength(3); // the blank trailing line is not a result

  const byId = new Map(rows.map((r) => [r.customId, r]));
  expect(byId.get("first")!.type).toBe("succeeded");
  expect(byId.get("third")!.type).toBe("errored");
  expect(byId.get("third")!.error).toBe("overloaded");
  // Position and identity genuinely disagree in this fixture, which is the point of the test.
  expect(rows[0].customId).toBe("second");
});

test("a failed call names the endpoint rather than throwing a bare status", async () => {
  const c = client((async () => new Response("nope", { status: 429 })) as unknown as typeof fetch);
  await expect(batchResults(c, "msgbatch_01")).rejects.toThrow(/batches\/msgbatch_01\/results failed: 429/);
});
