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

  // DEGRADED IS NOT MISSING, and the two must not share an answer.
  //
  // A manifest that did not load, a shard caught mid-deploy, a body that would not parse: none of
  // those are evidence about the CARD. They serve the shell at 200 and let the app try again from
  // the browser -- answering "gone" while the artifact is briefly unreadable would be the same
  // class of lie as the 200-with-HTML that cost two pull requests this week.
  const degraded = () => new Response(shell, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });

  // A SLUG THE ARTIFACT DOES NOT HOLD IS A 404, and the shard loading is what makes that a fact
  // rather than a guess. `/cards/<any string>` used to answer 200 with the site's generic title:
  // an infinite space of soft 404s beside 17,814 real sitemap URLs, indexable, and carrying the
  // home page's metadata. The BODY is unchanged -- the React route still explains that the engine
  // has not read this card, which is the ordinary case for 38% of the corpus -- because a 404
  // renders exactly like a 200 and only says something different to a crawler.
  const notFound = () => new Response(injectPage(shell, {
    // THE SAME SENTENCE THE PAGE ITSELF RENDERS. Two possibilities and neither asserted: this layer
    // cannot tell a real card that produced no events from a name that is simply wrong, and a title
    // claiming "the engine has not read this card" about a typo is the assertion the page copy was
    // corrected for.
    title: `No page for “${slug}” — EDH Seer`,
    description: "Either that name is wrong, or the engine found nothing to say about the card.",
    canonical: `${origin}/${kind === "commander" ? "commanders" : "cards"}/${slug}`,
    indexable: false,
    bodyHtml: "",
  }), { status: 404, headers: { "content-type": "text/html; charset=utf-8" } });

  try {
    const manifest = await assets.fetch(`${origin}/static/manifest.json`);
    if (!manifest.ok) return degraded();
    const { version } = await manifest.json() as { version?: string };
    if (!version) return degraded();

    const shard = await assets.fetch(`${origin}/static/${version}/partners/${partnerShardOf(slug)}.json`);
    // A 404 ON THE SHARD IS STILL DEGRADED, not missing: shards are content-addressed under the
    // version directory, so a miss here means the artifact is mid-upload, never that the slug is
    // unknown. Only the shard's own CONTENTS can say that.
    if (!shard.ok) return degraded();
    const record = (await shard.json() as Record<string, InjectableCard & {
      commanderPartners?: InjectableCard["partners"];
    }>)[slug];
    if (!record) return notFound();

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
      ? `${record.name} cannot be a commander. The card itself has a page.`
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
    return degraded();
  }
}
