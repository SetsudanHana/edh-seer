import { useEffect, useRef, useState } from "react";
import { analyzeDeck } from "./api.js";
import type { AnalyzeResponse } from "./types.js";
import { DeckInput } from "./components/DeckInput.js";
import { InstallButton } from "./components/InstallButton.js";
import { LegacyDeckRedirect } from "./components/LegacyDeckRedirect.js";
import { CardPage } from "./components/CardPage.js";
import { CardSearch } from "./components/CardSearch.js";
import { CommanderPage } from "./components/CommanderPage.js";
import { BrowserRouter, Route, Routes } from "react-router";
import { ReportView } from "./components/ReportView.js";
import { EXAMPLE_DECK } from "./lib/example-deck.js";
import { clearLastRun, diffRuns, loadLastDeck, loadLastRun, saveLastDeck, saveLastRun, snapshotRun, type RunDiff } from "./lib/run-diff.js";
import { decodeShare, encodeShare, payloadFromHash, shareUrl } from "./lib/share-link.js";
import { deckSourceOf, importDeck } from "./lib/deck-import.js";

export default function App() {
  /** WHAT WAS IN THE BOX LAST TIME (roadmap S9). Read once, before anything else, because it feeds
   *  two initialisers.
   *
   *  A SHARED LINK WINS. The hash effect below would overwrite these anyway, but reading the hash
   *  here means a recipient never sees the sender's deck flash to the recipient's own last paste
   *  and back. */
  const [remembered] = useState(() =>
    payloadFromHash(window.location.hash) ? null : loadLastDeck(),
  );
  const [commanders, setCommanders] = useState(remembered?.commanders ?? "");
  const [decklist, setDecklist] = useState(remembered?.decklist ?? "");
  const [data, setData] = useState<AnalyzeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  /** A DECK IS ALREADY ON ITS WAY, AND THE FIRST PAINT HAS TO KNOW IT. Read from the URL during the
   *  initial render rather than in the effect below, because that effect runs AFTER a paint and
   *  `decodeShare` is async on top of it: for those frames a shared link renders the empty state,
   *  and when the deck lands the whole page jumps up by the height of the hero.
   *
   *  MEASURED, on the production build at 390x844: that single shift was **0.1386** of a 0.1771 CLS,
   *  the largest of three, and Google's "good" threshold for the whole page is 0.1. Cloudflare's
   *  field data named `DeckInput`'s own two divs as the moving elements; they move because what is
   *  above them disappears.
   *
   *  IT CLEARS ON A LINK THAT DOES NOT DECODE, so a malformed hash gets the ordinary empty page
   *  instead of a permanently hidden introduction. */
  const [fromLink, setFromLink] = useState(() => payloadFromHash(window.location.hash) !== null);

  /** SEEDED FROM THE LINK, because `editing` gates the collapse below and a link the reader never
   *  typed into is not being edited. Left at `true` here, the paste box rendered EXPANDED for the
   *  whole round trip and then collapsed on the response -- the second measured shift, and the one
   *  the `collapsed` prop alone could not remove. */
  const [editing, setEditing] = useState(!fromLink);
  // What the last Re-analyze moved. Held in state rather than derived on render because it is a
  // fact about a TRANSITION -- once the snapshot is written, the same `data` no longer implies it.
  const [diff, setDiff] = useState<RunDiff | null>(null);

  /** THE ANALYSIS THIS PAGE IS SHOWING, AS A LINK. Written after a successful run and kept in state
   *  so the copy button hands out what is on screen rather than what is in the boxes -- those differ
   *  the moment someone edits the decklist without re-analysing. */
  const [link, setLink] = useState<string | null>(null);

  async function analyse(deckText: string, commanderText: string) {
    setLoading(true);
    setError(null);
    // A LINK IN THE DECKLIST BOX IS AN IMPORT, and it is the only interaction this feature has. A
    // decklist never looks like a bare URL, so the two cannot be confused, and a second box that
    // accepted only links would make the reader decide which one their clipboard belongs in.
    //
    // The imported deck goes into the FORM, both fields, and the link is thrown away. The share link
    // then carries decklist text like any other run -- making the URL the deck's identity would send
    // every viewer of a shared link through the deck site at once, which is the traffic the importer
    // is rate-limited to avoid.
    const remote = deckSourceOf(deckText);
    if (remote) {
      try {
        const imported = await importDeck(remote.source, remote.id);
        setCommanders(imported.commanders);
        setDecklist(imported.decklist);
        deckText = imported.decklist;
        commanderText = imported.commanders;
      } catch (e) {
        // Its own catch: an import failure must leave the boxes OPEN with the link still in them, so
        // the reader can retry or paste over it. Falling through to the analysis would ask the engine
        // to resolve a URL as a card name and report "1 card not found".
        setError(e instanceof Error ? e.message : "Could not import that deck");
        setLoading(false);
        return;
      }
    }
    // THE BOX CLOSES ON THE CLICK, NOT ON THE ANSWER. This used to sit next to `setData` below, so
    // the ~420px paste box became a ~128px bar seconds later and shoved the page up by 290px --
    // outside the 500ms `hadRecentInput` window, which is what makes a shift count against CLS.
    // Here it lands in the same task as the click, so the browser attributes it to the reader. The
    // catch below reopens it, because an error is the one case where the boxes are wanted back.
    setEditing(false);
    try {
      const next = await analyzeDeck(deckText, commanderText);
      // WAS THAT A DECKLIST? `resolvedCount` counts cards the engine actually found, and a real list
      // finds at least one. Everything that outlives the page view is gated on it.
      const looksLikeDeck = next.resolvedCount > 0;
      const previous = loadLastRun();
      const snapshot = snapshotRun(next);
      setDiff(previous ? diffRuns(previous, snapshot) : null);
      saveLastRun(snapshot);
      // NOR DOES IT COME BACK ON THE NEXT VISIT. `loadLastDeck` refills the paste box from here, so
      // storing text that resolved nothing both keeps it around and quietly re-analyses it -- caught
      // while verifying the URL guard below, when a run of pasted notes came back on the next load.
      if (looksLikeDeck) saveLastDeck({ commanders: commanderText, decklist: deckText });
      setData(next);
      setEditing(false);
      // THE ADDRESS BAR BECOMES THE SHARE LINK, which is what makes this get used: a reader who
      // analyses a deck can copy the URL without knowing the feature exists. A deck too long to
      // encode leaves the URL alone rather than writing a broken one.
      //
      // PUSH THE FIRST, REPLACE THE REST, and the distinction is the whole fix. This was
      // `replaceState` unconditionally, so that re-analysing would not fill the back button with
      // near-identical entries -- correct for the second analysis onward, and it meant the FIRST
      // one created no entry either. Back then left the site: the reader had gone from a paste box
      // to a full report without the browser recording that anything happened. Owner report,
      // 2026-08-31: "after we added the url there is no easy way to go back from the analysis".
      // Pushing only when the URL does not already carry a deck keeps both properties -- one entry
      // for "I analysed something", none for the re-runs, and none for opening a shared link, whose
      // hash is already there when the page loads.
      //
      // AND WHAT WAS NEVER A DECK NEVER BECOMES A URL. Owner-reported, 2026-09-03: "if I paste
      // something that is not decklist to areabox, it is still hashed in the url". The fragment is
      // never sent to a host, so nothing leaks outward -- but it does reach the address bar, the
      // browser history, and whatever the reader pastes that link into next believing it to be a
      // deck. `resolvedCount` is the honest test of "was that a decklist": it counts cards the
      // engine actually found, and a real list finds at least one. The paste box still keeps the
      // text and the report still renders; only the shareable surfaces refuse it.
      const payload = looksLikeDeck
        ? await encodeShare({ commanders: commanderText, decklist: deckText })
        : null;
      setLink(payload ? shareUrl(window.location.origin, window.location.pathname, payload) : null);
      if (payload) {
        const write = payloadFromHash(window.location.hash) ? "replaceState" : "pushState";
        window.history[write](null, "", `#deck=${payload}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setData(null);
      setEditing(true);
    } finally {
      setLoading(false);
    }
  }

  const onAnalyze = () => void analyse(decklist, commanders);

  /** NOTHING PASTED, NOTHING ANALYSED, NOTHING IN FLIGHT — the only state in which the page has to
   *  introduce itself. Named once because the lead above the form and the example-deck button below
   *  it are two halves of the same empty state and must appear and vanish together. */
  const firstVisit = !data && !loading && !fromLink && decklist.trim() === "";

  /** A SHARED LINK IS A DECK THAT ANALYSES ITSELF. Anything else -- filling the boxes and waiting for
   *  a click -- makes the recipient do the work the sender already did.
   *
   *  Runs once. The ref is not defensiveness about StrictMode's double invocation alone: `analyse`
   *  writes the hash it just read, so without it this effect is its own trigger. */
  const openedFromLink = useRef(false);
  useEffect(() => {
    if (openedFromLink.current) return;
    openedFromLink.current = true;
    const payload = payloadFromHash(window.location.hash);
    if (!payload) return;
    void decodeShare(payload).then((deck) => {
      // a link that does not decode leaves an empty paste box, as if it were absent -- including
      // the two things `fromLink` turned off on its behalf: the introduction, and the open box.
      if (!deck) { setFromLink(false); setEditing(true); return; }
      setCommanders(deck.commanders);
      setDecklist(deck.decklist);
      void analyse(deck.decklist, deck.commanders);
    });
  }, []);

  /** THE EXPLAINER IS FOR SOMEONE WHO HAS NOT PASTED A DECK YET, and it lives in `index.html`
   *  outside `#root`, so React cannot unmount it. An attribute on the document element lets CSS
   *  hide it instead.
   *
   *  SAFE FOR CRAWLERS BY CONSTRUCTION, which is the whole reason that markup is static: a reader
   *  with JavaScript off never runs this effect, never sets the attribute, and still gets the full
   *  explainer. `seo.test.ts` parses the source FILE and never runs React, so its 800-character
   *  readable-text floor cannot be affected by this at all. */
  useEffect(() => {
    const root = document.documentElement;
    if (data) root.dataset.report = "1";
    else delete root.dataset.report;
    return () => { delete root.dataset.report; };
  }, [data]);

  /** BACK AND FORWARD, now that an analysis is a history entry.
   *
   *  Without this the entry exists and does nothing when you reach it: the URL would change and the
   *  page would keep showing whatever it was showing. Landing on a deck hash re-opens that analysis;
   *  landing on a URL with no deck leaves the report for the paste box.
   *
   *  THE DECKLIST SURVIVES A BACK. "Out of the report" is what the reader asked for, not "start
   *  over" -- clearing the boxes would throw away the list they pasted, and the report is one click
   *  away again. A reload of that same clean URL does start empty, which is the honest reading of an
   *  address bar with no deck in it.
   *
   *  The listener is registered once and reaches the current `analyse` through a ref: re-subscribing
   *  on every render would be a new listener per keystroke in the decklist box. */
  const analyseRef = useRef(analyse);
  analyseRef.current = analyse;
  useEffect(() => {
    const onPop = () => {
      const payload = payloadFromHash(window.location.hash);
      if (!payload) {
        setData(null);
        setDiff(null);
        setLink(null);
        setEditing(true);
        return;
      }
      void decodeShare(payload).then((deck) => {
        if (!deck) return;
        setCommanders(deck.commanders);
        setDecklist(deck.decklist);
        void analyseRef.current(deck.decklist, deck.commanders);
      });
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  return (
    /* THE REPORT IS ROUTED (S7): `/graph`, `/cards` and `/combos` are its three reference surfaces,
     * so the browser's back button returns a reader to the scroll offset they left instead of
     * leaving the report. The router wraps the whole app rather than the report alone so a reader
     * who backs out to the paste box and analyses again does not re-mount it under a stale path.
     *
     * The DECK stays in the HASH. A shared link is still `/` plus `#deck=<payload>`; the path says
     * which surface, the hash says which deck, and the two never collide. */
    // THE COLUMN USED TO STOP AT 1024px. On a 1920 screen that left 448px of empty gutter on each
    // side -- 47% of the viewport -- while the report ran 3,092px tall, i.e. 2.9 screens of
    // scrolling past dead space. The reference tools this product is measured against (Moxfield,
    // Archidekt, Scryfall) all use the width.
    //
    // Above `xl` the cap comes off entirely -- a centred 1600px column on a 1920 screen still left
    // 160px of dead margin each side, which is the same complaint one step smaller. The width is
    // safe to give away because nothing here stretches with it: the report flows into columns
    // (`ReportChapters`) and every run of prose carries its own measure cap, so growing the container
    // adds columns rather than 200-character lines. Below `xl` the reading column is unchanged.
    // `min-h-screen` and the background moved to `body` (index.css) when the static intro in
    // `index.html` put real content outside this element: a short analysis left `main` filling the
    // viewport, so the explainer started a full screen below the fold with a band of unpainted page
    // between them.
    <BrowserRouter>
    {/* SHARE LINKS COPIED BEFORE THE SURFACES MOVED. `/graph`, `/cards` and `/combos` used to BE the
      * report; they carry `#deck=<payload>` and the hash never reaches the server, so this cannot be
      * a Cloudflare redirect -- see `LegacyDeckRedirect`. Renders nothing when there is no deck in
      * the hash, which is why it can sit above the app rather than replacing it.
      * `/cards` IS NOT HERE ANY MORE: it is the card search now, and that page renders the same
      * redirect itself. A path that is a real page cannot also be a bare redirect above the app --
      * the redirect has to be part of what the page does on arrival. */}
    <Routes>
      <Route path="/graph" element={<LegacyDeckRedirect to="/analysis/graph" />} />
      <Route path="/combos" element={<LegacyDeckRedirect to="/analysis/combos" />} />
      {/* THIS BLOCK MATCHES TWO PATHS AND THE APP HAS MANY, so without a catch-all React Router
        * warns `No routes matched location` on every OTHER page -- console noise on every card
        * page, every commander page and the landing itself, which is how a real warning goes
        * unread. It renders nothing, which is what it already did. */}
      <Route path="*" element={null} />
    </Routes>
    {/* THE CARD PAGES REPLACE THE DECK TOOL RATHER THAN SITTING UNDER IT, which is why `main` is a
      * route element now instead of the component's whole body. `*` keeps every other path on the
      * deck tool, including a bare `/#deck=...`: a share link's path is a hint about which surface
      * to open, and the deck itself is in the hash.
      * THE BLOCK BELOW IS UNCHANGED AND UNINDENTED ON PURPOSE -- re-indenting 100 lines to add two
      * would bury the actual change in the diff. */}
    <Routes>
      <Route path="/cards" element={<CardSearch />} />
      <Route path="/cards/:slug" element={<CardPage />} />
      <Route path="/commanders" element={<CardSearch mode="commanders" />} />
      <Route path="/commanders/:slug" element={<CommanderPage />} />
      <Route path="*" element={
    <main className="p-8 w-full max-w-5xl xl:max-w-none mx-auto flex flex-col gap-8">
      {/* RENDERS NOTHING HERE. It portals into the static header's nav, and only once the browser
        *  has said the app can be installed -- see `InstallButton` for why the event is the whole
        *  gate. Mounted from the app rather than from `index.html` because the decision is stateful
        *  and the header is not. */}
      <InstallButton />
      {/* THE PAGE SAID WHAT IT WAS IN 14px MUTED BODY, UNDER THE FORM. The only display-weight
        *  heading on the landing was the static header's wordmark at 24px, against 14px prose — a
        *  1.71x ratio where the house bar is 2.5x, which is bold body text and not a heading. A
        *  first-time reader met a two-box form with no statement above it of what the form is for.
        *
        *  THE COPY IS THE SENTENCE THAT WAS ALREADY THERE, split at its own full stop: the claim
        *  becomes the heading, the list of what you get stays prose. Nothing new is asserted.
        *
        *  IT IS AN `h2`, NOT AN `h1`. `index.html` carries the page's one `h1` on the static header
        *  deliberately — it is the heading a crawler reads without running the bundle, and
        *  `seo.test.ts` asserts it — so a second `h1` here would be the defect, not the fix.
        *
        *  ABOVE THE FORM, and it replaces nothing: the "load example deck" button stays below,
        *  where it is an action on the form rather than part of the pitch. Both are gated on the
        *  same `firstVisit`, so a reader who has pasted anything sees neither. */}
      {firstVisit && (
        <div className="flex flex-col gap-3">
          <h2 className="max-w-[22ch] text-3xl sm:text-4xl font-bold tracking-[-0.02em] text-(--foreground)">
            Paste a decklist to get an oracle-text synergy read.
          </h2>
          {/* 65ch, and the cap is the whole point: this ran the full width of the container, which
            *  above `xl` is the viewport — 1,376px at 1440, or 156 characters a line against the
            *  45–75 the type rules allow. `.intro p` already caps at 68ch; this one never did. */}
          <p className="max-w-[65ch] text-sm text-(--muted)">
            Mana curve, land math, role spend, per-card roles, and combos. No account needed.
          </p>
        </div>
      )}
      {
        /*
        THESIS: The category standard, taken on purpose — a plain dark analytics
        dashboard, not an illustrated MTG-card pastiche or a cross-domain metaphor.
        OWN-WORLD: a near-black VIOLET ground, off-white text with the same cast, one
        FIXED magenta accent that no deck can change (DESIGN.md v2); Inter throughout,
        JetBrains Mono for every number/label; flat, border-driven surfaces; ranked
        data reads as tables.
        STORY: paste a decklist, get a dense report that reads like the reference
        tools this player already trusts daily.
        FIRST VIEWPORT: wordmark, input panel, then (post-analysis) tabbed report —
        stat tiles, a ranked card table, archetypes, combos.
        FORM: canon, chosen over two rolled alternates (seed-catalog, tournament-
        standings) at the user's decision; craft bar = Scryfall, Archidekt/Moxfield.
        Seed chain: 508515db -> 913b3f8c -> canon.
        FINISH: unreviewed and undocumented is unfinished; this build ends with the
        finish review, the verdict, and DESIGN.md.
        */
      }
      {/* The header is static HTML in `index.html` now, above `#root`: it is the site's name and
          its nav, neither of which should wait for a bundle, and it carries the page's `h1` where a
          crawler can read it. The identity picker that used to sit at its right, and the gradient
          rule under it, went with DESIGN.md v2. */}
      <DeckInput
        commanders={commanders}
        onCommandersChange={setCommanders}
        value={decklist}
        onChange={setDecklist}
        onAnalyze={onAnalyze}
        loading={loading}
        // COLLAPSED THE MOMENT A RUN STARTS, not when it finishes. The expanded box is ~420px tall
        // and the collapsed bar is ~128px, so swapping them on the response shoves everything below
        // up by 290px seconds after the click -- outside the 500ms `hadRecentInput` window, so CLS
        // counts it (0.0211 measured). Collapsing on submit puts the shift inside that window on a
        // click, and removes it entirely on a shared link, where there is no click at all. The bar
        // already renders `Analyzing...` with `aria-busy`, so it is also the better in-flight state.
        collapsed={!editing && (!!data || loading || fromLink)}
        onEdit={() => setEditing(true)}
        // START OVER IS A NAVIGATION, NOT A STATE RESET, and that is the lazy half of the fix. The
        // deck lives in `location.hash`, the report lives at `/cards`, `/graph` or `/combos`, and
        // the paste box is refilled from `sessionStorage` on the next visit -- so unwinding this in
        // state means clearing four things and getting the URL right by hand. `/` with no hash IS
        // the empty app, so the store is cleared and the browser is asked for it.
        // AND IT IS RECOVERABLE: `assign` leaves a history entry, so Back returns to the report's
        // own address and the hash rebuilds it. That is why there is no confirmation.
        onStartOver={() => { clearLastRun(); window.location.assign("/"); }}
        shareLink={link}
      />
      {firstVisit && (
        <div className="flex flex-col gap-2 text-sm text-(--muted)">
          <button
            type="button"
            className="self-start eyebrow px-3 py-1 rounded-(--radius) border border-(--separator) text-(--accent)"
            onClick={() => { setCommanders(EXAMPLE_DECK.commanders); setDecklist(EXAMPLE_DECK.decklist); }}
          >
            Load example deck
          </button>
        </div>
      )}
      {error && (
        <div className="text-danger border border-danger rounded-(--radius) p-3 text-sm font-mono">{error}</div>
      )}
      {data && (
        <div className="reveal">
          <ReportView data={data} diff={diff} />
        </div>
      )}
      {/* The fan-content notice used to render here. It is static HTML in `index.html` now, after
          the intro section: a footer inside `main` stopped being at the foot the moment any content
          lived outside it, and a notice that is a CONDITION of showing Wizards' property should not
          depend on the bundle loading at all. */}
    </main>
      } />
    </Routes>
    </BrowserRouter>
  );
}
