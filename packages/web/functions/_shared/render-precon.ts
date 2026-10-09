import { htmlHeaders, injectPage } from "../../client/src/lib/inject.js";
import {
  preconDataSlug, preconDescription, preconIndexHtml, preconPageHtml, preconTitle, type PreconIndexEntry,
} from "../../client/src/lib/precon-html.js";
import type { PreconPage } from "../../client/src/lib/precon-page.js";

/** THE PRECON PAGES AT THE EDGE (owner, 2026-09-27: "/precons/<name> pages with analysis ... and it
 *  is also something that should be indexable"). Each page is a file `build-precons` wrote under
 *  the static version; this puts its head, its crawler block and its record into the shell, the
 *  way `render.ts` does for a card.
 *
 *  THE SAME FAILURE RULES AS A CARD PAGE: an artifact that did not load is DEGRADED (the shell at
 *  200, the app tries again); a slug the index does not hold is a real 404 with a noindex head. */
interface Assets { fetch: (input: Request | string) => Promise<Response> }

async function load(request: Request, assets: Assets) {
  const origin = new URL(request.url).origin;
  const shell = await (await assets.fetch(`${origin}/index.html`)).text();
  const manifest = await assets.fetch(`${origin}/static/manifest.json`);
  const m = manifest.ok ? await manifest.json() as { version?: string; precons?: string } : {};
  const base = m.version && m.precons ? `${origin}/static/${m.version}/precons/${m.precons}` : null;
  const index = base ? await assets.fetch(`${base}/index.json`) : null;
  const list = index?.ok ? await index.json() as PreconIndexEntry[] : null;
  return { origin, shell, base, list };
}

export async function renderPreconPage(request: Request, assets: Assets, slug: string): Promise<Response> {
  const { origin, shell, base, list } = await load(request, assets);
  const degraded = () => new Response(shell, { headers: htmlHeaders() });
  try {
    if (!base || !list) return degraded();
    if (!list.some((e) => e.slug === slug)) {
      return new Response(injectPage(shell, {
        title: `No precon page for “${slug}” — EDH Seer`,
        description: "No Commander precon goes by that name here. The precon list has every one we read.",
        canonical: `${origin}/precons/${slug}`,
        indexable: false,
        bodyHtml: "",
      }), { status: 404, headers: htmlHeaders(false) });
    }
    const res = await assets.fetch(`${base}/${slug}.json`);
    if (!res.ok) return degraded();
    const page = await res.json() as PreconPage;
    return new Response(injectPage(shell, {
      title: preconTitle(page),
      description: preconDescription(page),
      canonical: `${origin}/precons/${slug}`,
      indexable: true,
      bodyHtml: preconPageHtml(page, list),
      breadcrumbs: [
        { name: "EDH Seer", url: `${origin}/` },
        { name: "Precons", url: `${origin}/precons` },
        { name: page.name, url: `${origin}/precons/${slug}` },
      ],
      data: { slug: preconDataSlug(slug), record: { page, siblings: list.filter((e) => e.setCode === page.setCode && e.slug !== slug) } },
    }), { headers: htmlHeaders(true) });
  } catch {
    return degraded();
  }
}

export async function renderPreconIndex(request: Request, assets: Assets): Promise<Response> {
  const { origin, shell, list } = await load(request, assets);
  const degraded = () => new Response(shell, { headers: htmlHeaders() });
  try {
    if (!list) return degraded();
    return new Response(injectPage(shell, {
      title: "Commander precons: synergy upgrades for every deck — EDH Seer",
      description: `${list.length} Commander precons, each read card by card: its theme, how well its cards work together, and the swaps that make them work together more.`,
      canonical: `${origin}/precons`,
      indexable: true,
      bodyHtml: preconIndexHtml(list),
      breadcrumbs: [{ name: "EDH Seer", url: `${origin}/` }, { name: "Precons", url: `${origin}/precons` }],
      data: { slug: preconDataSlug(""), record: list },
    }), { headers: htmlHeaders(true) });
  } catch {
    return degraded();
  }
}
