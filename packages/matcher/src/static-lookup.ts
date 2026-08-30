import type { CardTags } from "@edh-seer/tagger";
import type { CardDoc, ComboDoc } from "@edh-seer/data/docs";
import type { CardLookup } from "@edh-seer/data/resolve";
import type { CardTagsLookup } from "./deck-cards.js";
import type { AnalysisSources } from "./orchestrate.js";
import { shardOf } from "./bin/build-static-core.js";

/** Re-exported so a consumer of this module can address a shard the way it does -- the client's
 *  own tests build their fixture files from it, which is what keeps them honest when the layout
 *  changes. `build-static-core.ts` stays the single definition. */
export { shardOf };

/** One card's entry inside a shard, as `build-static.ts` writes it: the card, its derived tags
 *  (absent when the card was never tagged) and every combo anchored on it. */
interface CardEntry {
  card: CardDoc;
  tags: CardTags | null;
  combos: ComboDoc[];
}

/** A shard file: every card name that hashes into it, keyed by name. */
type ShardFile = Record<string, CardEntry>;

/** Bump on a shape change to the files under `<baseUrl>/cards/`, `token-tags.json` or
 *  `token-art.json` — an old cached response under the previous name is simply never read again
 *  rather than served stale. */
const CACHE_NAME = "edh-seer-cards-v2";

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
  private tokenArtPromise: Promise<Record<string, string>> | null = null;

  private readonly fetchImpl: typeof fetch;

  /** `fetchImpl` is BOUND here, not stored bare: `fetchCached` calls it as `this.fetchImpl(url)`, a
   *  property access, and native `fetch` brand-checks its receiver — called through any other
   *  object it throws `Illegal invocation`. `new StaticLookup(baseUrl)` (the default parameter)
   *  hands it the bare global, which is exactly the shape that breaks. Node's global `fetch` does
   *  NOT enforce this check, which is why no unit test caught it — only a real browser does. */
  constructor(
    private readonly baseUrl: string,
    fetchImpl: typeof fetch = fetch,
  ) {
    this.fetchImpl = fetchImpl.bind(globalThis);
  }

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

  /** Fetch every shard the deck touches, in parallel, and fill the maps. MUST be awaited before
   *  `findByName`.
   *
   *  ONE FETCH PER SHARD, NOT PER NAME. Two names in the same shard used to be two requests; a
   *  100-card deck now pulls the ~100 DISTINCT shards its names hash into, and a deck with two
   *  cards in one shard pulls it once.
   *
   *  ONLY THE REQUESTED NAMES ARE READ OUT OF A SHARD, which is not an optimisation but a
   *  correctness rule: a shard carries ~2 unrelated cards, and taking their combos too would put
   *  combos in `allCombos()` for cards the deck does not contain. */
  async prefetch(names: string[]): Promise<void> {
    const wanted = [...new Set(names)].filter((n) => !this.byName.has(n));
    const byShard = new Map<string, string[]>();
    for (const n of wanted) {
      // THE SAME RULE AS THE BUILD, IMPORTED RATHER THAN COPIED: `shardOf` lives in
      // `build-static-core.ts`, which the build split out precisely so it is importable (it has
      // zero imports of its own — nothing Node-hostile rides along) — one rule, one copy, so the
      // build and the client cannot drift about where a card lives.
      const shard = shardOf(n);
      const bucket = byShard.get(shard);
      if (bucket) bucket.push(n);
      else byShard.set(shard, [n]);
    }
    await Promise.all([...byShard].map(async ([shard, shardNames]) => {
      const res = await this.fetchCached(`/cards/${shard}.json`);
      // A 404 IS "no such card" for every name in this shard — the same answer the missing file
      // used to give one name at a time.
      const file = res.ok ? await res.json() as ShardFile : {};
      for (const n of shardNames) {
        const entry = file[n];
        if (!entry) { this.byName.set(n, null); continue; }
        this.byName.set(n, entry.card);
        this.byId.set(entry.card._id, entry.tags ?? null);
        for (const c of entry.combos ?? []) this.combos.push(c);
      }
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

  /** Reads `token-art.json` — `{ [oracleId]: artCrop }` over every token the `tokens` collection
   * carries art for, written by `build-static.ts` from the SAME documents `loadTokenTags` reads
   * for `token-tags.json` (a `CardTags` resolver, which carries no art). Filtered to the requested
   * ids, mirroring the Mongo path's `{_id: {$in: oracleIds}}, {projection: {artCrop: 1}}` — an id
   * with no art (or not in the file at all) is simply absent from the returned Map, never
   * present with `undefined`. */
  async tokenArt(oracleIds: string[]): Promise<Map<string, string>> {
    const byOracleId = await this.loadTokenArtFile();
    const out = new Map<string, string>();
    for (const id of oracleIds) {
      const art = byOracleId[id];
      if (art) out.set(id, art);
    }
    return out;
  }

  private loadTokenArtFile(): Promise<Record<string, string>> {
    return (this.tokenArtPromise ??= (async () => {
      const res = await this.fetchCached("/token-art.json");
      return res.ok ? (await res.json() as Record<string, string>) : {};
    })());
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
