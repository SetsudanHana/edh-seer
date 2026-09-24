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
import { cardImageUrl } from "../components/card-node.js";
// THE LEAF MODULE, NOT `partners-core` (2026-09-20). This file runs inside a Cloudflare Function,
// whose tsconfig has no node types on purpose -- and importing a VALUE from `partners-core` drags
// the whole matcher-to-tagger graph in with it, including the files that read `node:fs`. CI caught
// it; `tsc -p client` did not, because the client config is the one that HAS those types.
// `sentence.ts` imports nothing at all.
import { effectPhrase } from "@edh-seer/matcher/sentence";
import { eventKeyAction, eventKeyClause, eventKeySentence } from "./demand-sentence.js";
import { groupAnchor } from "./group-anchor.js";

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
    // THE LANDING'S ARGUMENT STAYS ON THE LANDING. `.intro` is index.html's own pitch, and its
    // thesis is the landing's `h1`; on a served card, commander or browse page it was a second
    // answer to "what is this page" for every crawler, and hidden by CSS for every reader.
    .replace(/\n?\s*<section class="intro"[\s\S]*?<\/section>/, "")
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
      `<meta property="og:url" content="${esc(page.canonical)}" />`)
    // THE SAME PAGE, SAID TWICE. `og:` was per-page from the start and `twitter:` was not, so every
    // Discord and Twitter paste of any of 24,874 card, commander and browse pages previewed as the
    // home page. These two belong in the chain that always runs, not in the image branch below: a
    // browse page carries no image and still has a name of its own.
    .replace(/<meta name="twitter:title" content="[^"]*"\s*\/?>/,
      `<meta name="twitter:title" content="${esc(page.title)}" />`)
    .replace(/<meta name="twitter:description" content="[^"]*"\s*\/?>/,
      `<meta name="twitter:description" content="${esc(page.description)}" />`);

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
  partners: { name: string; slug: string; event: string; reason: string; producer?: true }[];
  /** How many cards can cause each event, keyed the way `partners[].event` is. Optional because
   *  the field is younger than the shard format; an absent map prints no count. */
  rarity?: Record<string, number>;
  /** How many cards ASK for each event -- the withheld count the app prints under a group. */
  pool?: Record<string, number>;
  /** Scryfall's `art_crop` URL, which `cardImageUrl` rewrites to the full card. Optional and
   *  nullable because the shard carries it as either; a card without one prints no image. */
  artCrop?: string | null;
  /** `{1}{W}`, in the notation every Magic reader already reads. Short card METADATA, which D2a
   *  names as staying on the page beside the type line -- it is not rules text. A land has none. */
  manaCost?: string;
  /** THE CARD'S COLOUR IDENTITY. Read on a COMMANDER page only, where it scopes the link under the
   *  withheld count to the cards that deck could legally contain -- the same scope AJ5 gave the
   *  number itself. Optional: the field rides in on the shard record's spread. */
  identity?: readonly string[];
  /** THE CLAUSES THE ENGINE READ, verbatim and in printed order (spec D2a option 2, taken
   *  2026-09-18). Unattributed on purpose: one clause can yield several abilities, so naming which
   *  one produced a given edge would be a guess wearing a citation's clothes. Absent on a card with
   *  no rules text. */
  clauses?: { id: number; text: string }[];
  /** THE DERIVED ABILITY ROWS, each stamped with the clause that printed it (roadmap AJ4). Rides
   *  in on the record spread; declared here because the crawlable block renders them now. */
  abilities?: { kind: string; cost?: string; effect: string; amount?: string; when: string[]; emits: string[]; applies?: string[]; clause?: number; self?: true; selfEmits?: string[] }[];
}

/** WHICH WAY A PARTNER GROUP RUNS. The three cases the copy already named -- "cause it", "feed it",
 *  "ask for it" -- now also decide which COUNTER the withheld figure comes from, because they are
 *  the same fact and reading it from two places is how they came to disagree. */
export type GroupDirection = "causes" | "feeds" | "asks";

export const groupDirection = (rows: InjectableCard["partners"]): GroupDirection =>
  rows.every((r) => r.producer === true) ? "causes"
  : rows.every((r) => /^While you control /i.test(r.reason)) ? "feeds"
  : "asks";

