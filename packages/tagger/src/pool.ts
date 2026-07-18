/**
 * Run `fn` over `items` with at most `concurrency` in flight at once, preserving
 * input order in the results. Used to parallelize slow per-card LLM extraction —
 * Ollama serves concurrent requests, so this is a straight throughput multiplier.
 */
export async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Math.min(Math.max(1, Math.floor(concurrency)), items.length || 1);

  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }

  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}
