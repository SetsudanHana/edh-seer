import type { CardTags } from "@edh-seer/tagger";
import type { CardDoc, ComboDoc } from "@edh-seer/data/docs";
import type { CardLookup } from "@edh-seer/data/resolve";
import type { CardTagsLookup } from "./deck-cards.js";
import type { AnalysisSources } from "./orchestrate.js";
import { cardFileName } from "./bin/build-static-core.js";

/** One card's file, as `build-static.ts` writes it: the card, its derived tags (absent when the
 *  card was never tagged) and every combo anchored on it. */
interface CardFile {
  card: CardDoc;
  tags: CardTags | null;
  combos: ComboDoc[];
}

/** Bump on a shape change to the files under `<baseUrl>/cards/` or `token-tags.json` — an old
 *  cached response under the previous name is simply never read again rather than served stale. */
const CACHE_NAME = "edh-seer-cards-v1";

/** The client's data plane: `CardLookup` + `CardTagsLookup` + the two token facts
 * `AnalysisSources` needs, all answered over `fetch` against the artifacts `build-static.ts`
 * writes, instead of Mongo.
 *
 * PREFETCH IS NOT AN OPTIMISATION, IT IS THE POINT. `resolveNames` awaits `findByName` PER NAME,
 * sequentially — over HTTP that is 100 serial round trips. Changing `resolveNames` would touch the
 * Nest server's path too, so the parallelism lives here instead and `findByName` becomes a map
 * read. It also makes `allCombos` deterministic: every deck name has been seen by the time it is
 * called. */
export class StaticLookup implements CardLookup, CardTagsLookup {
  private readonly byName = new Map<string, CardDoc | null>();
  private readonly byId = new Map<string, CardTags | null>();
  private readonly combos: ComboDoc[] = [];
  private tokenTagsPromise: Promise<Record<string, CardTags>> | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** Reads-through the Cache API when it exists (a real browser), and falls straight to
   * `fetchImpl` when it does not (jsdom, a plain `fetch` shim, Node) — so this module works
   * identically under every test environment and under `static-parity.ts`'s filesystem shim. */
  private async fetchCached(path: string): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    if (typeof caches === "undefined") return this.fetchImpl(url);
    const cache = await caches.open(CACHE_NAME);
    const hit = await cache.match(url);
    if (hit) return hit;
    const res = await this.fetchImpl(url);
    if (res.ok) await cache.put(url, res.clone());
    return res;
  }

  /** Fetch every name in parallel and fill the map. MUST be awaited before `findByName`. */
  async prefetch(names: string[]): Promise<void> {
    await Promise.all([...new Set(names)].map(async (n) => {
      if (this.byName.has(n)) return;
      // THE SAME RULE AS THE BUILD, IMPORTED RATHER THAN COPIED: `cardFileName` lives in
      // `build-static-core.ts`, which the build split out precisely so it is importable (it has
      // zero imports of its own — nothing Node-hostile rides along) — one rule, one copy, so the
      // build and the client cannot drift.
      const res = await this.fetchCached(`/cards/${cardFileName(n)}.json`);
      if (!res.ok) { this.byName.set(n, null); return; } // a 404 IS "no such card"
      const file = await res.json() as CardFile;
      this.byName.set(n, file.card);
      this.byId.set(file.card._id, file.tags ?? null);
      for (const c of file.combos ?? []) this.combos.push(c);
    }));
  }

  async findByName(normalized: string): Promise<CardDoc | null> {
    return this.byName.get(normalized) ?? null;
  }

  /** The accumulated union of every fetched card's anchored combos — empty before `prefetch`. */
  async allCombos(): Promise<ComboDoc[]> {
    return this.combos;
  }

  async findOne(oracleId: string): Promise<CardTags | null> {
    return this.byId.get(oracleId) ?? null;
  }

  /** NOT SHIPPED BY THE BUILD, SO THIS IS ALWAYS EMPTY TODAY. `build-static.ts` writes
   * `token-tags.json` from `loadTokenTags`'s resolved `printingId -> CardTags` map, and neither
   * that map nor the `CardTags` shape carries an `artCrop` — the `tokens` collection's own field
   * the Mongo path's `tokenArt` reads never made it into a static artifact. Wired against
   * `token-tags.json` anyway, defensively: if that file grows an `artCrop` per entry, this starts
   * returning real art with no further code change, rather than needing a second endpoint
   * invented later. A missing answer here is the correct failure direction (CLAUDE.md: "a silent
   * wrong answer is worse than a missing one") — a token node simply renders with no art crop,
   * exactly as it already does for any token this build has no printing id for. */
  async tokenArt(oracleIds: string[]): Promise<Map<string, string>> {
    const byPrintingId = await this.loadTokenTagsFile();
    const out = new Map<string, string>();
    const wanted = new Set(oracleIds);
    for (const tags of Object.values(byPrintingId)) {
      const art = (tags as CardTags & { artCrop?: string }).artCrop;
      if (art && wanted.has(tags.oracleId)) out.set(tags.oracleId, art);
    }
    return out;
  }

  /** Same resolver shape `loadTokenTags(db)` produces on the Mongo path, over the one file the
   * build writes instead of two collections. Fetched once, memoized — every deck's token nodes
   * share it. */
  async tokenTags(): Promise<AnalysisSources["tokenTags"]> {
    const byPrintingId = await this.loadTokenTagsFile();
    return (ref) => (ref.printingId !== undefined ? byPrintingId[ref.printingId] ?? null : null);
  }

  private loadTokenTagsFile(): Promise<Record<string, CardTags>> {
    return (this.tokenTagsPromise ??= (async () => {
      const res = await this.fetchCached("/token-tags.json");
      return res.ok ? (await res.json() as Record<string, CardTags>) : {};
    })());
  }
}
