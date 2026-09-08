/** Rewrites the built shell's head and appends a block of real content to its body, so a card page
 *  says what it is to a reader who never runs the bundle.
 *
 *  IT LIVES IN `src/lib` AND NOT BESIDE THE FUNCTION THAT CALLS IT. The client's vitest config only
 *  collects `src/**`, so an injector under `functions/` would be untested code on the one path
 *  where a mistake is invisible -- nothing on screen changes when the head is wrong. The Pages
 *  Function imports it from here and stays a thin wrapper with a try/catch.
 *
 *  STRING REPLACEMENT, NOT A DOM PARSE. This runs at the edge on every request for these routes,
 *  and the shell is an artifact this repo builds and tests -- parsing it would buy nothing and cost
 *  milliseconds per request.
 *
 *  THE BLOCK GOES OUTSIDE `#root`, which is the whole trick and is not new: `index.html`'s `.intro`
 *  section is already real content outside `#root` that React never owns. That is what lets this
 *  work with no prerender step and no hydration mismatch -- React mounts into an empty div and the
 *  crawler's copy sits beside it. */
import { eventKeySentence } from "./demand-sentence.js";

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** JSON THAT IS SAFE TO PUT INSIDE A `<script>` ELEMENT, WHICH IS NOT THE SAME AS SAFE JSON.
 *
 *  `esc` above is for HTML text and attributes and is the WRONG tool here: inside a `<script>` the
 *  HTML parser does not decode entities, so `&lt;` would land in the JSON literally and
 *  `JSON.parse` would hand the page a corrupted string. The parser instead scans raw text for the
 *  sequence `</script` (case-insensitively) and ends the element there -- so a single `</script>`
 *  anywhere in this data closes the block early and everything after it is parsed as MARKUP. That
 *  is the injection: the JSON cannot execute (`type="application/json"` is not a script the browser
 *  runs), but breaking out of the element lets whatever follows become real HTML, including a real
 *  `<script>`.
 *
 *  THE DATA IS NOT USER INPUT TODAY -- it is Scryfall oracle data plus sentences this engine
 *  generates -- and that is exactly the argument not to rely on. The corpus is 34,433 third-party
 *  rows and grows every set; "no card name contains `</script>`" is a fact about today that nothing
 *  enforces. So the escape is mechanical rather than reasoned.
 *
 *  `<` BECOMES `\u003c`, WHICH IS STILL VALID JSON and cannot start any HTML token, so `</script`
 *  can never appear however the data nests it. `>` and `&` go too, so `]]>` and entity-ish text
 *  cannot confuse an XHTML or XML parser either. U+2028 and U+2029 are legal in JSON strings and
 *  are line terminators in JavaScript -- harmless for `JSON.parse`, but escaped here so the same
 *  string stays safe if it is ever embedded somewhere that IS evaluated. */
export const jsonForScript = (value: unknown): string =>
  JSON.stringify(value)
    .replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

/** WHAT EVERY HTML RESPONSE THIS EDGE WRITES CARRIES.
 *
 *  A PAGES FUNCTION GETS NONE OF THE SITE'S HEADERS FOR FREE, and that is the whole reason this
 *  exists. `_headers` applies to ASSET responses, and the two security headers the rest of the site
 *  has -- `nosniff` and `strict-origin-when-cross-origin` -- are Pages' own defaults on assets, not
 *  something this repo sets. A Function response bypasses both. Measured on the deployed site
 *  2026-09-08: `/how-it-works/` carries both, `/cards/krenko-mob-boss` carries neither, and the
 *  Function routes are the majority of this site's HTML.
 *
 *  IT LIVES IN THE REPO AND NOT IN A TRANSFORM RULE. Cloudflare could add these from the dashboard,
 *  and `_headers` already carries the argument against it: a policy that lives in zone settings is
 *  not in this repo, is not reviewed, and silently outranks what is.
 *
 *  `X-Robots-Tag` IS THE HEADER TWIN OF THE `noindex` META TAG, on the same condition, because a
 *  header needs no HTML parse to be understood. The meta tag alone is read by anything that renders
 *  the page; the header is read by everything, including Cloudflare's Crawler Hints, whose
 *  documented opt-out is this header or the tag and which does not say which of the two it actually
 *  inspects. 2,823 of these pages are `noindex` and Crawler Hints is on as of 2026-09-08, so
 *  "probably parses the body" was not a good enough answer. */
export function htmlHeaders(indexable = true): Record<string, string> {
  return {
    "content-type": "text/html; charset=utf-8",
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    ...(indexable ? {} : { "x-robots-tag": "noindex" }),
  };
}