/** WHAT THE CAUSE COUNT IS A COUNT OF, said once for both readers (owner, 2026-09-22).
 *
 *  The badge is the RANKING figure -- how many cards can cause the event -- and it stays that on
 *  every group. Under a group whose tiles all ASK for the event, though, the number is not the
 *  tiles': the deck-build agent read Inalla's "17 cards can cause this" over one Diviner's Wand as
 *  sixteen missing cards. Those tiles are partners only because this page's card causes the event,
 *  so it is one of the 17, and the sentence says so. A mixed group falls back to `asks` in
 *  `groupDirection` without that guarantee, so it keeps the bare count. */
export const causeCountTail = (rows: InjectableCard["partners"], subject?: string): string =>
  subject && rows.every((r) => r.producer !== true && !/^While you control /i.test(r.reason))
    ? `cards can cause this, ${subject} among them`
    : "cards can cause this";

/** WHERE A GROUP'S WITHHELD COUNT LINKS (roadmap AJ3), and it is built ONCE for both readers.
 *
 *  THE PARAM FOLLOWS THE DIRECTION THE SENTENCE CLAIMS. A group whose rows all CAUSE the event
 *  counts causes, so it asks `produce`; an asker group counts askers, so it asks `consume`. A
 *  feeder group's rows are cards this card counts -- they supply it, so they are causes too.
 *  Sending both directions to one param would be AJ1 again with a URL on it.
 *
 *  THE COLOURS COME FROM THE DECK, NOT THE CORPUS. On a commander page the number above this link
 *  is already scoped to that commander's identity (AJ5); opening a corpus-wide set under it would
 *  put a 389 over a page of 589. A card page has no deck and passes none.
 *
 *  ONE PARAM PER KEY, appended rather than joined: 274 of the corpus keys contain a comma. */
export const searchHref = (
  dir: GroupDirection, event: string, identity?: readonly string[],
): string => {
  const params = new URLSearchParams();
  params.append(dir === "asks" ? "consume" : "produce", event);
  if (identity && identity.length > 0) params.set("colors", identity.join(""));
  return `/cards?${params.toString()}`;
};

/** HOW MANY MORE COULD HAVE BEEN SHOWN, counted from the map that runs the group's own direction.
 *
 *  THE BUG THIS REPLACES SAID ONE DIRECTION AND COUNTED THE OTHER. Both readers took the figure
 *  from `pool` -- how many cards ASK for the event -- and then printed "N other cards CAUSE it
 *  too" under a group whose rows all supply it. Measured on Samut, the Driving Force (2026-09-19):
 *  the `lose-life` group shows 8 rows, every one `producer: true`, and printed "930 other cards
 *  cause it too", where 930 is `pool(938) - 8` and the honest figure is `rarity(2,679) - 8`.
 *
 *  ON A NARROW GROUP IT WAS WORSE THAN WRONG, IT WAS ABSENT: `applies:keyword-grant|creature|cleric`
 *  has `pool 1`, so the count came out 0 and NO line rendered at all -- under a chip reading "589
 *  cards can cause this" above a list of one. That is the owner-reported "it says 589 and shows 1".
 *
 *  ROWS THAT SUPPLY THE EVENT COUNT FROM `rarity`, ROWS THAT ASK FOR IT COUNT FROM `pool`, measured
 *  across the artifact 2026-09-19: a consumer group (Patrol Hound's `discard`: rarity 1,609, pool
 *  67, rows are cards that ask) was always right on `pool`; a producer group and a feeder group
 *  (Sanctum of Fruitful Harvest's `counts|-|shrine`: rarity 22, pool 21, rows are the shrines it
 *  counts) were both wrong. So consumer groups do not move and the other two do. */
export const withheldFrom = (
  dir: GroupDirection,
  event: string,
  shown: number,
  rarity: Record<string, number> | undefined,
  pool: Record<string, number> | undefined,
): number => Math.max(0, ((dir === "asks" ? pool?.[event] : rarity?.[event]) ?? shown) - shown);

/** A SHARED LEAD SHORT ENOUGH TO BE NOISE IS NOT WORTH A HEADING. Twenty characters is about where
 *  "When a creature dies thanks to X," starts and a bare "When" stops. */
const MIN_SHARED_LEAD = 20;

