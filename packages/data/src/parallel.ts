import { availableParallelism } from "node:os";
import { isMainThread, parentPort, Worker } from "node:worker_threads";

/** THE WHOLE CPU FOR A PER-ITEM SCRIPT (owner 2026-09-29: "leverage whole cpu"). The instruments and
 *  research scripts analyse 71 independent decks one after another on one core -- population-compare
 *  ran 107 s wall-clock on 109 s of CPU on a 10-core machine. This spreads the items over worker
 *  threads.
 *
 *  A WORK QUEUE, NOT FIXED CHUNKS: decks differ tenfold in cost, so a worker takes the next item when
 *  it is free. RESULTS COME BACK IN INPUT ORDER, so whatever a script prints or writes from them is
 *  byte-identical to the sequential run -- which is the test any parallel version has to pass.
 *
 *  Node-only, and deliberately not re-exported from the package index: the web client bundles
 *  `@edh-seer/data`, and `worker_threads` must never reach it. */

/** Workers to start: every core but one, left for the main thread and the database. */
export const defaultWorkers = (): number => Math.max(1, availableParallelism() - 1);

type Request<I> = { i: number; item: I };
type Reply<O> = { i: number; ok: true; value: O } | { i: number; ok: false; error: string };

/** Run `workerUrl`'s handler (see `serveWorker`) on every item, spread over worker threads. The
 *  worker module is loaded through tsx, so it may be TypeScript and import package source. */
export async function mapInWorkers<I, O>(items: readonly I[], workerUrl: URL, opts: { workers?: number } = {}): Promise<O[]> {
  if (items.length === 0) return [];
  // At least one worker: 0 would start none, and the map would wait forever (review).
  const count = Math.max(1, Math.min(opts.workers ?? defaultWorkers(), items.length));
  const out = new Array<O>(items.length);
  let next = 0;
  const workers: Worker[] = [];
  try {
    await new Promise<void>((resolve, reject) => {
      let settled = 0;
      let failed = false;
      const fail = (err: Error): void => { if (!failed) { failed = true; reject(err); } };
      for (let w = 0; w < count; w++) {
        const worker = new Worker(workerUrl, { execArgv: ["--import", "tsx"] });
        workers.push(worker);
        const feed = (): void => {
          if (failed) return;
          if (next < items.length) { const i = next++; worker.postMessage({ i, item: items[i] } satisfies Request<I>); }
        };
        worker.on("message", (reply: Reply<O>) => {
          if (!reply.ok) { fail(new Error(`item ${reply.i}: ${reply.error}`)); return; }
          out[reply.i] = reply.value;
          if (++settled === items.length) resolve(); else feed();
        });
        worker.on("error", fail);
        worker.on("exit", (code) => { if (code !== 0) fail(new Error(`worker exited with code ${code}`)); });
        feed();
      }
    });
  } finally {
    await Promise.all(workers.map((w) => w.terminate()));
  }
  return out;
}

/** The worker half: call once at the top level of a worker module. `handle` runs per item; its
 *  return value must be structured-cloneable (plain data, Maps and Sets are fine; class instances
 *  lose their methods). Anything the worker needs once -- a Mongo connection, a hierarchy -- is set
 *  up at module level, before this call, and reused for every item. */
export function serveWorker<I, O>(handle: (item: I) => Promise<O> | O): void {
  if (isMainThread || !parentPort) throw new Error("serveWorker() runs only inside a worker thread");
  const port = parentPort;
  port.on("message", async ({ i, item }: Request<I>) => {
    try {
      port.postMessage({ i, ok: true, value: await handle(item) } satisfies Reply<O>);
    } catch (err) {
      port.postMessage({ i, ok: false, error: err instanceof Error ? err.message : String(err) } satisfies Reply<O>);
    }
  });
}