export interface InjectedPage {
  title: string;
  description: string;
  canonical: string;
  /** False keeps the page renderable and out of the index (spec D5). */
  indexable: boolean;
  /** Already-escaped HTML. Built by `cardPageHtml` below, never by a caller pasting strings. */
  bodyHtml: string;
  /** THE CARD'S OWN IMAGE, for the share card and for the paint.
   *
   *  Every card page sent the site's one generic `og-image.png` (all 17,338 of them, 2026-09-08),
   *  so a link pasted into Discord or Reddit showed a wordmark where the card would have been. The
   *  same URL is also preloaded: the `<img>` the app renders for it is the page's largest paint,
   *  and it used to wait for the bundle before its request could begin (Lighthouse mobile LCP
   *  4.4 s on `/cards/skullclamp`, `lcp-lazy-loaded` failing).
   *
   *  THE WHOLE CARD, NOT THE ART CROP -- the licence line `CardArt` already argues: the crop would
   *  oblige an artist credit the corpus does not hold, and the card prints its own. Omitted when
   *  the record has no image, and then nothing in the head changes. */
  image?: string;
  /** THE PATH TO THIS PAGE, for the result page. Every route here carried the landing's one
   *  WebApplication block and nothing about itself; a BreadcrumbList is the one structured-data
   *  type a search engine shows for a page like this, as the path under the title. Home first,
   *  the page itself last, never fewer than two. */
  breadcrumbs?: { name: string; url: string }[];
  /** THE RECORD THE PAGE IS ABOUT, HANDED TO THE APP INSTEAD OF FETCHED.
   *
   *  WITHOUT THIS, GOOGLE INDEXES EVERY CARD PAGE AS A 404, and the chain that produced it is four
   *  files long: React boots -> `html[data-app-booted] .prerendered { display: none }` hides the
   *  block above -> `CardPage` calls `loadCardPage` -> that fetches `/static/manifest.json` and a
   *  shard under `/static/` -> `robots.txt` says `Disallow: /static/` and Googlebot's renderer will
   *  not fetch a disallowed subresource -> `static-lookup.ts` returns `null` on the failed
   *  response -> `<NotFound />`. Confirmed in Search Console on 2026-09-08 against
   *  `/cards/accursed-witch-infectious-curse`, a page the edge serves with 24 partner links: the
   *  rendered DOM Google keeps says "NO SUCH PAGE". All 17,338 card URLs rendered as the same
   *  near-identical soft 404.
   *
   *  THE FIX IS TO REMOVE THE FETCH, NOT TO OPEN `/static/`. Loosening robots.txt would trade one
   *  leak for another -- 2,048 shard files into the crawl budget the rule exists to protect. The
   *  edge already HAS the record; it was rendering it as prose and then making the browser go and
   *  buy it again.
   *
   *  IT IS ALSO THE FASTER PATH FOR A HUMAN. A card page cost a `manifest.json` round trip plus a
   *  ~20 KB shard before it could draw; inline it costs a median 0.7 KB gzipped, p99 2.2 KB, max
   *  6.5 KB (measured over all 16,715 records, 2026-09-08) and nothing.
   *
   *  Omitted -- not `null` -- on a page that has no record, so `injectPage` writes no tag at all. */
  data?: { slug: string; record: unknown };
}

/** WHERE THE APP LOOKS FOR THE INLINE RECORD. One constant, imported by the writer and the reader,
 *  because a page that hands over data under an id nobody reads is the silent half of this bug
 *  happening again. */
export const CARD_PAGE_DATA_ID = "edh-card-page";

/** The BreadcrumbList block, as JSON that is safe inside a `<script>` (see `jsonForScript`). */
export const breadcrumbJsonLd = (crumbs: { name: string; url: string }[]): string =>
  jsonForScript({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({
      "@type": "ListItem", position: i + 1, name: c.name, item: c.url,
    })),
  });