/** No regex: `js/polynomial-redos` and `js/incomplete-multi-character-sanitization` have both failed
 *  this repo's required check, and a two-character trim does not need one. */
function trimLead(s: string): string {
  let i = 0;
  while (i < s.length && (s[i] === "," || s[i] === " ")) i += 1;
  return s.slice(i);
}

/** The same at the other end. A prefix ending in a space makes `lastIndexOf(" ")` win over
 *  `lastIndexOf(", ")`, which leaves the heading as "... Mob Boss," and renders "Mob Boss,:". */
function trimTrail(s: string): string {
  let i = s.length;
  while (i > 0 && (s[i - 1] === "," || s[i - 1] === " ")) i -= 1;
  return s.slice(0, i);
}

/** EIGHT COPIES OF ONE SENTENCE IS WHAT A THIN PAGE LOOKS LIKE. Every reason in an event group opens
 *  on the same condition by construction -- "When a creature dies thanks to Krenko, X triggers" --
 *  so a crawler read that opening once per ROW. Measured over 2,573 rows in 591 groups: 29% of all
 *  reason bytes were a repeated prefix.
 *
 *  THE CLAIM IS NOT SHORTENED, IT IS SAID ONCE. The condition becomes the group's heading and each
 *  row keeps its own half, so the full sentence is still on the page and still reconstructible. That
 *  matters more here than bytes: the reason sentence IS the evidence for the edge, and a page that
 *  drops it to look less repetitive would be trading the product's honesty for a ranking.
 *
 *  IT REFUSES RATHER THAN GUESSES. A group of one, a lead under `MIN_SHARED_LEAD`, or any row left
 *  with nothing to say -- and every row keeps its whole sentence. A row reading "Krenko --" is worse
 *  than the repetition this removes.
 *
 *  NOT THE APP'S SHAPE. `PartnerList.feederCaption` trims a lead too, but per row and for a phone's
 *  two-line clamp; this is per group and for a reader who sees the whole list at once. The count
 *  sentences above each group are still word-for-word the app's. */
function factorLead(rows: InjectableCard["partners"]):
  { head: string; rows: { name: string; slug: string; text: string }[] } {
  const whole = () => ({ head: "", rows: rows.map((r) => ({ name: r.name, slug: r.slug, text: r.reason })) });
  if (rows.length < 2) return whole();
  let shared = rows[0].reason;
  for (const r of rows) {
    let i = 0;
    while (i < shared.length && i < r.reason.length && shared[i] === r.reason[i]) i += 1;
    shared = shared.slice(0, i);
  }
  // A character-wise prefix stops wherever two names diverge, which is usually mid-word. Back off to
  // the last separator so the heading ends on a whole word rather than "Cai".
  const cut = Math.max(shared.lastIndexOf(", "), shared.lastIndexOf(" "));
  const head = cut > 0 ? trimTrail(shared.slice(0, cut)) : "";
  if (head.length < MIN_SHARED_LEAD) return whole();
  const out = rows.map((r) => {
    let text = trimLead(r.reason.slice(head.length));
    // The remainder opens on the row's own name, which is already the link beside it.
    if (text.startsWith(r.name)) text = trimLead(text.slice(r.name.length));
    return { name: r.name, slug: r.slug, text };
  });
  return out.some((r) => r.text.length === 0) ? whole() : { head, rows: out };
}

