import type { CardTags } from "@edh-seer/tagger";
import type { CardDoc, ComboDoc } from "@edh-seer/data/docs";
import type { CardLookup } from "@edh-seer/data/resolve";
import type { CardTagsLookup } from "./deck-cards.js";
import type { AnalysisSources } from "./orchestrate.js";
import { shardOf } from "./bin/build-static-core.js";
import { partnerShardOf, type CardPageRecord, type NameIndexEntry } from "./bin/partners-core.js";

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

/** What `manifest.json` says: the directory the current artifacts live in. */
interface StaticManifest { version: string }

/** The one URL under `<baseUrl>` that is NOT content-addressed, and so the only one that must not
 *  be cached hard. Everything else hangs off the version it names. */
const MANIFEST_PATH = "/manifest.json";

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
  /** EVERY OTHER NAME A FETCHED CARD ANSWERS TO, consulted only when `byName` misses.
   *
   *  THE DEFECT THIS CLOSES, owner-reported on a Jodah deck: "98 of 100 cards read · all 100 lines
   *  matched a card", with Command Tower and the commander itself listed as unread. A card that
   *  resolves but carries no tags forms no edges and reaches no archetype, so two of the deck's
   *  cards were silently outside every synergy number on the page.
   *
   *  `buildDeckCards` re-looks each resolved card up by its CANONICAL name
   *  (`normalizeName(card.name)`) to recover its oracle id, while `prefetch` was handed the names
   *  the DECKLIST used. Those differ whenever a line names an alternate printing: the corpus maps
   *  `spongebob squarepants` and `warrior of light` to Jodah, the Unifier, and SIX names to Command
   *  Tower (`tower of rasmodius`, `cybertron`, `summoners rift`, …). The alternate was fetched and
   *  cached; the canonical name was never requested, so the second lookup missed the map and the
   *  card came back untagged. Mongo re-queries and never noticed — which is also why 71/71 parity
   *  is silent on it: every calibration deck is written in canonical names.
   *
   *  SEPARATE MAP, NOT MERGED INTO `byName`, because 53 names in the corpus resolve to more than
   *  one card. An alias learned from a card we happened to fetch must never pre-empt a later
   *  explicit `prefetch` of that same name, whose answer is the one the build resolved. `byName`
   *  always wins; this only answers what it does not. */
  private readonly byAlias = new Map<string, CardDoc>();
  private readonly byId = new Map<string, CardTags | null>();
  private readonly combos: ComboDoc[] = [];
  private manifestPromise: Promise<string> | null = null;
  private tokenTagsPromise: Promise<Record<string, CardTags>> | null = null;
  private tokenArtPromise: Promise<Record<string, string>> | null = null;
  private nameIndexPromise: Promise<NameIndexEntry[]> | null = null;

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

  /** THE ARTIFACTS' VERSION DIRECTORY, fetched once and remembered.
   *
   *  WHY THE DATA IS ADDRESSED BY CONTENT AND THE MANIFEST IS NOT. A shard's filename hashes the
   *  card NAMES inside it, so `1be5.json` is still `1be5.json` after a corpus rebuild that changed
   *  every card in it — the URL cannot say which build it came from, which makes every cache along
   *  the way a guess between stale and slow. Under a version directory the shard URL changes
   *  whenever its bytes do, so it can be cached forever and correctly, and exactly one small file
   *  has to stay fresh.
   *
   *  That is also the precondition for a service worker: cache-first on a shard URL is safe now and
   *  would have frozen a reader on last month's oracle text before.
   *
   *  A MISSING MANIFEST FALLS BACK TO THE FLAT LAYOUT rather than failing. A deploy mid-upload, or
   *  a cached bundle newer than the artifacts beside it, would otherwise 404 on every card; the
   *  unversioned paths are what the previous build wrote and are still there. */
  private version(): Promise<string> {
    return (this.manifestPromise ??= (async () => {
      try {
        const res = await this.fetchImpl(`${this.baseUrl}${MANIFEST_PATH}`);
        if (!res.ok) return "";
        const manifest = await res.json() as StaticManifest;
        return typeof manifest.version === "string" ? manifest.version : "";
      } catch {
        return "";
      }
    })());
  }

  /** Reads-through the Cache API when it exists (a real browser), and falls straight to
   * `fetchImpl` when it does not (jsdom, a plain `fetch` shim, Node) — so this module works
   * identically under every test environment and under `static-parity.ts`'s filesystem shim.
   *
   * THE CACHE IS NAMED AFTER THE VERSION, so a corpus rebuild does not have to invalidate anything:
   * the new build reads a new cache and `caches.delete` drops the old one whole. */
  private async fetchCached(path: string): Promise<Response> {
    const version = await this.version();
    const prefix = version ? `${this.baseUrl}/${version}` : this.baseUrl;
    const url = `${prefix}${path}`;
    if (typeof caches === "undefined") return this.fetchImpl(url);
    const cacheName = `edh-seer-cards-${version || "flat"}`;
    // ONLY EVICT WHEN WE KNOW WHICH VERSION IS CURRENT. Measured while testing offline: a manifest
    // read that failed sent this down the flat fallback, and evicting from there threw away a
    // correctly-cached corpus on the strength of a request that did not answer. An unknown version
    // keeps everything; the next successful read cleans up.
    if (version) void this.evictOtherVersions(cacheName);
    const cache = await caches.open(cacheName);
    const hit = await cache.match(url);
    if (hit) return hit;
    const res = await this.fetchImpl(url);
    if (res.ok) await cache.put(url, res.clone());
    return res;
  }

  /** Drops every cache this app opened for a DIFFERENT version. Fire-and-forget and once per
   *  instance: a browser that has analysed decks across two corpus builds would otherwise carry
   *  the older one's shards forever, and storage pressure evicts by origin, not by usefulness. */
  private evictedOthers = false;
  private async evictOtherVersions(keep: string): Promise<void> {
    if (this.evictedOthers || typeof caches === "undefined" || !("keys" in caches)) return;
    this.evictedOthers = true;
    try {
      for (const name of await caches.keys()) {
        if (name.startsWith("edh-seer-cards-") && name !== keep) await caches.delete(name);
      }
    } catch { /* a browser that refuses cache enumeration keeps its old entries; harmless */ }
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
        // Every name this card answers to, so a later lookup by any of them hits without a second
        // request. The entry is the same object under every one of its names in the build, so the
        // card, its tags and its combos are all already here.
        for (const alias of entry.card.searchNames ?? []) {
          if (!this.byAlias.has(alias)) this.byAlias.set(alias, entry.card);
        }
        this.byId.set(entry.card._id, entry.tags ?? null);
        for (const c of entry.combos ?? []) this.combos.push(c);
      }
    }));
  }

  async findByName(normalized: string): Promise<CardDoc | null> {
    const fetched = this.byName.get(normalized);
    if (fetched !== undefined) return fetched;
    return this.byAlias.get(normalized) ?? null;
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

  /** ONE CARD'S PAGE RECORD, or null when there is no such card.
   *
   *  THE CARD PAGES RIDE THIS CLASS RATHER THAN READING THE ARTIFACTS THEMSELVES, and the reason is
   *  everything above: the manifest read that resolves the version directory, the Cache API
   *  read-through and its version-scoped eviction, the flat-layout fallback for a deploy caught
   *  mid-upload, and the `fetchImpl.bind` in the constructor that no unit test can catch the
   *  absence of. A second module fetching `/partners/*.json` on its own would have to be right
   *  about all five, and would be a second place to fix when one of them is wrong.
   *
   *  A MISSING SHARD AND A SHARD WITHOUT THE SLUG ARE THE SAME ANSWER. Slugs share shards whenever
   *  they hash together, so a 200 on the file proves nothing about the card. */
  async cardPage(slug: string): Promise<CardPageRecord | null> {
    const res = await this.fetchCached(`/partners/${partnerShardOf(slug)}.json`);
    if (!res.ok) return null;
    const shard = await res.json() as Record<string, CardPageRecord>;
    return shard[slug] ?? null;
  }

  /** Every substantive card's slug, name, colour identity and commander flag: what the search and
   *  commander listing pages filter over. One file, fetched once, memoized like the token maps --
   *  it is the same shape of artifact and gets the same treatment.
   *
   *  AN ABSENT INDEX IS EMPTY, NOT FATAL, for the reason the token files are: a search page that
   *  renders "no cards" is recoverable and a page that throws is not. */
  async nameIndex(): Promise<NameIndexEntry[]> {
    return (this.nameIndexPromise ??= (async () => {
      const res = await this.fetchCached("/name-index.json");
      return res.ok ? (await res.json() as NameIndexEntry[]) : [];
    })());
  }
}