export function injectPage(shell: string, page: InjectedPage): string {
  let out = shell
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(page.title)}</title>`)
    .replace(/<meta name="description" content="[^"]*"\s*\/?>/,
      `<meta name="description" content="${esc(page.description)}" />`)
    .replace(/<link rel="canonical" href="[^"]*"\s*\/?>/,
      `<link rel="canonical" href="${esc(page.canonical)}" />`)
    .replace(/<meta property="og:title" content="[^"]*"\s*\/?>/,
      `<meta property="og:title" content="${esc(page.title)}" />`)
    .replace(/<meta property="og:description" content="[^"]*"\s*\/?>/,
      `<meta property="og:description" content="${esc(page.description)}" />`)
    .replace(/<meta property="og:url" content="[^"]*"\s*\/?>/,
      `<meta property="og:url" content="${esc(page.canonical)}" />`);

  if (page.breadcrumbs !== undefined && page.breadcrumbs.length >= 2) {
    out = out.replace("</head>",
      `  <script type="application/ld+json">${breadcrumbJsonLd(page.breadcrumbs)}</script>\n  </head>`);
  }

  if (page.image !== undefined) {
    const image = esc(page.image);
    out = out
      .replace(/<meta property="og:image" content="[^"]*"\s*\/?>/,
        `<meta property="og:image" content="${image}" />`)
      // Scryfall's `normal` size, the one `cardImageUrl` asks for.
      .replace(/<meta property="og:image:width" content="[^"]*"\s*\/?>/,
        '<meta property="og:image:width" content="488" />')
      .replace(/<meta property="og:image:height" content="[^"]*"\s*\/?>/,
        '<meta property="og:image:height" content="680" />')
      .replace(/<meta property="og:image:alt" content="[^"]*"\s*\/?>/,
        `<meta property="og:image:alt" content="${esc(page.title)}" />`)
      // A card is portrait. `summary_large_image` crops a landscape band out of its middle;
      // `summary` shows the whole thing small, which is the card.
      .replace(/<meta name="twitter:card" content="[^"]*"\s*\/?>/,
        '<meta name="twitter:card" content="summary" />')
      .replace(/<meta name="twitter:image" content="[^"]*"\s*\/?>/,
        `<meta name="twitter:image" content="${image}" />`)
      .replace("</head>",
        `  <link rel="preload" as="image" href="${image}" fetchpriority="high" />\n  </head>`);
  }

  // A PAGE THAT PROMISES NOTHING DOES NOT ENTER THE INDEX. It still renders -- the reporting
  // surface wants every card reachable -- but a card with no partners has no content a search
  // result could honestly summarise.
  if (!page.indexable) out = out.replace("</head>", '  <meta name="robots" content="noindex" />\n  </head>');

  // KEYED BY SLUG, because a client-side navigation does not reload the document. Click a partner
  // link and this tag still describes the card you ARRIVED on; the reader compares the slug it
  // wants against `data-slug` and falls back to the network when they differ. Without that check
  // every partner link would show the previous card's page.
  const data = page.data === undefined ? "" : `\n    <script type="application/json" id="${CARD_PAGE_DATA_ID}"`
    + ` data-slug="${esc(page.data.slug)}">${jsonForScript(page.data.record)}</script>`;

  return out.replace('<div id="root"></div>', `<div id="root"></div>\n${page.bodyHtml}${data}`);
}

/** As much of one artifact record as the static block prints. */
export interface InjectableCard {
  name: string;
  typeLine: string;
  commander: boolean;
  emits: string[];
  demands: string[];
  partners: { name: string; slug: string; event: string; reason: string }[];
  /** How many cards can cause each event, keyed the way `partners[].event` is. Optional because
   *  the field is younger than the shard format; an absent map prints no count. */
  rarity?: Record<string, number>;
}

/** THE STATIC BLOCK A CRAWLER READS, and the one place this feature's claim is testable without a
 *  browser: if the partner sentences are not in this string, the 17,775 URLs in the sitemap are
 *  17,775 empty divs.
 *
 *  IT USES `h2`, NOT `h1`. The shell's own `h1` is the wordmark and stays where it is --
 *  `seo.test.ts` asserts exactly one per page -- so this block sits under it as the first line of
 *  real content, which is also what `CardPage` renders in the app. Two answers to "what is this
 *  page" would be worse than a generic first one.
 *
 *  NO CARD RULES TEXT (spec D2a), the same rule the React page follows: name, type line, our
 *  derivation, and the engine's own sentences. */
export function cardPageHtml(
  card: InjectableCard, slug: string, kind: "card" | "commander",
): string {
  // ONE GROUP PER EVENT, IN ARRIVAL ORDER, the same split `PartnerList` draws, and above each the
  // number the ranking is computed from. The count is what makes this block THIS card's and not a
  // template: "793 cards can cause an artifact dying" is a sentence no other page prints with that
  // figure, and until 2026-09-08 it lived only in the React tree a crawler with JavaScript off
  // never saw. Same wording as the app's, so the two readers agree.
  const groups: { event: string; rows: string[] }[] = [];
  for (const p of card.partners.slice(0, 24)) {
    const row = `      <li><a href="/cards/${esc(p.slug)}">${esc(p.name)}</a> — ${esc(p.reason)}</li>`;
    const last = groups.at(-1);
    if (last?.event === p.event) last.rows.push(row);
    else groups.push({ event: p.event, rows: [row] });
  }
  const rows = groups.map((g) => {
    const n = card.rarity?.[g.event];
    const count = n === undefined ? ""
      : `    <p>${n.toLocaleString("en-US")} cards can cause ${esc(eventKeySentence(g.event))}.</p>\n`;
    return `${count}    <ol>\n${g.rows.join("\n")}\n    </ol>`;
  }).join("\n");
  const crossLink = kind === "card"
    ? (card.commander
      ? `    <p><a href="/commanders/${esc(slug)}">What a deck led by this card wants</a></p>\n`
      : "")
    : `    <p><a href="/cards/${esc(slug)}">What the engine reads on this card</a></p>\n`;
  const partners = card.partners.length === 0
    ? "    <p>No partners specific enough to list.</p>"
    : `    <h3>Partners</h3>\n${rows}`;
  return `    <section class="prerendered">
    <h2>${esc(card.name)}</h2>
    <p>${esc(card.typeLine)}</p>
