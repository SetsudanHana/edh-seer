import { CARD_PAGE_DATA_ID } from "./inject.js";
import { preconDataSlug, type PreconIndexEntry } from "./precon-html.js";
import type { PreconPage } from "./precon-page.js";

/** A precon page's record: the page, and the other precons from its set. */
export interface PreconRecord { page: PreconPage; siblings: PreconIndexEntry[] }

/** THE RECORD THE EDGE PUT IN THE DOCUMENT, when it is for this slug: no fetch, and nothing under the
 *  robots-disallowed `/static/` for a crawler's renderer to be refused (see `inlineCardPage`). */
function inline<T>(slug: string): T | null {
  const el = typeof document === "undefined" ? null : document.getElementById(CARD_PAGE_DATA_ID);
  if (!el || el.getAttribute("data-slug") !== preconDataSlug(slug)) return null;
  try { return JSON.parse(el.textContent ?? "") as T; } catch { return null; }
}

async function precons(baseUrl: string, fetchImpl: typeof fetch): Promise<string | null> {
  const res = await fetchImpl(`${baseUrl}/manifest.json`);
  if (!res.ok) return null;
  // The pointer is the manifest's `precons` (a `p-<hash>` directory named from the pages' bytes).
  const { version, precons: dir } = await res.json() as { version?: string; precons?: string };
  return version && dir ? `${baseUrl}/${version}/precons/${dir}` : null;
}

export async function loadPrecon(slug: string, baseUrl = "/static", fetchImpl: typeof fetch = fetch): Promise<PreconRecord | null> {
  const here = inline<PreconRecord>(slug);
  if (here) return here;
  try {
    const base = await precons(baseUrl, fetchImpl);
    if (!base) return null;
    const [page, index] = await Promise.all([fetchImpl(`${base}/${slug}.json`), fetchImpl(`${base}/index.json`)]);
    if (!page.ok) return null;
    const p = await page.json() as PreconPage;
    const list = index.ok ? await index.json() as PreconIndexEntry[] : [];
    return { page: p, siblings: list.filter((e) => e.setCode === p.setCode && e.slug !== slug) };
  } catch {
    return null;
  }
}

export async function loadPreconIndex(baseUrl = "/static", fetchImpl: typeof fetch = fetch): Promise<PreconIndexEntry[] | null> {
  const here = inline<PreconIndexEntry[]>("");
  if (here) return here;
  try {
    const base = await precons(baseUrl, fetchImpl);
    if (!base) return null;
    const res = await fetchImpl(`${base}/index.json`);
    return res.ok ? await res.json() as PreconIndexEntry[] : null;
  } catch {
    return null;
  }
}

/** The list as the analyser reads it, commanders first. */
export function preconDecklist(p: PreconPage): string {
  return ["Commander", ...p.commanders.map((c) => `1 ${c}`), "", "Deck",
    ...p.decklist.flatMap((g) => g.cards.map((c) => `${c.count} ${c.name}`))].join("\n");
}
