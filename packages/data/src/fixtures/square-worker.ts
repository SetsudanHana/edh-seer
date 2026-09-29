// Test fixture for parallel.ts: squares its item, and throws on a negative one.
import { threadId } from "node:worker_threads";
import { serveWorker } from "../parallel.js";

serveWorker(async (n: number) => {
  if (n < 0) throw new Error(`negative: ${n}`);
  return { n: n * n, thread: threadId };
});
