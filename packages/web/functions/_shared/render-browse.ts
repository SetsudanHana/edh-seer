import {
  BROWSE_LETTERS, browseIndexHtml, browseLetterHtml, browseSegment, htmlHeaders, injectPage,
} from "../../client/src/lib/inject.js";

/** THE TWO PAGES THAT MAKE THE CORPUS WALKABLE.
 *
 *  `/cards` AND `/commanders` RENDERED EMPTY TO A CRAWLER, for the same reason every card page did
 *  before the record went inline: the React listing fetches `name-index.json` from `/static/`,
 *  `robots.txt` disallows `/static/`, and Googlebot's renderer will not fetch a disallowed
 *  subresource. Measured 2026-09-08 -- zero links to any card on either page, and they are the only
 *  route from this site into 17,338 URLs.
 *
 *  THE INDEX IS NOT INLINED THE WAY A CARD RECORD IS. It is 1.6 MB, 348 KB gzipped. So the artifact
 *  carries one slice per letter and a browse page fetches exactly one of them -- and the page needs
 *  no client data at all, because it is a list of links and React owns none of it.
 *
 *  FAILURE IS DEGRADATION, the same rule the card pages follow: every path ends in the untouched
 *  shell rather than an error. A bug here costs indexing; it must never cost the page. */
interface Assets { fetch: (input: Request | string) => Promise<Response> }

async function shell(request: Request, assets: Assets): Promise<{ origin: string; html: string }> {
  const origin = new URL(request.url).origin;
  return { origin, html: await (await assets.fetch(`${origin}/index.html`)).text() };
}

/** `/cards` and `/commanders`: the alphabet, and how many cards are behind it. */
export async function renderBrowseIndex(
  request: Request, assets: Assets, kind: "cards" | "commanders",
): Promise<Response> {
  const { origin, html } = await shell(request, assets);
  const degraded = () => new Response(html, { headers: htmlHeaders() });
  try {
    const total = await countOf(assets, origin, kind);
    if (total === null) return degraded();
    const what = kind === "commanders" ? "commanders" : "cards";
    return new Response(injectPage(html, {
      title: kind === "commanders"
        ? "Every commander the engine has read — EDH Seer"
        : "Every card the engine has read — EDH Seer",
      description: `${total.toLocaleString("en")} ${what} the engine has read, `
        + `each with the events it produces, the ones it cares about, and who it pairs with.`,
      canonical: `${origin}/${kind}`,
      indexable: true,
      bodyHtml: browseIndexHtml(kind, total),
      breadcrumbs: [
        { name: "EDH Seer", url: `${origin}/` },
        { name: kind === "commanders" ? "Commanders" : "Cards", url: `${origin}/${kind}` },
      ],
    }), { headers: htmlHeaders() });
  } catch {
    return degraded();
  }
}

/** `/browse/<kind>/<letter>`: every card on that letter, as links. */
export async function renderBrowseLetter(
  request: Request, assets: Assets, kind: "cards" | "commanders", segment: string,
): Promise<Response> {
  const { origin, html } = await shell(request, assets);
  const degraded = () => new Response(html, { headers: htmlHeaders() });

  // A SEGMENT THAT IS NOT ONE OF THE 27 IS A 404, not a page listing nothing. The alphabet is a
  // closed set and the URLs are ours to mint, so anything else is a guess or a stale link -- the
  // same reason `/cards/<unknown-slug>` stopped answering 200.
  const letter = BROWSE_LETTERS.find((l) => browseSegment(l) === segment);
  if (letter === undefined) {
    return new Response(injectPage(html, {
      title: `No such browse page — EDH Seer`,
      description: "Browse pages run A to Z, plus one for names that start with neither.",
      canonical: `${origin}/browse/${kind}/${segment}`,
      indexable: false,
      bodyHtml: "",
    }), { status: 404, headers: htmlHeaders(false) });
  }

  try {
    const rows = await sliceOf(assets, origin, segment);
    if (rows === null) return degraded();
    const mine = kind === "commanders" ? rows.filter((r) => r.commander) : rows;
    const what = kind === "commanders" ? "commanders" : "cards";
    return new Response(injectPage(html, {
      title: `${what.replace(/^./, (c) => c.toUpperCase())} starting with ${letter} — EDH Seer`,
      description: `${mine.length.toLocaleString("en")} ${what} beginning with ${letter}, `
        + `each linking to what the engine reads on it.`,
      canonical: `${origin}/browse/${kind}/${segment}`,
      // A LETTER WITH NOTHING ON IT IS NOT WORTH INDEXING, and the commander filter can empty a page
      // the card side fills. It still renders and still carries the alphabet, so the walk continues.
      indexable: mine.length > 0,
      bodyHtml: browseLetterHtml(kind, letter, mine),
      breadcrumbs: [
        { name: "EDH Seer", url: `${origin}/` },
        { name: kind === "commanders" ? "Commanders" : "Cards", url: `${origin}/${kind}` },
        { name: `Starting with ${letter}`, url: `${origin}/browse/${kind}/${segment}` },
      ],
    }), { headers: htmlHeaders(mine.length > 0) });
  } catch {
    return degraded();
  }
}

/** The version directory everything hangs off. `null` means "cannot say", never "empty". */
async function versionOf(assets: Assets, origin: string): Promise<string | null> {
  const res = await assets.fetch(`${origin}/static/manifest.json`);
  if (!res.ok) return null;
  return (await res.json() as { version?: string }).version ?? null;
}

type Row = { slug: string; name: string; commander: boolean };

async function sliceOf(assets: Assets, origin: string, segment: string): Promise<Row[] | null> {
  const version = await versionOf(assets, origin);
  if (version === null) return null;
  const res = await assets.fetch(`${origin}/static/${version}/browse/${segment}.json`);
  return res.ok ? await res.json() as Row[] : null;
}

/** HOW MANY, WITHOUT READING THE 1.6 MB INDEX. The slices already exist and there are 27 of them;
 *  summing their lengths is one fetch each and the numbers are what the page prints. */
async function countOf(assets: Assets, origin: string, kind: "cards" | "commanders"): Promise<number | null> {
  const version = await versionOf(assets, origin);
  if (version === null) return null;
  const counts = await Promise.all(BROWSE_LETTERS.map(async (l) => {
    const res = await assets.fetch(`${origin}/static/${version}/browse/${browseSegment(l)}.json`);
    if (!res.ok) return 0;
    const rows = await res.json() as Row[];
    return kind === "commanders" ? rows.filter((r) => r.commander).length : rows.length;
  }));
  return counts.reduce((a, b) => a + b, 0);
}