/** THE STATIC BLOCK A CRAWLER READS, and the one place this feature's claim is testable without a
 *  browser: if the partner sentences are not in this string, the 17,775 URLs in the sitemap are
 *  17,775 empty divs.
 *
 *  THE NAME IS THE `h1` (owner, 2026-09-17). It was an `h2` under the wordmark's `h1` for as long
 *  as the shell had one; the wordmark is a link on every route now, and `injectPage` drops the
 *  landing's `.intro` -- whose thesis is the landing's own `h1` -- so a served page carries exactly
 *  one, the card's, which is also what `CardShell` renders in the app.
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
  // EVERY ROW THE ARTIFACT HOLDS (`KEEP` caps it at the build), grouped by key and not by
  // adjacency, the same split `PartnerList` draws. A `slice(0, 24)` lived here until 2026-09-16
  // and would have silently cut the 60-row pages back to 24 for every crawler.
  // The direction is read off the rows by `groupDirection` where it is needed, so the group no
  // longer carries a `producers` flag that answered only two of the three cases.
  const groups: { event: string; rows: InjectableCard["partners"] }[] = [];
  for (const p of card.partners) {
    const g = groups.find((x) => x.event === p.event);
    if (g) g.rows.push(p);
    else groups.push({ event: p.event, rows: [p] });
  }
  const rows = groups.map((g) => {
    const n = card.rarity?.[g.event];
    const dirHere = groupDirection(g.rows);
    // THE EVENT NAMED THE WAY THE GROUP RUNS (roadmap AK4), and the count after it rather than
    // wrapped around it: "2,525 cards can cause a creature dies" is not a sentence, and the
    // player-facing wording is a clause or an action, never a noun phrase.
    const said = dirHere === "asks"
      ? eventKeyClause(g.event)
      : eventKeyAction(g.event) ?? eventKeyClause(g.event);
    const count = n === undefined ? ""
      : `    <p>${esc(said)} — ${n.toLocaleString("en-US")} ${esc(causeCountTail(g.rows, card.name))}.</p>\n`;
    // THE WITHHELD COUNT, in the HTML too: it is the other number that makes this block this
    // card's, and the app has printed it under every group since the list was grouped.
    const dir = dirHere;
    const withheld = withheldFrom(dir, g.event, g.rows.length, card.rarity, card.pool);
    const verb = dir === "causes" ? "cause it" : dir === "feeds" ? "feed it" : "ask for it";
    // AND THE CRAWLER GETS THE SAME LINK THE APP DRAWS (roadmap AJ3), from the same builder: two
    // readers printing one sentence is exactly how AJ1's withheld count came to say one direction
    // and count the other.
    const href = searchHref(dir, g.event, kind === "commander" ? card.identity : undefined);
    const more = withheld > 0
      ? `\n    <p><a href="${esc(href)}">${withheld.toLocaleString("en-US")} other cards ${verb} too</a>. These are the ones with the most connections.</p>`
      : "";
    const { head, rows: cells } = factorLead(g.rows);
    const lead = head === "" ? "" : `    <p>${esc(head)}:</p>\n`;
    const items = cells.map((c) =>
      `      <li><a href="/cards/${esc(c.slug)}">${esc(c.name)}</a> — ${esc(c.text)}</li>`).join("\n");
    // THE ANCHOR THE CLAUSE'S EVENT ROW JUMPS TO (spec C5), the same id the app writes.
    return `    <div id="${esc(groupAnchor(g.event))}">\n${count}${lead}    <ol>\n${items}\n    </ol>${more}\n    </div>`;
  }).join("\n");
  const crossLink = kind === "card"
    ? (card.commander
      ? `    <p><a href="/commanders/${esc(slug)}">What a deck led by this card wants</a></p>\n`
      : "")
    : `    <p><a href="/cards/${esc(slug)}">What the engine reads on this card</a></p>\n`;
  const partners = card.partners.length === 0
    ? "    <p>No partners specific enough to list.</p>"
    : `    <h2>Works well with</h2>\n${rows}`;
  // WHAT THE ENGINE READ, so a reader can check a claim without leaving for Scryfall. Option 2 of
  // spec D2a, taken 2026-09-18: option 1 shipped with our derivation and nothing to check it
  // against, and "Produces: a card being drawn" is unfalsifiable on a page that never shows the
  // line it came from.
  //
  // UNATTRIBUTED, WHICH IS THE ONLY HONEST SHAPE. The original D2 wanted each edge to cite its own
  // clause; that needs a clause id `Ability` does not carry, and the mapping is not 1:1 anyway --
  // Kogla and Yidaro's single activated line derives four abilities. So the clauses are offered as
  // the card's text and the reader does the matching, rather than the page guessing and looking
  // precise about it.
  //
  // THE CARD IMAGE ALREADY SHOWED THIS, as pixels. Making it text is what a crawler, a screen
  // reader and a reader who wants to copy a line all needed.
  // THE CARD, READ DOWN THE CARD (roadmap AJ4, spec C1), and the same section the app renders --
  // the two readers diverged once already and it served 2,665 commander pages to Googlebot alone.
  //
  // ATTRIBUTION IS BY ID, NEVER BY POSITION: `segment` numbers clauses from 1, DERIVE 164 stamps
  // that number onto every ability, and this list drops empty segments -- so a positional zip
  // would misattribute every row after the first gap.
  const abilityLines = (id: number | undefined): string =>
    (card.abilities ?? []).filter((a) => a.clause === id).map((a) => {
      const does = esc(effectPhrase(a.effect, a.amount, undefined, undefined) ?? a.effect.replace(/-/g, " "));
      // THE SAME WORDS THE APP RENDERS. "wants" is a verb, so what follows it has to be a noun --
      // the label form ("life being lost"), never the clause ("life is lost"). The component was
      // fixed and this reader was not, and the two shipped different sentences for one event.
      const wants = a.when.map((k) =>
        `        <li>wants <a href="#${esc(groupAnchor(k))}">${esc(eventKeySentence(k, a.self ? "this card" : undefined))}</a></li>`);
      // A STATIC DEMANDS BY REACH, not by trigger. Without this the crawlable page showed an
      // anthem and a cost-reducer with no events at all, while the app showed eight rows.
      const reaches = (a.applies ?? []).map((k) =>
        `        <li>wants <a href="#${esc(groupAnchor(k))}">${esc(eventKeySentence(k))}</a></li>`);
      const makes = a.emits.map((k) =>
        `        <li>makes <a href="#${esc(groupAnchor(k))}">${esc(eventKeyAction(k) ?? eventKeyClause(k))}</a></li>`);
      const events = [...wants, ...reaches, ...makes];
      return `      <p>${esc(a.kind)}${a.cost ? ` ${esc(a.cost)}` : ""} — ${does}</p>\n`
        + (events.length > 0 ? `      <ul>\n${events.join("\n")}\n      </ul>\n` : "");
    }).join("");
  const implied = (card.abilities ?? []).filter((a) => a.clause === undefined);
  const read = (card.clauses === undefined || card.clauses.length === 0) && implied.length === 0 ? ""
    : `    <h2>How the engine reads this card</h2>\n`
      + (card.clauses ?? []).map((c) =>
        `    <blockquote>${esc(c.text)}</blockquote>\n${abilityLines(c.id)}`).join("")
      // AN IMPLIED ABILITY HAS NO PRINTED LINE (spec C4): read off the card's characteristics, so
      // it sits at the end with no quote above it. 226 of 54,586 rows corpus-wide.
      + (implied.length > 0 ? `    <p>read off the card itself</p>\n${abilityLines(undefined)}` : "");
  // THE ONLY IMAGE ON THE CRAWLABLE PAGE. The art renders client-side, so until now a crawler read
  // 22,209 card pages with no `<img>` on any of them and Google Images had nothing to index. This is
  // the URL `injectPage` already preloads and the app already asks for, so a reader pays no extra
  // bytes for it and it is hidden with the rest of `.prerendered` once React boots.
  //
  // THE FULL CARD, NOT THE CROP: Scryfall requires an artist credit beside an `art_crop`, or a full
  // card image in the same interface, and this corpus has no artist field (D2a constraint 2). That
  // rewrite, and the refusal of any URL off Scryfall's origin, are `cardImageUrl`'s job.
  const image = card.artCrop == null ? null : cardImageUrl(card.artCrop);
  const art = image === null ? ""
    : `    <img src="${esc(image)}" alt="${esc(card.name)}" width="488" height="680" />\n`;
  return `    <section class="prerendered">
    <h1>${esc(card.name)}</h1>
${art}    <p>${esc(card.typeLine)}</p>
${card.manaCost ? `    <p>Mana cost: ${esc(card.manaCost)}</p>\n` : ""}${read}${crossLink}    <p>Produces: ${card.emits.map((e) => esc(eventKeyAction(e) ?? eventKeyClause(e))).join(", ") || "nothing"}.</p>
    <p>Cares about: ${card.demands.map((d) => esc(eventKeyClause(d))).join(", ") || "nothing"}.</p>
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
    <h1>Every ${what} the engine has read</h1>
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
    <h1>${what.replace(/^./, (c) => c.toUpperCase())} starting with ${esc(letter)}</h1>
    <p>${rows.length.toLocaleString("en")} ${rows.length === 1 ? what.replace(/s$/, "") : what}.</p>
${browseNav(kind, letter)}
${list}
    </section>`;
}
