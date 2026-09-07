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

export interface InjectedPage {
  title: string;
  description: string;
  canonical: string;
  /** False keeps the page renderable and out of the index (spec D5). */
  indexable: boolean;
  /** Already-escaped HTML. Built by `cardPageHtml` below, never by a caller pasting strings. */
  bodyHtml: string;
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
  const rows = card.partners.slice(0, 24).map((p) =>
    `      <li><a href="/cards/${esc(p.slug)}">${esc(p.name)}</a> — ${esc(p.reason)}</li>`).join("\n");
  const crossLink = kind === "card"
    ? (card.commander
      ? `    <p><a href="/commanders/${esc(slug)}">What a deck led by this card wants</a></p>\n`
      : "")
    : `    <p><a href="/cards/${esc(slug)}">What the engine reads on this card</a></p>\n`;
  const partners = card.partners.length === 0
    ? "    <p>No partners specific enough to list.</p>"
    : `    <h3>Most specific partners</h3>\n    <ol>\n${rows}\n    </ol>`;
  return `    <section class="prerendered">
    <h2>${esc(card.name)}</h2>
    <p>${esc(card.typeLine)}</p>
${crossLink}    <p>Produces: ${card.emits.map((e) => esc(eventKeySentence(e))).join(", ") || "nothing"}.</p>
    <p>Cares about: ${card.demands.map((d) => esc(eventKeySentence(d))).join(", ") || "nothing"}.</p>
${partners}
    </section>`;
}
