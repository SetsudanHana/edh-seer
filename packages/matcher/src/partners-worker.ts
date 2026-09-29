/** A worker for the parallel partner build (`partners-parallel.ts`). It loads the same cards and tags
 *  the main build reads, in the main build's order, builds the same `partnerBuilder` context, then
 *  serves phase-A and phase-B batches. Everything it returns is plain data. */
import { connect, docToCard, loadConfig } from "@edh-seer/data";
import { serveWorker } from "@edh-seer/data/parallel";
import { DERIVED_COLLECTION, type CardTags } from "@edh-seer/tagger";
import { loadHierarchy } from "./hierarchy.js";
import { partnerBuilder, type CandidateSets, type CardOutput } from "./partners-core.js";
import type { DeckCard } from "./types.js";

export type PartnerJob =
  | { phase: "A"; from: number; to: number }
  | { phase: "B"; from: number; to: number; cands: CandidateSets[] };
export type PartnerBroadcast = { type: "init"; ids: string[] } | { type: "degrees"; degrees: number[] };

let builder: ReturnType<typeof partnerBuilder> | undefined;
let phaseB: ReturnType<ReturnType<typeof partnerBuilder>["withDegrees"]> | undefined;
// The batch in flight's own candidate sets: phase B asks for them by position.
let batch = new Map<number, CandidateSets>();

serveWorker<PartnerJob, CandidateSets[] | CardOutput[]>(
  (job) => {
    if (!builder) throw new Error("partner worker used before init");
    const out = [];
    if (job.phase === "A") {
      for (let i = job.from; i < job.to; i++) out.push(builder.candidatesAt(i));
      return out;
    }
    if (!phaseB) throw new Error("partner worker's phase B ran before its degrees");
    batch = new Map(job.cands.map((c, k) => [job.from + k, c] as const));
    const t0 = performance.now();
    for (let i = job.from; i < job.to; i++) out.push(phaseB.cardOutputAt(i));
    if (process.env.PARTNER_TIMINGS) console.error(`batchB ${job.from} ${(performance.now() - t0).toFixed(0)}`);
    return out as CardOutput[];
  },
  async (msg: PartnerBroadcast) => {
    if (msg.type === "degrees") {
      phaseB = builder!.withDegrees(msg.degrees, (i) => batch.get(i)!);
      return;
    }
    // THE MAIN BUILD'S CARDS, IN ITS ORDER: `resolveSlugs` gives a contested name to the first card by
    // input order, so the order is part of the output. Built exactly as build-static builds them.
    const store = await connect(loadConfig());
    try {
      const byId = new Map((await store.cards.find({ _id: { $in: msg.ids } }).toArray()).map((c) => [c._id, c] as const));
      const tags = new Map((await store.db.collection<CardTags>(DERIVED_COLLECTION).find({}).toArray()).map((r) => [r.oracleId, r] as const));
      const deckCards = msg.ids.map((id) => {
        const card = byId.get(id)!;
        return { card: { ...card, ...docToCard(card) }, tags: tags.get(card._id) ?? null };
      });
      builder = partnerBuilder(deckCards as unknown as DeckCard[], loadHierarchy());
    } finally {
      await store.close();
    }
  },
);
