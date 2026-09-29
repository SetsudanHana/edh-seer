import { createPool, defaultWorkers } from "@edh-seer/data/parallel";
import { partnerBuilder, type CandidateSets, type CardOutput, type PartnerArtifact } from "./partners-core.js";
import type { PartnerBroadcast, PartnerJob } from "./partners-worker.js";
import type { DeckCard, Hierarchy } from "./types.js";

/** THE PARTNER BUILD ON EVERY CORE (owner 2026-09-29). Phase A (each card's candidate sets) and
 *  phase B (each card's page) run in workers; the partner counts between them and the assembly after
 *  them run here, in card order -- the same `partnerBuilder` steps `buildPartnerArtifact` runs in one
 *  thread, so the artifact is byte-identical (build-static's manifest version is the check).
 *
 *  `ids` are the `_id`s of `all`, in order: each worker loads the same cards and puts them in this
 *  order, because the order is part of the output. Node-only: never imported by the web client. */
export async function buildPartnerArtifactInWorkers(
  all: DeckCard[], ids: string[], h: Hierarchy, opts: { workers?: number; batch?: number; heapMb?: number } = {},
): Promise<PartnerArtifact> {
  const t0 = performance.now();
  const lap = (what: string): void => { if (process.env.PARTNER_TIMINGS) console.error(`partners: ${what} ${((performance.now() - t0) / 1000).toFixed(1)} s`); };
  const pool = createPool<PartnerJob, CandidateSets[] | CardOutput[]>(
    new URL("./partners-worker.ts", import.meta.url), { workers: opts.workers ?? defaultWorkers(), heapMb: opts.heapMb ?? 6144 });
  try {
    // THE WORKERS LOAD WHILE THIS THREAD BUILDS ITS OWN CONTEXT: the broadcast is posted at once and
    // runs on their threads, so the two ~25 s context builds overlap instead of queueing.
    const loaded = pool.broadcast({ type: "init", ids } satisfies PartnerBroadcast);
    const b = partnerBuilder(all, h);
    lap("main context");
    const size = opts.batch ?? 200;
    const ranges = Array.from({ length: Math.ceil(b.size / size) }, (_, k) => ({ from: k * size, to: Math.min(b.size, (k + 1) * size) }));
    await loaded;
    lap("workers loaded");
    const cands = (await pool.map(ranges.map((r) => ({ phase: "A" as const, ...r })))).flat() as CandidateSets[];
    lap("phase A");
    const degrees = b.degreesFrom(cands);
    lap("degrees");
    await pool.broadcast({ type: "degrees", degrees } satisfies PartnerBroadcast);
    lap("degrees sent");
    const outputs = (await pool.map(ranges.map((r) => ({ phase: "B" as const, ...r, cands: cands.slice(r.from, r.to) })))).flat() as CardOutput[];
    lap("phase B");
    const artifact = b.withDegrees(degrees, (i) => cands[i]!).assemble(outputs);
    lap("assembled");
    return artifact;
  } finally {
    await pool.close();
  }
}
