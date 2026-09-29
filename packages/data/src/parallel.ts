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

type ToWorker<I> = { kind: "item"; i: number; item: I } | { kind: "broadcast"; msg: unknown };
type FromWorker<O> =
  | { kind: "item"; i: number; ok: true; value: O }
  | { kind: "item"; i: number; ok: false; error: string }
  | { kind: "ack"; ok: true }
  | { kind: "ack"; ok: false; error: string };

export interface Pool<I, O> {
  /** Run the worker's handler on every item; results in INPUT order. One map or broadcast at a time. */
  map(items: readonly I[]): Promise<O[]>;
  /** Hand every worker the same message (see `serveWorker`'s `onBroadcast`), resolving when all have
   *  taken it -- so state a later `map` needs is in place on every worker first. */
  broadcast(msg: unknown): Promise<void>;
  close(): Promise<void>;
}

/** WORKERS THAT OUTLIVE ONE MAP (the partner build, 2026-09-29): a worker builds its context once,
 *  then serves several phases, each told what it needs by a broadcast rather than per item. */
export function createPool<I, O>(workerUrl: URL, opts: { workers?: number; heapMb?: number } = {}): Pool<I, O> {
  // At least one worker: 0 would start none, and a map would wait forever (review).
  const count = opts.workers !== undefined && Number.isFinite(opts.workers) ? Math.max(1, Math.floor(opts.workers)) : defaultWorkers();
  // A WORKER'S HEAP IS ITS OWN, with V8's default limit: one holding a whole corpus context sits near it
  // and spends its time collecting (the partner build, 2026-09-29). `heapMb` raises it per worker.
  const workers = Array.from({ length: count }, () => new Worker(workerUrl, {
    execArgv: ["--import", "tsx"],
    ...(opts.heapMb ? { resourceLimits: { maxOldGenerationSizeMb: opts.heapMb } } : {}),
  }));
  // The operation in flight: every message and every failure is routed to it.
  let onReply: ((w: Worker, reply: FromWorker<O>) => void) | undefined;
  let onFail: ((err: Error) => void) | undefined;
  let broken: Error | undefined;
  let closing = false;
  const fail = (err: Error): void => { broken ??= err; onFail?.(err); };
  for (const w of workers) {
    w.on("message", (reply: FromWorker<O>) => onReply?.(w, reply));
    w.on("error", fail);
    w.on("exit", (code) => { if (code !== 0 && !closing) fail(new Error(`worker exited with code ${code}`)); });
  }

  const run = <T>(start: (settle: (value: T) => void, reject: (err: Error) => void) => void): Promise<T> => {
    if (broken) return Promise.reject(broken);
    return new Promise<T>((resolve, reject) => {
      let done = false;
      const settle = (value: T): void => { if (!done) { done = true; onReply = undefined; onFail = undefined; resolve(value); } };
      const rejectOnce = (err: Error): void => { if (!done) { done = true; onReply = undefined; onFail = undefined; reject(err); } };
      onFail = rejectOnce;
      start(settle, rejectOnce);
    });
  };

  return {
    map(items) {
      if (items.length === 0) return Promise.resolve([]);
      return run<O[]>((settle, reject) => {
        const out = new Array<O>(items.length);
        let next = 0;
        let settled = 0;
        const feed = (w: Worker): void => {
          if (next < items.length) { const i = next++; w.postMessage({ kind: "item", i, item: items[i] } satisfies ToWorker<I>); }
        };
        onReply = (w, reply) => {
          if (reply.kind !== "item") return;
          if (!reply.ok) { reject(new Error(`item ${reply.i}: ${reply.error}`)); return; }
          out[reply.i] = reply.value;
          if (++settled === items.length) settle(out); else feed(w);
        };
        for (const w of workers) feed(w);
      });
    },
    broadcast(msg) {
      return run<void>((settle, reject) => {
        let acks = 0;
        onReply = (_w, reply) => {
          if (reply.kind !== "ack") return;
          if (!reply.ok) { reject(new Error(`broadcast: ${reply.error}`)); return; }
          if (++acks === workers.length) settle();
        };
        for (const w of workers) w.postMessage({ kind: "broadcast", msg } satisfies ToWorker<I>);
      });
    },
    async close() {
      closing = true;
      await Promise.all(workers.map((w) => w.terminate()));
    },
  };
}

/** Run `workerUrl`'s handler (see `serveWorker`) on every item, spread over worker threads. The
 *  worker module is loaded through tsx, so it may be TypeScript and import package source. */
export async function mapInWorkers<I, O>(items: readonly I[], workerUrl: URL, opts: { workers?: number } = {}): Promise<O[]> {
  if (items.length === 0) return [];
  const want = opts.workers !== undefined && Number.isFinite(opts.workers) ? opts.workers : defaultWorkers();
  const pool = createPool<I, O>(workerUrl, { workers: Math.min(want, items.length) });
  try {
    return await pool.map(items);
  } finally {
    await pool.close();
  }
}

/** The worker half: call once at the top level of a worker module. `handle` runs per item and
 *  `onBroadcast` per broadcast; their results must be structured-cloneable (plain data, Maps and Sets
 *  are fine; class instances lose their methods). Anything the worker needs once -- a Mongo connection,
 *  a hierarchy -- is set up at module level, before this call, and reused for every item. */
export function serveWorker<I, O>(handle: (item: I) => Promise<O> | O, onBroadcast?: (msg: never) => Promise<void> | void): void {
  if (isMainThread || !parentPort) throw new Error("serveWorker() runs only inside a worker thread");
  const port = parentPort;
  port.on("message", async (m: ToWorker<I>) => {
    if (m.kind === "broadcast") {
      try {
        await onBroadcast?.(m.msg as never);
        port.postMessage({ kind: "ack", ok: true } satisfies FromWorker<O>);
      } catch (err) {
        port.postMessage({ kind: "ack", ok: false, error: err instanceof Error ? err.message : String(err) } satisfies FromWorker<O>);
      }
      return;
    }
    try {
      port.postMessage({ kind: "item", i: m.i, ok: true, value: await handle(m.item) } satisfies FromWorker<O>);
    } catch (err) {
      port.postMessage({ kind: "item", i: m.i, ok: false, error: err instanceof Error ? err.message : String(err) } satisfies FromWorker<O>);
    }
  });
}
