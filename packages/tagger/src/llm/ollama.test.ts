import { expect, test, vi } from "vitest";
import { OllamaProvider } from "./ollama.js";

test("posts messages to ollama chat endpoint with json format, returns message content", async () => {
  const fetchImpl = vi.fn(async () =>
    new Response(JSON.stringify({ message: { content: '{"abilities":[]}' } }), { status: 200 }),
  ) as unknown as typeof fetch;

  const p = new OllamaProvider({ model: "qwen2.5:14b", host: "http://localhost:11434", fetchImpl });
  const out = await p.chat([
    { role: "system", content: "SYS" },
    { role: "user", content: "PROMPT" },
  ]);

  expect(out).toBe('{"abilities":[]}');
  const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
  expect(url).toBe("http://localhost:11434/api/chat");
  const body = JSON.parse((init as RequestInit).body as string);
  expect(body.model).toBe("qwen2.5:14b");
  expect(body.messages).toEqual([
    { role: "system", content: "SYS" },
    { role: "user", content: "PROMPT" },
  ]);
  expect(body.stream).toBe(false);
  expect(body.format).toBe("json");
});

test("omits format and enables think when configured for a reasoning model", async () => {
  const fetchImpl = vi.fn(async () =>
    new Response(JSON.stringify({ message: { content: '{"abilities":[]}' } }), { status: 200 }),
  ) as unknown as typeof fetch;

  const p = new OllamaProvider({ model: "qwen3:14b", jsonFormat: false, think: true, fetchImpl });
  await p.chat([{ role: "user", content: "x" }]);

  const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
  const body = JSON.parse((init as RequestInit).body as string);
  expect(body.format).toBeUndefined();
  expect(body.think).toBe(true);
});

test("sends only the sampling/context options that are set", async () => {
  const fetchImpl = vi.fn(async () =>
    new Response(JSON.stringify({ message: { content: '{"abilities":[]}' } }), { status: 200 }),
  ) as unknown as typeof fetch;

  const p = new OllamaProvider({ numCtx: 8192, temperature: 0.6, topP: 0.95, fetchImpl });
  await p.chat([{ role: "user", content: "x" }]);

  const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
  const body = JSON.parse((init as RequestInit).body as string);
  expect(body.options).toEqual({ num_ctx: 8192, temperature: 0.6, top_p: 0.95 });
});

test("omits options entirely when none are set", async () => {
  const fetchImpl = vi.fn(async () =>
    new Response(JSON.stringify({ message: { content: '{"abilities":[]}' } }), { status: 200 }),
  ) as unknown as typeof fetch;

  const p = new OllamaProvider({ fetchImpl });
  await p.chat([{ role: "user", content: "x" }]);

  const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
  const body = JSON.parse((init as RequestInit).body as string);
  expect(body.options).toBeUndefined();
});

test("throws on non-ok response", async () => {
  const fetchImpl = vi.fn(async () => new Response("boom", { status: 500 })) as unknown as typeof fetch;
  const p = new OllamaProvider({ fetchImpl });
  await expect(p.chat([{ role: "user", content: "x" }])).rejects.toThrow(/ollama/i);
});
