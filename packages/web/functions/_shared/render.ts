import { partnerShardOf } from "@edh-seer/matcher/partner-shard";
import { cardPageHtml, injectPage, type InjectableCard } from "../../client/src/lib/inject.js";

/** WHAT A CRAWLER GETS FOR A CARD URL, AND WHAT A BROWSER GETS TOO.
 *
 *  The shell is served unchanged except for its head and one block appended after `#root`, so the
 *  app boots exactly as it does on every other route and the reader never sees two versions of the
 *  page. The block is what a crawler reads and what a reader sees for the moment before the bundle
 *  runs, so it has to be true rather than a placeholder.
 *
 *  FAILURE IS DEGRADATION, NEVER AN ERROR. Every path here ends in the untouched shell: a missing
 *  manifest, a shard caught mid-deploy, a slug nobody minted, a JSON parse that throws. The React
 *  page then renders the same "not in the corpus" answer it renders on a direct visit. A bug in
 *  this layer costs indexing; it must never cost the page. */
interface Assets { fetch: (input: Request | string) => Promise<Response> }

export async function renderCardPage(
  request: Request, assets: Assets, slug: string, kind: "card" | "commander",
): Promise<Response> {
  const origin = new URL(request.url).origin;
  const shell = await (await assets.fetch(`${origin}/index.html`)).text();
  const fallback = () => new Response(shell, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });

  try {
    const manifest = await assets.fetch(`${origin}/static/manifest.json`);
    if (!manifest.ok) return fallback();
    const { version } = await manifest.json() as { version?: string };
    if (!version) return fallback();

    const shard = await assets.fetch(`${origin}/static/${version}/partners/${partnerShardOf(slug)}.json`);
    if (!shard.ok) return fallback();
    const record = (await shard.json() as Record<string, InjectableCard & {
      commanderPartners?: InjectableCard["partners"];
    }>)[slug];
    if (!record) return fallback();

    // A COMMANDER URL FOR A CARD THAT CANNOT LEAD A DECK IS NOT A PAGE. It still renders -- the
    // React route explains why the question is wrong -- but it makes no promise a crawler should
    // index.
    const isCommanderPage = kind === "commander";
    const usable = !isCommanderPage || record.commander;
    const partners = isCommanderPage ? record.commanderPartners ?? [] : record.partners;

    // THE TITLE MUST NOT CLAIM WHAT THE PAGE REFUSES. A `noindex` page is still shared, still read
    // aloud, and still shows its title in a tab: "what a deck led by Impact Tremors wants" is a
    // false sentence about an enchantment, and hiding it from a crawler does not make it true.
    const title = !usable
      ? `${record.name} cannot lead a deck — EDH Seer`
      : isCommanderPage
      ? `${record.name} — what a deck led by it wants — EDH Seer`
      : `${record.name} — synergies and what the engine reads — EDH Seer`;
    const description = !usable
      ? `${record.name} is not a legendary creature that can be a commander. The card itself has a page.`
      : partners.length > 0
      ? `${partners.length} cards ${record.name} interacts with, each with the reason the engine drew the edge.`
      : `What the engine reads on ${record.name}: the events it produces and the ones it cares about.`;

    return new Response(injectPage(shell, {
      title,
      description,
      canonical: `${origin}/${isCommanderPage ? "commanders" : "cards"}/${slug}`,
      // NOTHING TO SAY, NOTHING TO INDEX. A page with no partners is real and reachable and has no
      // content a search result could honestly summarise, so it stays out of the index rather than
      // adding one of ~1,900 near-identical thin pages.
      indexable: usable && partners.length > 0,
      bodyHtml: cardPageHtml({ ...record, partners }, slug, kind),
    }), { headers: { "content-type": "text/html; charset=utf-8" } });
  } catch {
    return fallback();
  }
}
