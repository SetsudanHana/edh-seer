import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { normalizeName } from "@mtg/data";
import { pairKey } from "../otag-edges.js";
import { CATEGORY_EDHREC_TAG, tagUrl, parseHighSynergy } from "./edhrec-core.js";

const CACHE_DIR = new URL("../../.edhrec-cache/", import.meta.url).pathname;
// EDHREC's "High Synergy Cards" list actually returns ~9-10 cards per theme (measured across
// all 16 cached payloads, 2026-08-02), so this is a ceiling that never binds. Raising it will
// not enlarge the oracle -- EDHREC's page size, not this slice, is the limiter.
const TOP_K = 50;

/** Pooled EDHREC high-synergy pairs across every mapped theme, keyed by normalized name pair.
 *  Themes are NOT selected per deck: that would couple the oracle to bucket detection, a
 *  separate system under active change. Pooling inflates hit rates equally for all three
 *  measured sets, so the comparison between them still holds. */
export interface EdhrecOpts {
  /** Injected for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Injected for tests; defaults to the on-disk cache dir. Pass null to disable caching. */
  cacheDir?: string | null;
}

export async function edhrecPairSet(opts: EdhrecOpts = {}): Promise<Set<string> | null> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const cacheDir = opts.cacheDir === undefined ? CACHE_DIR : opts.cacheDir;
  if (cacheDir) mkdirSync(cacheDir, { recursive: true });
  const pairs = new Set<string>();
  let anyOk = false;
  for (const slug of new Set(Object.values(CATEGORY_EDHREC_TAG))) {
    const cacheFile = cacheDir ? `${cacheDir}${slug}.json` : null;
    let payload: unknown;
    try {
      if (cacheFile && existsSync(cacheFile)) {
        payload = JSON.parse(readFileSync(cacheFile, "utf8"));
      } else {
        const res = await fetchImpl(tagUrl(slug), {
          headers: { "User-Agent": "mtg-synergy-engine/1.0 (otag measurement)" },
        });
        if (!res.ok) { console.error(`  EDHREC ${slug}: HTTP ${res.status}`); continue; }
        payload = await res.json();
        if (cacheFile) writeFileSync(cacheFile, JSON.stringify(payload));
        await new Promise((r) => setTimeout(r, 250));
      }
      const cards = parseHighSynergy(payload).slice(0, TOP_K);
      for (let i = 0; i < cards.length; i++) {
        for (let j = i + 1; j < cards.length; j++) {
          pairs.add(pairKey(normalizeName(cards[i].name), normalizeName(cards[j].name)));
        }
      }
      anyOk = true;
    } catch (err) {
      console.error(`  EDHREC ${slug}: ${(err as Error).message}`);
    }
  }
  return anyOk ? pairs : null;
}

/** Deterministic PRNG so the random baseline is reproducible across runs. */
export function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0x100000000; };
}
