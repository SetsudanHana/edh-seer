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
const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface InjectedPage {
  title: string;
  description: string;
  canonical: string;
  /** False keeps the page renderable and out of the index (spec D5). */
  indexable: boolean;
  /** Already-escaped HTML. Built by `cardPageHtml` below, never by a caller pasting strings. */
  bodyHtml: string;
}

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

  return out.replace('<div id="root"></div>', `<div id="root"></div>\n${page.bodyHtml}`);
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
${crossLink}    <p>Produces: ${card.emits.map(esc).join(", ") || "nothing"}.</p>
    <p>Cares about: ${card.demands.map(esc).join(", ") || "nothing"}.</p>
${partners}
    </section>`;
}