${crossLink}    <p>Produces: ${card.emits.map((e) => esc(eventKeySentence(e))).join(", ") || "nothing"}.</p>
    <p>Cares about: ${card.demands.map((d) => esc(eventKeySentence(d))).join(", ") || "nothing"}.</p>
${partners}
    </section>`;
}

/** THE LETTERS A BROWSE PAGE OFFERS, in the order a reader expects them. `#` last: it holds the
 *  names with no leading letter, and putting it first would make the alphabet start with a
 *  footnote. */
export const BROWSE_LETTERS = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ", "#"];

/** The path segment a letter is served at -- `#` cannot be one, so it is `0`. */
export const browseSegment = (letter: string): string =>
  letter === "#" ? "0" : letter.toLowerCase();

const browseNav = (kind: "cards" | "commanders", current?: string): string =>
  `    <nav class="browse-letters" aria-label="Browse by letter">\n`
  + BROWSE_LETTERS.map((l) => (l === current
    ? `      <span aria-current="page">${esc(l)}</span>`
    : `      <a href="/browse/${kind}/${browseSegment(l)}">${esc(l)}</a>`)).join("\n")
  + `\n    </nav>`;

/** THE A-Z BLOCK ON `/cards` AND `/commanders`, which is what makes those two pages a door.
 *
 *  BOTH RENDERED EMPTY TO A CRAWLER UNTIL NOW, and for the same reason every card page did: the
 *  React listing fetches `name-index.json` from `/static/`, `robots.txt` disallows `/static/`, and
 *  Googlebot's renderer will not fetch a disallowed subresource. Measured 2026-09-08 -- zero links
 *  to any card on either page. They are the only route from the site into 17,338 URLs, so the whole
 *  corpus hung off the sitemap alone. */
export function browseIndexHtml(kind: "cards" | "commanders", total: number): string {
  const what = kind === "commanders" ? "commanders" : "cards";
  return `    <section class="prerendered">
    <h2>Every ${what} the engine has read</h2>
    <p>${total.toLocaleString("en")} ${what}, by first letter.</p>
${browseNav(kind)}
    </section>`;
}

/** ONE LETTER'S WORTH OF LINKS, and the reason this page needs no JavaScript at all.
 *
 *  IT IS A LIST OF LINKS. React owns nothing here, the block is not hidden on boot, and a reader and
 *  a crawler get the identical DOM -- which also means the data is in the document once rather than
 *  twice, as HTML rather than as HTML plus a copy in JSON. The search box on `/cards` is the
 *  interactive surface; this is the walkable one. */
export function browseLetterHtml(
  kind: "cards" | "commanders", letter: string, rows: { slug: string; name: string }[],
): string {
  const what = kind === "commanders" ? "commanders" : "cards";
  const items = rows.map((r) =>
    `      <li><a href="/${kind}/${esc(r.slug)}">${esc(r.name)}</a></li>`).join("\n");
  const list = rows.length === 0
    ? `    <p>No ${what} start with this letter.</p>`
    : `    <ul class="browse-list">\n${items}\n    </ul>`;
  return `    <section class="prerendered">
    <h2>${what.replace(/^./, (c) => c.toUpperCase())} starting with ${esc(letter)}</h2>
    <p>${rows.length.toLocaleString("en")} ${rows.length === 1 ? what.replace(/s$/, "") : what}.</p>
${browseNav(kind, letter)}
${list}
    </section>`;
}
