import { expect, test, vi } from "vitest";
import { AnthropicProvider } from "./anthropic.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

test("posts to /v1/messages: system cached, prefill added, prefix re-attached", async () => {
  const fetchImpl = vi.fn(async () =>
    jsonResponse({ content: [{ type: "text", text: '"abilities":[]}' }] }),
  ) as unknown as typeof fetch;

  const p = new AnthropicProvider({ model: "claude-haiku-4-5", apiKey: "sk-test", fetchImpl });
  const out = await p.chat([
    { role: "system", content: "SYS" },
    { role: "user", content: "U1" },
    { role: "assistant", content: "A1" },
    { role: "user", content: "CARD" },
  ]);

  // The "{" prefill is re-attached to the API's continuation.
  expect(out).toBe('{"abilities":[]}');

  const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
  expect(url).toBe("https://api.anthropic.com/v1/messages");
  const headers = (init as RequestInit).headers as Record<string, string>;
  expect(headers["x-api-key"]).toBe("sk-test");
  expect(headers["anthropic-version"]).toBe("2023-06-01");

  const body = JSON.parse((init as RequestInit).body as string);
  expect(body.model).toBe("claude-haiku-4-5");
  expect(body.system[0]).toEqual({ type: "text", text: "SYS", cache_control: { type: "ephemeral" } });
  // system stripped from messages; assistant "{" prefill appended.
  expect(body.messages).toEqual([
    { role: "user", content: "U1" },
    { role: "assistant", content: "A1" },
    { role: "user", content: "CARD" },
    { role: "assistant", content: "{" },
  ]);
});

test("throws on non-ok response", async () => {
  const fetchImpl = vi.fn(async () => jsonResponse({ error: "bad" }, 401)) as unknown as typeof fetch;
  const p = new AnthropicProvider({ model: "claude-haiku-4-5", apiKey: "x", fetchImpl });
  await expect(p.chat([{ role: "user", content: "x" }])).rejects.toThrow(/anthropic/i);
});
