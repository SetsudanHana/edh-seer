import { DeckFetchError, type DeckSections } from "@edh-seer/data/deck-source";
import { fetchMoxfieldDeck } from "@edh-seer/data/moxfield";
import { fetchArchidektDeck } from "@edh-seer/data/archidekt";
import { Gate, Paused, TooBusy } from "./gate.js";

export interface PacerEnv {
  MOXFIELD_UA: string;
}

/** How long one upstream call may take before we abort it. A serialised queue cannot afford a hang:
 *  every request behind it waits on this number. */
const UPSTREAM_TIMEOUT_MS = 10_000;

export type Outcome =
  | { kind: "deck"; sections: DeckSections }
  | { kind: "rejected"; status: number; message: string };

/** ONE INSTANCE, GLOBALLY. The router addresses this with a fixed `idFromName`, and the runtime
 *  guarantees a named Durable Object is a single instance across every colo — which is what makes
 *  one-request-per-second a guarantee rather than an average.
 *
 *  It holds no storage. The slot and the breaker live in memory, and losing them to an eviction is
 *  safe in the only direction that matters: a fresh instance starts with an empty slot and sends its
 *  first request immediately, which is one request, not a burst. */
export class Pacer {
  private readonly gate = new Gate();

  constructor(
    _state: DurableObjectState,
    private readonly env: PacerEnv,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const { source, id } = (await request.json()) as { source: string; id: string };
    try {
      const outcome = await this.gate.run(() => this.load(source, id));
      return Response.json(outcome);
    } catch (err) {
      if (err instanceof TooBusy) {
        return Response.json({ kind: "rejected", status: 429, message: "importer busy" });
      }
      if (err instanceof Paused) {
        return Response.json({ kind: "rejected", status: 503, message: "importer paused" });
      }
      // Anything else already tripped the breaker inside the gate.
      return Response.json({ kind: "rejected", status: 502, message: "deck site unreachable" });
    }
  }

  /** Returns `rejected` for the reader's mistakes and THROWS for upstream distress. The difference
   *  is what the gate keys its breaker on, so getting it backwards would either silence the importer
   *  over one private deck, or keep hammering a site that asked us to stop. */
  private async load(source: string, id: string): Promise<Outcome> {
    const paced: typeof fetch = (input, init) =>
      fetch(input as RequestInfo, { ...init, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
    try {
      const sections =
        source === "moxfield"
          ? await fetchMoxfieldDeck(id, this.env.MOXFIELD_UA, paced)
          : await fetchArchidektDeck(id, paced);
      return { kind: "deck", sections };
    } catch (err) {
      if (err instanceof DeckFetchError && !err.isUpstreamDistress) {
        return { kind: "rejected", status: 404, message: "deck not found, or not public" };
      }
      if (err instanceof Error && err.message.includes("shape changed")) {
        // The site changed its JSON under us. Refusing beats importing a half-read deck, and this is
        // the message worth seeing in the logs.
        return { kind: "rejected", status: 502, message: "importer out of date for this deck site" };
      }
      throw err;
    }
  }
}
